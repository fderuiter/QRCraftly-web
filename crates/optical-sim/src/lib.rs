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

//! Dedicated Rust WebAssembly optical simulation kernel for QRCraftly.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod math;

use alloc::vec;
use qrcraftly_core::abi::{STATUS_BAD_INPUT, STATUS_BUFFER_TOO_SMALL, STATUS_OK};

pub const PRINT_PX_PER_MODULE: usize = 6;
pub const PRINT_QUIET_ZONE_MODULES: usize = 4;
pub const PRINT_BLUR_MODULES: f64 = 0.3;
pub const PRINT_PAPER_LEVEL: f64 = 235.0;
pub const PRINT_INK_LEVEL: f64 = 25.0;
pub const PRINT_NOISE_LEVEL: f64 = 10.0;

const NOISE_SEED: u32 = 0x51c0de;
const MIN_TAPS: usize = 1;
const MAX_TAPS: usize = 3;
const GAUSS_PASSES: usize = 3;

fn paper_plane(frame: &[u8], plane: &mut [f32]) {
    for (p, chunk) in frame.chunks_exact(4).enumerate() {
        let r = chunk[0] as f64;
        let g = chunk[1] as f64;
        let b = chunk[2] as f64;
        let a = chunk[3] as f64;
        let alpha = a / 255.0;
        let luma = (306.0 * r + 601.0 * g + 117.0 * b) / 1024.0;
        plane[p] = (luma * alpha + 255.0 * (1.0 - alpha)) as f32;
    }
}

fn sample_luma(plane: &[f32], width: usize, height: usize, x: f64, y: f64) -> f64 {
    let fx = x - 0.5;
    let fy = y - 0.5;
    let x0 = math::floor(fx) as i32;
    let y0 = math::floor(fy) as i32;
    let ax = fx - (x0 as f64);
    let ay = fy - (y0 as f64);
    let in_x0 = x0 >= 0 && x0 < (width as i32);
    let in_x1 = (x0 + 1) >= 0 && (x0 + 1) < (width as i32);

    let mut top = 255.0 * (1.0 - ay);
    let mut bottom = 255.0 * ay;

    if y0 >= 0 && y0 < (height as i32) {
        let row = (y0 as usize) * width;
        let v0 = if in_x0 {
            plane[row + (x0 as usize)] as f64
        } else {
            255.0
        };
        let v1 = if in_x1 {
            plane[row + ((x0 + 1) as usize)] as f64
        } else {
            255.0
        };
        top = (v0 * (1.0 - ax) + v1 * ax) * (1.0 - ay);
    }
    if (y0 + 1) >= 0 && (y0 + 1) < (height as i32) {
        let row = ((y0 + 1) as usize) * width;
        let v0 = if in_x0 {
            plane[row + (x0 as usize)] as f64
        } else {
            255.0
        };
        let v1 = if in_x1 {
            plane[row + ((x0 + 1) as usize)] as f64
        } else {
            255.0
        };
        bottom = (v0 * (1.0 - ax) + v1 * ax) * ay;
    }
    top + bottom
}

pub fn gaussian_box_widths(sigma: f64) -> [usize; GAUSS_PASSES] {
    let n = GAUSS_PASSES as f64;
    let ideal = math::sqrt((12.0 * sigma * sigma) / n + 1.0);
    let mut lower = math::floor(ideal) as i32;
    if lower % 2 == 0 {
        lower -= 1;
    }
    let lower = lower.max(1) as usize;
    let upper = lower + 2;
    let lower_f = lower as f64;
    let num = 12.0 * sigma * sigma - n * lower_f * lower_f - 4.0 * n * lower_f - 3.0 * n;
    let den = -4.0 * lower_f - 4.0;
    let lower_count = math::round(num / den) as usize;
    let mut widths = [0; GAUSS_PASSES];
    for (i, slot) in widths.iter_mut().enumerate() {
        *slot = if i < lower_count { lower } else { upper };
    }
    widths
}

fn box_pass(src: &[f32], dst: &mut [f32], side: usize, radius: usize, along_rows: bool) {
    let width = (2 * radius + 1) as f64;
    let last = (side - 1) as i32;
    let step = if along_rows { 1 } else { side };
    let radius_i = radius as i32;

    for line in 0..side {
        let base = if along_rows { line * side } else { line };
        let mut sum = 0.0f64;
        for k in -radius_i..=radius_i {
            let idx = k.clamp(0, last) as usize;
            sum += src[base + idx * step] as f64;
        }
        for k in 0..side as i32 {
            dst[base + (k as usize) * step] = (sum / width) as f32;
            let enter = k + radius_i + 1;
            let leave = k - radius_i;
            let enter_idx = enter.min(last) as usize;
            let leave_idx = leave.max(0) as usize;
            sum += (src[base + enter_idx * step] as f64) - (src[base + leave_idx * step] as f64);
        }
    }
}

struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    fn new(seed: u32) -> Self {
        Self { state: seed }
    }

    fn next_f64(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b79f5);
        let mut t = (self.state ^ (self.state >> 15)).wrapping_mul(1 | self.state);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        let val = (t ^ (t >> 14)) as u32;
        (val as f64) / 4294967296.0
    }
}

#[no_mangle]
pub extern "C" fn optical_sim_output_side(version: u32) -> u32 {
    let modules = 17 + 4 * version;
    (modules + 2 * PRINT_QUIET_ZONE_MODULES as u32) * PRINT_PX_PER_MODULE as u32
}

