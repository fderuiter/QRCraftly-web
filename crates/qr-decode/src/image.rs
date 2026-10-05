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

//! Greyscale frames and their binarisation.
//!
//! The main binariser thresholds each 8 x 8 block against the average of the
//! block levels around it, so shadows, gradients and glare across a frame do
//! not swallow a code. Small frames, and the fallback pass, use one global
//! threshold taken from the valley of the brightness histogram.

use alloc::vec;
use alloc::vec::Vec;

/// One byte of brightness per pixel, row by row (0 black, 255 white).
pub struct Luma {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

impl Luma {
    /// Converts RGBA pixels with integer weights (BT.601), so every engine gets the same bytes.
    pub fn from_rgba(width: usize, height: usize, rgba: &[u8]) -> Luma {
        let data = rgba
            .chunks_exact(4)
            .map(|p| {
                ((306 * p[0] as u32 + 601 * p[1] as u32 + 117 * p[2] as u32 + 512) >> 10) as u8
            })
            .collect();
        Luma {
            width,
            height,
            data,
        }
    }

    pub fn get(&self, x: usize, y: usize) -> u8 {
        self.data[y * self.width + x]
    }

    /// Half the width and height, each pixel the average of a 2 x 2 square.
    pub fn half(&self) -> Luma {
        let (w, h) = (self.width / 2, self.height / 2);
        let mut data = Vec::with_capacity(w * h);
        for y in 0..h {
            let a = &self.data[2 * y * self.width..];
            let b = &self.data[(2 * y + 1) * self.width..];
            for x in 0..w {
                let sum =
                    a[2 * x] as u32 + a[2 * x + 1] as u32 + b[2 * x] as u32 + b[2 * x + 1] as u32;
                data.push(((sum + 2) / 4) as u8);
            }
        }
        Luma {
            width: w,
            height: h,
            data,
        }
    }
}

/// Dark (1) and light (0) pixels, with the threshold each pixel was cut at.
pub struct Binary {
    pub width: usize,
    pub height: usize,
    pub bits: Vec<u8>,
    thresholds: Thresholds,
}

enum Thresholds {
    Global(u8),
    Blocks { columns: usize, levels: Vec<u8> },
}

const BLOCK_SHIFT: usize = 3;
const BLOCK: usize = 1 << BLOCK_SHIFT;
/// Below this spread a block is treated as flat (all light or all dark).
const MIN_CONTRAST: u8 = 24;

impl Binary {
    #[inline]
    pub fn get(&self, x: usize, y: usize) -> bool {
        self.bits[y * self.width + x] != 0
    }

    /// `get` for signed coordinates; anything outside the frame is light.
    #[inline]
    pub fn get_i(&self, x: i32, y: i32) -> bool {
        x >= 0
            && y >= 0
            && (x as usize) < self.width
            && (y as usize) < self.height
            && self.get(x as usize, y as usize)
    }

    /// The level a pixel was compared against.
    pub fn threshold(&self, x: usize, y: usize) -> u8 {
        match &self.thresholds {
            Thresholds::Global(t) => *t,
            Thresholds::Blocks { columns, levels } => {
                levels[(y >> BLOCK_SHIFT) * columns + (x >> BLOCK_SHIFT)]
            }
        }
    }

    /// Swaps dark and light, for light-on-dark codes.
    pub fn invert(&mut self) {
        for b in &mut self.bits {
            *b ^= 1;
        }
    }

