/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

//! The Prism fast path (#1178): reads a tile whose corners, version and level
//! are already known, as a tracker (#1142) knows them from the frames before.
//! Nothing is searched for and the frame is never binarised: only the module
//! centres are read, straight from the caller's pixels, and each is cut
//! against the mean of the modules around it.

use crate::bitstream;
use crate::symbol::{decode_grid, Grid};
use crate::transform::Projective;
use crate::Decoded;
use alloc::vec;
use alloc::vec::Vec;
use qrcraftly_core::qr::Ecc;

/// Where a tile is and what it holds.
#[derive(Clone, Copy, Debug)]
pub struct Tile {
    /// The symbol's top-left, top-right, bottom-right and bottom-left corners
    /// (the outer edges of its modules, not the quiet zone), in frame pixels.
    pub corners: [(f32, f32); 4],
    pub version: u8,
    /// `None` accepts any level.
    pub ecc: Option<Ecc>,
    /// Also try the tile as light on dark.
    pub inverted: bool,
}

/// Grey or RGBA pixels, row by row, read in place.
pub struct Pixels<'a> {
    pub width: usize,
    pub height: usize,
    pub channels: usize,
    pub data: &'a [u8],
}

impl Pixels<'_> {
    /// Brightness at a pixel, with the same weights as [`crate::image::Luma::from_rgba`].
    #[inline]
    fn grey(&self, x: usize, y: usize) -> u32 {
        let i = (y * self.width + x) * self.channels;
        if self.channels == 1 {
            return self.data[i] as u32;
        }
        rgba_grey(&self.data[i..i + 4])
    }

    /// The summed brightness of the 2 x 2 square whose top-left pixel is `x`, `y`,
    /// with the square clamped to the frame.
    #[inline]
    fn square(&self, x: usize, y: usize) -> u32 {
        let (w, h) = (self.width, self.height);
        if x + 1 < w && y + 1 < h {
            let i = (y * w + x) * self.channels;
            let below = i + w * self.channels;
            if self.channels == 1 {
                let (a, b) = (&self.data[i..i + 2], &self.data[below..below + 2]);
                return a[0] as u32 + a[1] as u32 + b[0] as u32 + b[1] as u32;
            }
            let (a, b) = (&self.data[i..i + 8], &self.data[below..below + 8]);
            return rgba_grey(&a[..4])
                + rgba_grey(&a[4..])
                + rgba_grey(&b[..4])
                + rgba_grey(&b[4..]);
        }
        let (x1, y1) = ((x + 1).min(w - 1), (y + 1).min(h - 1));
        self.grey(x, y) + self.grey(x1, y) + self.grey(x, y1) + self.grey(x1, y1)
    }
}

#[inline]
fn rgba_grey(p: &[u8]) -> u32 {
    (306 * p[0] as u32 + 601 * p[1] as u32 + 117 * p[2] as u32 + 512) >> 10
}

/// Modules a side of a threshold block.
const BLOCK: usize = 4;
/// Pixels summed for one module: the 2 x 2 square nearest its centre.
const SPOT: i32 = 4;

/// Reads each module's brightness (the sum of the 2 x 2 pixels nearest its
/// centre, which smooths sensor noise for one transform per module). `None`
/// when a centre falls off the frame.
fn sample(pixels: &Pixels, map: &Projective, n: usize) -> Option<Vec<u16>> {
    let (w, h) = (pixels.width as f32, pixels.height as f32);
    let mut values = vec![0u16; n * n];
    // When every centre's square is in the frame (true if the four corner
    // centres' are, as a projective map keeps the grid inside their hull), the
    // squares need no clamping. A tenth of a pixel allows for rounding.
    let d = n as f32 - 0.5;
    let clear = [(0.5, 0.5), (d, 0.5), (d, d), (0.5, d)]
        .iter()
        .all(|&(u, v)| {
            let (x, y) = map.apply(u, v);
            x >= 0.6 && y >= 0.6 && x < w - 0.6 && y < h - 0.6
        });
    if clear {
        let (width, data) = (pixels.width, pixels.data);
        for (r, row) in values.chunks_exact_mut(n).enumerate() {
            map.for_row(0.5, r as f32 + 0.5, n, |c, x, y| {
                let i = (y - 0.5) as usize * width + (x - 0.5) as usize;
                row[c] = if pixels.channels == 1 {
                    data[i] as u16
                        + data[i + 1] as u16
                        + data[i + width] as u16
                        + data[i + width + 1] as u16
                } else {
                    let (a, b) = (
                        &data[4 * i..4 * i + 8],
                        &data[4 * (i + width)..4 * (i + width) + 8],
                    );
                    (rgba_grey(&a[..4])
                        + rgba_grey(&a[4..])
                        + rgba_grey(&b[..4])
                        + rgba_grey(&b[4..])) as u16
                };
            });
        }
        return Some(values);
    }
    let mut inside = true;
    for (r, row) in values.chunks_exact_mut(n).enumerate() {
        map.for_row(0.5, r as f32 + 0.5, n, |c, x, y| {
            // A pixel of slack at the edges, as in `detect::sample`.
            inside &= x >= -1.0 && y >= -1.0 && x <= w && y <= h;
            // Both are at least -1.5 when inside, so truncating after adding 2 floors.
            let x0 = (((x + 1.5) as usize).saturating_sub(2)).min(pixels.width - 1);
            let y0 = (((y + 1.5) as usize).saturating_sub(2)).min(pixels.height - 1);
            row[c] = pixels.square(x0, y0) as u16;
        });
        if !inside {
            return None;
        }
    }
    Some(values)
}