#[no_mangle]
pub extern "C" fn optical_sim_output_capacity(version: u32) -> usize {
    let side = optical_sim_output_side(version) as usize;
    side * side
}

/// Simulates print output for optical scanner analysis.
///
/// # Safety
///
/// The caller must guarantee that:
/// - `frame_ptr` points to at least `frame_width * frame_height * 4` valid, initialized bytes (RGBA).
/// - `out_ptr` points to a mutable buffer of at least `out_len` bytes, which must be at least `optical_sim_output_capacity(version)`.
/// - `frame_ptr` and `out_ptr` do not overlap.
#[no_mangle]
pub unsafe extern "C" fn simulate_print(
    frame_ptr: *const u8,
    frame_width: u32,
    frame_height: u32,
    version: u32,
    tl_x: f32,
    tl_y: f32,
    tr_x: f32,
    tr_y: f32,
    br_x: f32,
    br_y: f32,
    bl_x: f32,
    bl_y: f32,
    out_ptr: *mut u8,
    out_len: usize,
) -> i32 {
    if frame_ptr.is_null() || out_ptr.is_null() || frame_width == 0 || frame_height == 0 {
        return STATUS_BAD_INPUT;
    }
    if !(1..=40).contains(&version) {
        return STATUS_BAD_INPUT;
    }
    let required_cap = optical_sim_output_capacity(version);
    if out_len < required_cap {
        return STATUS_BUFFER_TOO_SMALL;
    }

    let frame_len = (frame_width as usize) * (frame_height as usize) * 4;
    let frame = unsafe { core::slice::from_raw_parts(frame_ptr, frame_len) };
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, out_len) };

    let modules = 17 + 4 * version as usize;
    let side = (modules + 2 * PRINT_QUIET_ZONE_MODULES) * PRINT_PX_PER_MODULE;
    let count = side * side;

    let mut source = vec![0.0f32; (frame_width as usize) * (frame_height as usize)];
    paper_plane(frame, &mut source);

    let mut luma = vec![0.0f32; count];
    let mut temp = vec![0.0f32; count];

    let tl = (tl_x as f64, tl_y as f64);
    let tr = (tr_x as f64, tr_y as f64);
    let br = (br_x as f64, br_y as f64);
    let bl = (bl_x as f64, bl_y as f64);

    let dx1 = tr.0 - tl.0;
    let dy1 = tr.1 - tl.1;
    let h1 = math::sqrt(dx1 * dx1 + dy1 * dy1);

    let dx2 = bl.0 - tl.0;
    let dy2 = bl.1 - tl.1;
    let h2 = math::sqrt(dx2 * dx2 + dy2 * dy2);

    let edge = h1.max(h2);
    let raw_taps = math::ceil(edge / (modules as f64) / (PRINT_PX_PER_MODULE as f64)) as usize;
    let taps = raw_taps.clamp(MIN_TAPS, MAX_TAPS);

    let scale = (PRINT_PX_PER_MODULE * taps) as f64;
    let range = (PRINT_PAPER_LEVEL - PRINT_INK_LEVEL) / 255.0;

    let quiet_zone = PRINT_QUIET_ZONE_MODULES as f64;
    let modules_f = modules as f64;

    for oy in 0..side {
        for ox in 0..side {
            let mut sum = 0.0f64;
            for sy in 0..taps {
                let t = (((oy * taps + sy) as f64 + 0.5) / scale - quiet_zone) / modules_f;
                for sx in 0..taps {
                    let s = (((ox * taps + sx) as f64 + 0.5) / scale - quiet_zone) / modules_f;
                    let st = s * t;
                    let x = tl.0
                        + s * (tr.0 - tl.0)
                        + t * (bl.0 - tl.0)
                        + st * (br.0 - tr.0 - bl.0 + tl.0);
                    let y = tl.1
                        + s * (tr.1 - tl.1)
                        + t * (bl.1 - tl.1)
                        + st * (br.1 - tr.1 - bl.1 + tl.1);
                    sum += sample_luma(&source, frame_width as usize, frame_height as usize, x, y);
                }
            }
            luma[oy * side + ox] =
                (PRINT_INK_LEVEL + range * (sum / ((taps * taps) as f64))) as f32;
        }
    }

    let widths = gaussian_box_widths(PRINT_BLUR_MODULES * (PRINT_PX_PER_MODULE as f64));
    for &width in &widths {
        let radius = (width - 1) / 2;
        if radius == 0 {
            continue;
        }
        box_pass(&luma, &mut temp, side, radius, true);
        box_pass(&temp, &mut luma, side, radius, false);
    }

    let mut random = Mulberry32::new(NOISE_SEED);
    for i in 0..count {
        let noise = (random.next_f64() - 0.5) * PRINT_NOISE_LEVEL;
        out[i] = math::to_uint8_clamp((luma[i] as f64) + noise);
    }

    STATUS_OK
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gaussian_box_widths() {
        let widths = gaussian_box_widths(1.8);
        assert_eq!(widths, [3, 3, 5]);
    }

    #[test]
    fn test_side_and_capacity() {
        assert_eq!(optical_sim_output_side(1), 174);
        assert_eq!(optical_sim_output_capacity(1), 174 * 174);
    }
}
