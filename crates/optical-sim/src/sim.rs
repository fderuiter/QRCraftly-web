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

//! The simulation itself, a line-for-line port of
//! `src/packages/scannability/lib/opticalSimulation.ts`.
//!
//! The TypeScript computes in `f64` and keeps its planes in `Float32Array`s,
//! so every store rounds to `f32` and every load widens back. This port does
//! the same, in the same order, so it gives the same bytes: Rust never fuses
//! a multiply and an add, and `as f32` rounds to nearest even as a
//! `Float32Array` store does.

use alloc::vec;

/// Pixels a module in the simulated camera frame.
pub const PX_PER_MODULE: usize = 6;
/// Quiet zone kept around the code, in modules.
pub const QUIET_ZONE_MODULES: usize = 4;
/// Grey level of white paper in a photo.
const PAPER_LEVEL: f64 = 235.0;
/// Grey level of black ink in a photo.
const INK_LEVEL: f64 = 25.0;
/// Sensor noise, peak to peak, in grey levels.
const NOISE_LEVEL: f64 = 10.0;
/// Seed for the sensor noise.
const NOISE_SEED: u32 = 0x51c0de;
/// Most samples a simulated pixel averages along each axis.
pub const MAX_TAPS: u32 = 3;
/// Radii of the three box passes that approximate a Gaussian of 0.3 modules
/// (1.8 pixels): `gaussianBoxWidths(1.8)` is `[3, 3, 5]` in the TypeScript.
pub const BOX_RADII: [usize; 3] = [1, 1, 2];

/// Highest QR version.
const MAX_VERSION: u32 = 40;

/// The simulated frame's side in pixels for a QR version, or `None` outside 1 to 40.
pub fn output_side(version: u32) -> Option<usize> {
    if !(1..=MAX_VERSION).contains(&version) {
        return None;
    }
    let modules = 17 + 4 * version as usize;
    Some((modules + 2 * QUIET_ZONE_MODULES) * PX_PER_MODULE)
}

/// A point in frame pixels.
#[derive(Clone, Copy, Debug)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// The rendered design and where a decode found the code in it.
pub struct Request<'a> {
    /// RGBA pixels, row by row.
    pub rgba: &'a [u8],
    pub width: usize,
    pub height: usize,
    pub version: u32,
    /// Samples a simulated pixel averages along each axis, 1 to [`MAX_TAPS`].
    /// The caller works it out, as the TypeScript does with `Math.hypot`.
    pub taps: u32,
    /// Outer module corners, clockwise from top left.
    pub corners: [Point; 4],
}

/// Why a request cannot run.
#[derive(Debug, PartialEq, Eq)]
pub enum SimError {
    BadInput,
    BufferTooSmall,
}

/// Rounds towards negative infinity, for values well inside `i64`.
#[inline]
fn floor(x: f64) -> f64 {
    let t = x as i64 as f64;
    if t > x {
        t - 1.0
    } else {
        t
    }
}

/// A `Uint8ClampedArray` store: NaN is 0, the value is clamped to 0..=255 and
/// rounded to nearest, ties to even.
#[inline]
fn clamped_byte(v: f64) -> u8 {
    if v.is_nan() || v <= 0.0 {
        return 0;
    }
    if v >= 255.0 {
        return 255;
    }
    let f = v as u32;
    let frac = v - f as f64;
    let up = frac > 0.5 || (frac == 0.5 && f & 1 == 1);
    (f + up as u32) as u8
}

/// The frame's grey levels as seen on paper: transparent pixels show the paper.
fn paper_plane(rgba: &[u8], plane: &mut [f32]) {
    for (p, px) in plane.iter_mut().zip(rgba.chunks_exact(4)) {
        let alpha = px[3] as f64 / 255.0;
        let luma = (306.0 * px[0] as f64 + 601.0 * px[1] as f64 + 117.0 * px[2] as f64) / 1024.0;
        *p = (luma * alpha + 255.0 * (1.0 - alpha)) as f32;
    }
}

/// Bilinear grey level at a point in frame pixels (pixel centres at
/// half-integers); paper outside the frame.
fn sample_luma(plane: &[f32], width: usize, height: usize, x: f64, y: f64) -> f64 {
    let fx = x - 0.5;
    let fy = y - 0.5;
    let x0 = floor(fx);
    let y0 = floor(fy);
    let ax = fx - x0;
    let ay = fy - y0;
    let (w, h) = (width as f64, height as f64);
    let in_x0 = x0 >= 0.0 && x0 < w;
    let in_x1 = x0 + 1.0 >= 0.0 && x0 + 1.0 < w;
    let at = |row: usize, col: f64, inside: bool| {
        if inside {
            plane[row + col as usize] as f64
        } else {
            255.0
        }
    };
    let mut top = 255.0 * (1.0 - ay);
    let mut bottom = 255.0 * ay;
    if y0 >= 0.0 && y0 < h {
        let row = y0 as usize * width;
        top = (at(row, x0, in_x0) * (1.0 - ax) + at(row, x0 + 1.0, in_x1) * ax) * (1.0 - ay);
    }
    if y0 + 1.0 >= 0.0 && y0 + 1.0 < h {
        let row = (y0 + 1.0) as usize * width;
        bottom = (at(row, x0, in_x0) * (1.0 - ax) + at(row, x0 + 1.0, in_x1) * ax) * ay;
    }
    top + bottom
}

