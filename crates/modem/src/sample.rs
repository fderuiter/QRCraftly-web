/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

//! The per-cell decode kernel (ADR 0029): nine samples through the
//! homography, the mean colour, the nearest palette symbol and its
//! confidence. The GPU shader in `src/packages/optical-modem/lib/shader.ts`
//! does the same arithmetic and has to give the same bytes.
//!
//! Sample coordinates use 32-bit float steps in a fixed order (each product,
//! sum and quotient rounded to `f32`); sums, means, distances and
//! confidences are integers.

use crate::colour::luma;
use crate::layout::Grid;
use crate::Image;

/// Where inside a cell the nine samples fall, as fractions of the cell.
pub const SAMPLE_OFFSETS: [f64; 3] = [0.3125, 0.5, 0.6875];

/// Distance weights for the red, green and blue differences.
pub const CHANNEL_WEIGHTS: [i64; 3] = [3, 4, 2];

/// The pixel row or column a coordinate falls in, clamped to the image. Equal
/// to clamping `floor(coordinate)`: below 1 it is 0, and above that the
/// truncation is the floor (infinities saturate).
#[inline]
fn pixel_index(coordinate: f32, size: usize) -> usize {
    if coordinate < 1.0 {
        return 0;
    }
    (coordinate as usize).min(size - 1)
}

/// The three `h[a] * t + ...` products of one coordinate, in `f32`.
#[inline]
fn products(h: &[f32; 9], first: usize, t: f64) -> [[f32; 3]; 3] {
    SAMPLE_OFFSETS.map(|d| {
        let t = (t + d) as f32;
        [h[first] * t, h[first + 3] * t, h[first + 6] * t]
    })
}

/// [`sample_cell`] from the column's and the row's products.
///
/// Every step is one `f32` operation. The TypeScript reference rounded each
/// step from `f64` to `f32` (`Math.fround`); for one `+`, `*` or `/` of two
/// `f32` values that double rounding gives the correctly rounded `f32`
/// result, so the bytes are the same. The offsets added to whole cell
/// indexes are exact in `f32`.
#[inline]
fn sample_products(
    image: &Image,
    h: &[f32; 9],
    us: &[[f32; 3]; 3],
    vs: &[[f32; 3]; 3],
) -> [u32; 3] {
    let mut sum = [0u32; 3];
    for v in vs {
        for u in us {
            let w = (u[2] + v[2]) + 1.0;
            let x = ((u[0] + v[0]) + h[2]) / w;
            let y = ((u[1] + v[1]) + h[5]) / w;
            if x.is_nan() || y.is_nan() {
                return [0, 0, 0];
            }
            let px = pixel_index(x, image.width);
            let py = pixel_index(y, image.height);
            let i = (py * image.width + px) * 4;
            sum[0] += image.data[i] as u32;
            sum[1] += image.data[i + 1] as u32;
            sum[2] += image.data[i + 2] as u32;
        }
    }
    sum.map(|s| (s + 4) / 9)
}

/// The mean red, green and blue (integers, 0 to 255) of cell (`col`, `row`).
/// A sample whose coordinate is not a number spoils the whole cell, which
/// then reads as 0, 0, 0, as it did in TypeScript.
pub fn sample_cell(image: &Image, h: &[f32; 9], col: f64, row: f64) -> [u32; 3] {
    sample_products(image, h, &products(h, 0, col), &products(h, 1, row))
}

/// The mean of calibration patch `p` over its cells in both strips.
pub fn read_patch(image: &Image, h: &[f32; 9], grid: &Grid, p: u32) -> [i32; 3] {
    let mut sum = [0u32; 3];
    let mut count = 0u32;
    for bottom in [false, true] {
        for i in 0..8 {
            let (col, row) = grid.patch_cell(p, i, bottom);
            let cell = sample_cell(image, h, col as f64, row as f64);
            for c in 0..3 {
                sum[c] += cell[c];
            }
            count += 1;
        }
    }
    sum.map(|s| ((s + (count >> 1)) / count) as i32)
}

/// The luma halfway between the black and white patches.
pub fn reference_midpoint(black: &[i32; 3], white: &[i32; 3]) -> i32 {
    let l = |c: &[i32; 3]| luma(c[0] as u32, c[1] as u32, c[2] as u32) as i32;
    (l(black) + l(white)) >> 1
}

/// The best palette symbol for a colour and the confidence, 0 to 255: how
/// far the best match is ahead of the runner-up.
pub fn classify(r: u32, g: u32, b: u32, palette: &[i32]) -> (u8, u8) {
    if r > 255 || g > 255 || b > 255 || !palette_in_range(palette) {
        return classify_wide(r, g, b, palette);
    }
    classify_bytes(r as i32, g as i32, b as i32, palette)
}

fn palette_in_range(palette: &[i32]) -> bool {
    palette.iter().all(|c| (0..=255).contains(c))
}