    /// Local thresholds, falling back to a global one for frames under 40 pixels a side.
    pub fn hybrid(luma: &Luma) -> Binary {
        let (w, h) = (luma.width, luma.height);
        if w < 5 * BLOCK || h < 5 * BLOCK {
            return Binary::global(luma);
        }
        let columns = w.div_ceil(BLOCK);
        let rows = h.div_ceil(BLOCK);
        let mut black = vec![0u8; columns * rows];
        let mut flat = vec![false; columns * rows];
        for by in 0..rows {
            let y0 = (by * BLOCK).min(h - BLOCK);
            for bx in 0..columns {
                let x0 = (bx * BLOCK).min(w - BLOCK);
                let (mut sum, mut min, mut max) = (0u32, 255u8, 0u8);
                for y in y0..y0 + BLOCK {
                    for &v in &luma.data[y * w + x0..y * w + x0 + BLOCK] {
                        sum += v as u32;
                        min = min.min(v);
                        max = max.max(v);
                    }
                }
                let mut level = (sum >> (2 * BLOCK_SHIFT)) as u8;
                if max - min <= MIN_CONTRAST {
                    flat[by * columns + bx] = true;
                    // A flat block: assume it is background, unless its neighbours
                    // say the code continues through it.
                    level = min / 2;
                    if by > 0 && bx > 0 {
                        let neighbours = (black[(by - 1) * columns + bx] as u32
                            + 2 * black[by * columns + bx - 1] as u32
                            + black[(by - 1) * columns + bx - 1] as u32)
                            / 4;
                        if (min as u32) < neighbours {
                            level = neighbours as u8;
                        }
                    }
                }
                black[by * columns + bx] = level;
            }
        }
        // Each block's threshold is the average level of the 5 x 5 blocks
        // around it, counting only blocks with contrast when there are any: a
        // flat block's guessed level would drag a faint code's edge below its
        // dark modules.
        let mut levels = vec![0u8; columns * rows];
        let mut bits = vec![0u8; w * h];
        for by in 0..rows {
            let cy = by.clamp(2, rows.saturating_sub(3).max(2));
            for bx in 0..columns {
                let cx = bx.clamp(2, columns.saturating_sub(3).max(2));
                let (mut sum, mut count, mut flat_sum, mut flat_count) = (0u32, 0u32, 0u32, 0u32);
                for ny in cy - 2..=(cy + 2).min(rows - 1) {
                    for nx in cx - 2..=(cx + 2).min(columns - 1) {
                        let i = ny * columns + nx;
                        if flat[i] {
                            flat_sum += black[i] as u32;
                            flat_count += 1;
                        } else {
                            sum += black[i] as u32;
                            count += 1;
                        }
                    }
                }
                let t = sum
                    .checked_div(count)
                    .unwrap_or(flat_sum / flat_count.max(1)) as u8;
                levels[by * columns + bx] = t;
                let y0 = by * BLOCK;
                let x0 = bx * BLOCK;
                for y in y0..(y0 + BLOCK).min(h) {
                    for x in x0..(x0 + BLOCK).min(w) {
                        bits[y * w + x] = u8::from(luma.data[y * w + x] <= t);
                    }
                }
            }
        }
        Binary {
            width: w,
            height: h,
            bits,
            thresholds: Thresholds::Blocks { columns, levels },
        }
    }

    /// One threshold for the whole frame, from the valley between the two
    /// strongest peaks of a 32-bucket brightness histogram.
    pub fn global(luma: &Luma) -> Binary {
        let mut buckets = [0u32; 32];
        for &v in &luma.data {
            buckets[(v >> 3) as usize] += 1;
        }
        let t = valley(&buckets).unwrap_or(128);
        let bits = luma.data.iter().map(|&v| u8::from(v < t)).collect();
        Binary {
            width: luma.width,
            height: luma.height,
            bits,
            thresholds: Thresholds::Global(t),
        }
    }
}

fn valley(buckets: &[u32; 32]) -> Option<u8> {
    let (first, &max_count) = buckets
        .iter()
        .enumerate()
        .max_by_key(|&(i, &c)| (c, core::cmp::Reverse(i)))?;
    // The second peak favours height and distance from the first.
    let mut second = 0;
    let mut second_score = 0u64;
    for (i, &c) in buckets.iter().enumerate() {
        let d = i.abs_diff(first) as u64;
        let score = c as u64 * d * d;
        if score > second_score {
            second_score = score;
            second = i;
        }
    }
    let (lo, hi) = if first < second {
        (first, second)
    } else {
        (second, first)
    };
    if hi - lo <= 2 {
        return None;
    }
    let mut best = hi - 1;
    let mut best_score = -1i64;
    for (x, &bucket) in buckets.iter().enumerate().take(hi).skip(lo + 1) {
        let from_lo = (x - lo) as i64;
        let score = from_lo * from_lo * (hi - x) as i64 * (max_count - bucket) as i64;
        if score > best_score {
            best_score = score;
            best = x;
        }
    }
    Some((best << 3) as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(width: usize, height: usize, f: impl Fn(usize, usize) -> u8) -> Luma {
        let mut data = Vec::new();
        for y in 0..height {
            for x in 0..width {
                data.push(f(x, y));
            }
        }
        Luma {
            width,
            height,
            data,
        }
    }

    #[test]
    fn rgba_weights_give_grey_for_grey() {
        let luma = Luma::from_rgba(2, 1, &[0, 0, 0, 255, 200, 200, 200, 255]);
        assert_eq!(luma.data, vec![0, 200]);
    }

    #[test]
    fn hybrid_follows_a_gradient() {
        // A checkerboard of 12-pixel squares under a strong left-to-right gradient.
        let luma = frame(168, 84, |x, y| {
            let base = (x * 150 / 168) as u8;
            if (x / 12 + y / 12) % 2 == 0 {
                base
            } else {
                base + 100
            }
        });
        let binary = Binary::hybrid(&luma);
        for y in (6..84).step_by(12) {
            for x in (6..168).step_by(12) {
                assert_eq!(binary.get(x, y), (x / 12 + y / 12) % 2 == 0, "{x},{y}");
            }
        }
    }

    #[test]
    fn global_splits_two_levels() {
        let luma = frame(20, 20, |x, _| if x < 10 { 30 } else { 220 });
        let binary = Binary::global(&luma);
        assert!(binary.get(0, 0));
        assert!(!binary.get(19, 0));
    }

    #[test]
    fn half_averages_squares() {
        let luma = frame(4, 2, |x, _| (x * 10) as u8);
        let half = luma.half();
        assert_eq!((half.width, half.height), (2, 1));
        assert_eq!(half.data, vec![5, 25]);
    }
}