/// Cuts each module against the mean of the modules in its block of
/// BLOCK x BLOCK and the eight blocks around it (as zxing's hybrid binariser
/// does with pixels), marking those close to their threshold as weak for
/// Reed-Solomon.
fn threshold(values: &[u16], n: usize) -> Grid {
    let blocks = n.div_ceil(BLOCK);
    let mut sums = vec![0u32; blocks * blocks];
    for (r, row) in values.chunks_exact(n).enumerate() {
        let line = &mut sums[(r / BLOCK) * blocks..][..blocks];
        for (c, &v) in row.iter().enumerate() {
            line[c / BLOCK] += v as u32;
        }
    }
    // Each block's neighbourhood: total brightness and module count.
    let span = |b: usize| {
        let (first, last) = (b.saturating_sub(1), (b + 1).min(blocks - 1));
        (first, last, (BLOCK * (last + 1)).min(n) - BLOCK * first)
    };
    let mut levels = vec![(0i32, 0i32); blocks * blocks];
    for br in 0..blocks {
        let (top, bottom, height) = span(br);
        for bc in 0..blocks {
            let (left, right, width) = span(bc);
            let total: u32 = (top..=bottom)
                .flat_map(|r| sums[r * blocks + left..=r * blocks + right].iter())
                .sum();
            levels[br * blocks + bc] = (total as i32, (height * width) as i32);
        }
    }
    let mut bits = vec![0u8; n * n];
    let mut weak = vec![0u8; n * n];
    for (r, row) in values.chunks_exact(n).enumerate() {
        let line = &levels[(r / BLOCK) * blocks..][..blocks];
        let (bits, weak) = (&mut bits[r * n..][..n], &mut weak[r * n..][..n]);
        for (c, &v) in row.iter().enumerate() {
            let (total, count) = line[c / BLOCK];
            // Compared as v * count against the neighbourhood's total, so no division.
            let gap = v as i32 * count - total;
            bits[c] = u8::from(gap < 0);
            // Values are sums of four pixels, so the margin is four times `detect`'s.
            weak[c] = u8::from(gap.abs() < SPOT * crate::detect::WEAK_MARGIN * count);
        }
    }
    Grid {
        size: n,
        bits,
        weak,
    }
}

/// Reads one tile. `None` when it does not decode at the version and level given.
pub fn decode_tracked(pixels: &Pixels, tile: &Tile) -> Option<Decoded> {
    if !(1..=40).contains(&tile.version) || pixels.width == 0 || pixels.height == 0 {
        return None;
    }
    let n = 17 + 4 * tile.version as usize;
    let d = n as f32;
    let map = Projective::quad_to_quad([(0.0, 0.0), (d, 0.0), (d, d), (0.0, d)], tile.corners);
    let values = sample(pixels, &map, n)?;
    let mut grid = threshold(&values, n);
    for inverted in [false, true] {
        if inverted {
            if !tile.inverted {
                break;
            }
            for b in &mut grid.bits {
                *b ^= 1;
            }
        }
        for mirrored in [false, true] {
            let read = if mirrored {
                decode_grid(&grid.transposed())
            } else {
                decode_grid(&grid)
            };
            let Ok(codewords) = read else { continue };
            if tile.ecc.is_some_and(|e| e != codewords.ecc) {
                continue;
            }
            let content = bitstream::parse(&codewords.data, codewords.version)?;
            let [tl, tr, br, bl] = tile.corners;
            let (top_right, bottom_left) = if mirrored { (bl, tr) } else { (tr, bl) };
            let at = |x: f32, y: f32| map.apply(x, y);
            let (finder_tr, finder_bl) = if mirrored {
                (at(3.5, d - 3.5), at(d - 3.5, 3.5))
            } else {
                (at(d - 3.5, 3.5), at(3.5, d - 3.5))
            };
            return Some(Decoded {
                version: codewords.version,
                ecc: codewords.ecc,
                mask: codewords.mask,
                mirrored,
                inverted,
                corrected: codewords.corrected,
                corners: [tl, top_right, br, bottom_left],
                finders: [at(3.5, 3.5), finder_tr, finder_bl],
                alignment: None,
                content,
            });
        }
    }
    None
}
