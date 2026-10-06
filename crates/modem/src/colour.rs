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

//! Colour arithmetic: integer luma and sRGB to OKLab built only from
//! `+ - * /` (Newton's method for the roots), so every engine gives the same
//! bits. The operations run in the order the TypeScript modem used.

use crate::fmath::{js_round, sqrt};

/// Integer luma (Rec. 601 weights in 8-bit fixed point).
#[inline]
pub fn luma(r: u32, g: u32, b: u32) -> u32 {
    (77 * r + 150 * g + 29 * b) >> 8
}

/// Cube root by Newton's method with a fixed iteration count, started above
/// the root so the sequence falls monotonically. 0 for anything not positive.
/// Each step depends on `y` alone, so once a step leaves `y` unchanged every
/// later one would too: stopping there gives the same bits as all 40 steps.
pub fn cube_root(x: f64) -> f64 {
    if x.is_nan() || x <= 0.0 {
        return 0.0;
    }
    let mut y = if x > 1.0 { x } else { 1.0 };
    for _ in 0..40 {
        let next = (2.0 * y + x / (y * y)) / 3.0;
        if next == y {
            break;
        }
        y = next;
    }
    y
}

const fn fifth_root(x: f64) -> f64 {
    if x.is_nan() || x <= 0.0 {
        return 0.0;
    }
    let mut y = if x > 1.0 { x } else { 1.0 };
    let mut i = 0;
    while i < 60 {
        let y2 = y * y;
        y = (4.0 * y + x / (y2 * y2)) / 5.0;
        i += 1;
    }
    y
}

const fn linear_table() -> [f64; 256] {
    let mut table = [0.0; 256];
    let mut i = 0;
    while i < 256 {
        let c = i as f64 / 255.0;
        table[i] = if c <= 0.04045 {
            c / 12.92
        } else {
            let a = (c + 0.055) / 1.055;
            // a^2.4 = a^2 * a^(2/5)
            a * a * fifth_root(a * a)
        };
        i += 1;
    }
    table
}

/// The sRGB transfer function for each 8-bit value, evaluated at compile
/// time with IEEE arithmetic.
static LINEAR: [f64; 256] = linear_table();

/// Linear light from 0 to 1 for a channel value (rounded and clamped to 0 to 255).
pub fn srgb_to_linear(value: f64) -> f64 {
    let rounded = js_round(value);
    LINEAR[rounded.clamp(0.0, 255.0) as usize]
}

/// An sRGB colour (channels 0 to 255) in OKLab.
pub fn rgb_to_oklab(r: f64, g: f64, b: f64) -> [f64; 3] {
    let r = srgb_to_linear(r);
    let g = srgb_to_linear(g);
    let b = srgb_to_linear(b);
    let l = cube_root(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    let m = cube_root(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    let s = cube_root(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
}

/// Euclidean distance between two OKLab colours.
pub fn lab_distance(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    let dl = a[0] - b[0];
    let da = a[1] - b[1];
    let db = a[2] - b[2];
    sqrt(dl * dl + da * da + db * db)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_values() {
        assert_eq!(luma(255, 255, 255), 255);
        assert_eq!(luma(0, 0, 0), 0);
        assert_eq!(srgb_to_linear(0.0), 0.0);
        assert!((srgb_to_linear(255.0) - 1.0).abs() < 1e-15);
        let white = rgb_to_oklab(255.0, 255.0, 255.0);
        assert!((white[0] - 1.0).abs() < 1e-6 && white[1].abs() < 1e-6);
        assert!((cube_root(27.0) - 3.0).abs() < 1e-15);
        assert_eq!(cube_root(-1.0), 0.0);
    }

    #[test]
    fn cube_root_matches_all_forty_steps() {
        let full = |x: f64| {
            let mut y = if x > 1.0 { x } else { 1.0 };
            for _ in 0..40 {
                y = (2.0 * y + x / (y * y)) / 3.0;
            }
            y
        };
        let mut x = 1e-9;
        while x < 1e4 {
            assert_eq!(cube_root(x).to_bits(), full(x).to_bits(), "{x}");
            x *= 1.000_37;
        }
        for r in (1..256).step_by(5) {
            for g in (0..256).step_by(7) {
                let x = 0.4122214708 * srgb_to_linear(r as f64)
                    + 0.5363325363 * srgb_to_linear(g as f64);
                assert_eq!(cube_root(x).to_bits(), full(x).to_bits(), "{x}");
            }
        }
    }
}