/// One box blur pass along every row or every column of a square frame,
/// repeating edge pixels.
fn box_pass(src: &[f32], dst: &mut [f32], side: usize, radius: usize, along_rows: bool) {
    let width = (2 * radius + 1) as f64;
    let last = side - 1;
    let step = if along_rows { 1 } else { side };
    for line in 0..side {
        let base = if along_rows { line * side } else { line };
        let mut sum = 0.0f64;
        for k in -(radius as isize)..=radius as isize {
            sum += src[base + (k.max(0) as usize).min(last) * step] as f64;
        }
        for k in 0..side {
            dst[base + k * step] = (sum / width) as f32;
            let enter = (k + radius + 1).min(last);
            let leave = k.saturating_sub(radius);
            sum += src[base + enter * step] as f64 - src[base + leave * step] as f64;
        }
    }
}

/// mulberry32, as in the TypeScript, so the noise is the same on every run.
struct Mulberry32(u32);

impl Mulberry32 {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let s = self.0;
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }
}

/// Simulates a phone camera looking at a print of the code and writes the
/// grey frame, `output_side(version)` pixels a side, to `out`.
pub fn simulate_print(req: &Request, out: &mut [u8]) -> Result<usize, SimError> {
    let side = output_side(req.version).ok_or(SimError::BadInput)?;
    let pixels = req
        .width
        .checked_mul(req.height)
        .ok_or(SimError::BadInput)?;
    if pixels == 0
        || req.rgba.len() != pixels * 4
        || !(1..=MAX_TAPS).contains(&req.taps)
        || req
            .corners
            .iter()
            .any(|p| !p.x.is_finite() || !p.y.is_finite())
    {
        return Err(SimError::BadInput);
    }
    let count = side * side;
    if out.len() < count {
        return Err(SimError::BufferTooSmall);
    }

    let mut source = vec![0.0f32; pixels];
    paper_plane(req.rgba, &mut source);
    let mut luma = vec![0.0f32; count];
    let mut temp = vec![0.0f32; count];

    let modules = (17 + 4 * req.version) as f64;
    let taps = req.taps as usize;
    let scale = (PX_PER_MODULE * taps) as f64;
    let quiet = QUIET_ZONE_MODULES as f64;
    let range = (PAPER_LEVEL - INK_LEVEL) / 255.0;
    let [tl, tr, br, bl] = req.corners;
    for oy in 0..side {
        for ox in 0..side {
            let mut sum = 0.0f64;
            for sy in 0..taps {
                let t = (((oy * taps + sy) as f64 + 0.5) / scale - quiet) / modules;
                for sx in 0..taps {
                    let s = (((ox * taps + sx) as f64 + 0.5) / scale - quiet) / modules;
                    let st = s * t;
                    let x = tl.x
                        + s * (tr.x - tl.x)
                        + t * (bl.x - tl.x)
                        + st * (br.x - tr.x - bl.x + tl.x);
                    let y = tl.y
                        + s * (tr.y - tl.y)
                        + t * (bl.y - tl.y)
                        + st * (br.y - tr.y - bl.y + tl.y);
                    sum += sample_luma(&source, req.width, req.height, x, y);
                }
            }
            luma[oy * side + ox] = (INK_LEVEL + range * (sum / (taps * taps) as f64)) as f32;
        }
    }

    for radius in BOX_RADII {
        box_pass(&luma, &mut temp, side, radius, true);
        box_pass(&temp, &mut luma, side, radius, false);
    }

    let mut random = Mulberry32(NOISE_SEED);
    for (o, &l) in out.iter_mut().zip(luma.iter()) {
        *o = clamped_byte(l as f64 + (random.next() - 0.5) * NOISE_LEVEL);
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sides_follow_the_version() {
        assert_eq!(output_side(1), Some((21 + 8) * 6));
        assert_eq!(output_side(40), Some((177 + 8) * 6));
        assert_eq!(output_side(0), None);
        assert_eq!(output_side(41), None);
    }

    #[test]
    fn clamped_bytes_round_like_uint8_clamped_array() {
        assert_eq!(clamped_byte(f64::NAN), 0);
        assert_eq!(clamped_byte(-3.0), 0);
        assert_eq!(clamped_byte(0.5), 0);
        assert_eq!(clamped_byte(1.5), 2);
        assert_eq!(clamped_byte(2.5), 2);
        assert_eq!(clamped_byte(2.500_001), 3);
        assert_eq!(clamped_byte(254.5), 254);
        assert_eq!(clamped_byte(254.6), 255);
        assert_eq!(clamped_byte(1e9), 255);
    }

    #[test]
    fn floor_matches_the_maths() {
        for (x, want) in [
            (1.5, 1.0),
            (-0.5, -1.0),
            (-1.0, -1.0),
            (0.0, 0.0),
            (-0.0, 0.0),
            (7.0, 7.0),
        ] {
            assert_eq!(floor(x), want);
        }
    }

    #[test]
    fn mulberry32_stays_in_the_unit_interval() {
        // Bit-for-bit agreement with the TypeScript is checked by the differential test
        // (src/packages/scannability/tests/opticalSimDifferential.test.ts).
        let mut random = Mulberry32(NOISE_SEED);
        let first: [f64; 3] = [random.next(), random.next(), random.next()];
        for value in first {
            assert!((0.0..1.0).contains(&value));
        }
        assert_ne!(first[0], first[1]);
    }

    #[test]
    fn box_radii_match_the_gaussian_widths() {
        // gaussianBoxWidths(sigma) for sigma = 0.3 modules × 6 pixels, three passes.
        let sigma = 0.3 * PX_PER_MODULE as f64;
        let n = 3.0;
        let ideal_sq = (12.0 * sigma * sigma) / n + 1.0;
        let mut lower = 1usize;
        while ((lower + 1) * (lower + 1)) as f64 <= ideal_sq {
            lower += 1;
        }
        if lower.is_multiple_of(2) {
            lower -= 1;
        }
        let l = lower as f64;
        let lower_count =
            (12.0 * sigma * sigma - n * l * l - 4.0 * n * l - 3.0 * n) / (-4.0 * l - 4.0);
        let lower_count = floor(lower_count + 0.5) as usize;
        // Widths are `lower` for the first `lower_count` passes and `lower + 2` after; a width w is radius (w - 1) / 2.
        let radii: [usize; 3] = core::array::from_fn(|i| {
            if i < lower_count {
                (lower - 1) / 2
            } else {
                lower.div_ceil(2)
            }
        });
        assert_eq!(radii, BOX_RADII);
    }

    #[test]
    fn rejects_bad_requests() {
        let rgba = [255u8; 4 * 4];
        let corners = [
            Point { x: 0.0, y: 0.0 },
            Point { x: 2.0, y: 0.0 },
            Point { x: 2.0, y: 2.0 },
            Point { x: 0.0, y: 2.0 },
        ];
        let mut out = vec![0u8; output_side(1).unwrap().pow(2)];
        let ok = Request {
            rgba: &rgba,
            width: 2,
            height: 2,
            version: 1,
            taps: 1,
            corners,
        };
        assert!(simulate_print(&ok, &mut out).is_ok());
        let bad_version = Request { version: 41, ..ok };
        assert_eq!(
            simulate_print(&bad_version, &mut out),
            Err(SimError::BadInput)
        );
        let bad_taps = Request {
            rgba: &rgba,
            width: 2,
            height: 2,
            version: 1,
            taps: 4,
            corners,
        };
        assert_eq!(simulate_print(&bad_taps, &mut out), Err(SimError::BadInput));
        let bad_size = Request {
            rgba: &rgba[..12],
            width: 2,
            height: 2,
            version: 1,
            taps: 1,
            corners,
        };
        assert_eq!(simulate_print(&bad_size, &mut out), Err(SimError::BadInput));
        let nan = Request {
            rgba: &rgba,
            width: 2,
            height: 2,
            version: 1,
            taps: 1,
            corners: [
                Point {
                    x: f64::NAN,
                    y: 0.0,
                },
                corners[1],
                corners[2],
                corners[3],
            ],
        };
        assert_eq!(simulate_print(&nan, &mut out), Err(SimError::BadInput));
        let ok = Request {
            rgba: &rgba,
            width: 2,
            height: 2,
            version: 1,
            taps: 1,
            corners,
        };
        assert_eq!(
            simulate_print(&ok, &mut out[..10]),
            Err(SimError::BufferTooSmall)
        );
    }

    #[test]
    fn white_paper_stays_near_the_paper_level() {
        let rgba = [255u8; 4 * 16];
        let corners = [
            Point { x: 0.0, y: 0.0 },
            Point { x: 4.0, y: 0.0 },
            Point { x: 4.0, y: 4.0 },
            Point { x: 0.0, y: 4.0 },
        ];
        let side = output_side(1).unwrap();
        let mut out = vec![0u8; side * side];
        let req = Request {
            rgba: &rgba,
            width: 4,
            height: 4,
            version: 1,
            taps: 1,
            corners,
        };
        simulate_print(&req, &mut out).unwrap();
        assert!(out.iter().all(|&v| (229..=241).contains(&v)));
    }
}