/// [`classify`] for a colour and palette in 0..=255. Distances stay below
/// 9 * 255^2, so `i32` holds every value exactly.
#[inline]
fn classify_bytes(r: i32, g: i32, b: i32, palette: &[i32]) -> (u8, u8) {
    let mut best = 0usize;
    let mut best_distance = i32::MAX;
    let mut second = i32::MAX;
    for (s, colour) in palette.chunks_exact(3).enumerate() {
        let dr = r - colour[0];
        let dg = g - colour[1];
        let db = b - colour[2];
        let d = CHANNEL_WEIGHTS[0] as i32 * dr * dr
            + CHANNEL_WEIGHTS[1] as i32 * dg * dg
            + CHANNEL_WEIGHTS[2] as i32 * db * db;
        let closer = d < best_distance;
        second = if closer { best_distance } else { second.min(d) };
        best = if closer { s } else { best };
        best_distance = if closer { d } else { best_distance };
    }
    let confidence = if second == i32::MAX {
        0
    } else {
        (255 * (second - best_distance) / (second + best_distance + 1)) as u8
    };
    (best as u8, confidence)
}

/// [`classify`] in `i64`, for inputs outside the byte range.
fn classify_wide(r: u32, g: u32, b: u32, palette: &[i32]) -> (u8, u8) {
    let mut best = 0usize;
    let mut best_distance = i64::MAX;
    let mut second = i64::MAX;
    for (s, colour) in palette.chunks_exact(3).enumerate() {
        let dr = r as i64 - colour[0] as i64;
        let dg = g as i64 - colour[1] as i64;
        let db = b as i64 - colour[2] as i64;
        let d = CHANNEL_WEIGHTS[0] * dr * dr
            + CHANNEL_WEIGHTS[1] * dg * dg
            + CHANNEL_WEIGHTS[2] * db * db;
        if d < best_distance {
            second = best_distance;
            best_distance = d;
            best = s;
        } else if d < second {
            second = d;
        }
    }
    let confidence = if second == i64::MAX {
        0
    } else {
        (255 * (second - best_distance) / (second + best_distance + 1)) as u8
    };
    (best as u8, confidence)
}

/// Samples and classifies every data cell: symbols, confidences and three
/// mean bytes per cell go to the three slices.
#[allow(clippy::too_many_arguments)]
pub fn sample_grid(
    image: &Image,
    h: &[f32; 9],
    cols: u32,
    row_offset: u32,
    palette: &[i32],
    symbols: &mut [u8],
    confidence: &mut [u8],
    means: &mut [u8],
) {
    let cols = cols as usize;
    let bytes = palette_in_range(palette);
    let mut vs = products(h, 1, row_offset as f64);
    for i in 0..symbols.len() {
        let col = i % cols;
        if col == 0 && i > 0 {
            vs = products(h, 1, (row_offset as usize + i / cols) as f64);
        }
        let cell = sample_products(image, h, &products(h, 0, col as f64), &vs);
        // A cell's mean is a byte, so only the palette can need the wide path.
        let (symbol, sure) = if bytes {
            classify_bytes(cell[0] as i32, cell[1] as i32, cell[2] as i32, palette)
        } else {
            classify_wide(cell[0], cell[1], cell[2], palette)
        };
        symbols[i] = symbol;
        confidence[i] = sure;
        means[i * 3] = cell[0] as u8;
        means[i * 3 + 1] = cell[1] as u8;
        means[i * 3 + 2] = cell[2] as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_against_the_palette() {
        let palette = [0, 0, 0, 255, 255, 255];
        assert_eq!(classify(10, 10, 10, &palette).0, 0);
        assert_eq!(classify(250, 250, 250, &palette).0, 1);
        assert_eq!(classify(0, 0, 0, &palette), (0, 254));
        assert_eq!(classify(128, 128, 127, &palette), (1, 1));
        assert_eq!(
            classify(300, 0, 0, &palette),
            classify_wide(300, 0, 0, &palette)
        );
    }

    #[test]
    fn byte_classification_matches_the_wide_one() {
        let mut state = 0x1198u32;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state
        };
        for round in 0..20_000 {
            let size = 2 + (round % 15);
            let palette: alloc::vec::Vec<i32> =
                (0..size * 3).map(|_| (next() & 255) as i32).collect();
            // Ties and extremes as well as random colours.
            let (r, g, b) = match round % 4 {
                0 => (palette[0] as u32, palette[1] as u32, palette[2] as u32),
                1 => (255, 0, 255),
                _ => (next() & 255, next() & 255, next() & 255),
            };
            assert_eq!(
                classify(r, g, b, &palette),
                classify_wide(r, g, b, &palette)
            );
        }
    }

    #[test]
    fn samples_through_an_identity_map() {
        let mut data = alloc::vec![0u8; 8 * 8 * 4];
        for (i, px) in data.chunks_exact_mut(4).enumerate() {
            px[0] = i as u8;
            px[1] = 7;
            px[2] = 255;
        }
        let image = Image {
            data: &data,
            width: 8,
            height: 8,
        };
        let h = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        // Cell (2, 3) samples pixel (2, 3) nine times.
        assert_eq!(sample_cell(&image, &h, 2.0, 3.0), [26, 7, 255]);
        let nan = [f32::NAN, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
        assert_eq!(sample_cell(&image, &nan, 2.0, 3.0), [0, 0, 0]);
    }
}
