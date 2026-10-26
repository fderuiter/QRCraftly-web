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

//! The optical print simulation (#1248, #1556): what a phone camera sees when
//! it looks at a print of the code. Paper luma, a bilinear resample of the
//! code's corners at six pixels a module, a three-pass box blur that stands in
//! for ink spread and a soft camera, and seeded sensor noise. It gives the same
//! bytes as `src/packages/scannability/lib/opticalSimulation.ts`, which stays
//! as the reference the differential test compares against.
//!
//! Exports, over the shared calling convention (`crates/core/src/abi.rs`):
//!
//! - `optical_sim_side(version)` returns the simulated frame's side in pixels,
//!   or 0 for a version outside 1 to 40.
//! - `optical_sim_print(rgba, len, width, height, version, taps, tlx, tly,
//!   trx, try_, brx, bry, blx, bly, out, out_len)` writes the grey frame to
//!   `out` and returns a status code.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod sim;

use qrcraftly_core::abi::{STATUS_BAD_INPUT, STATUS_BUFFER_TOO_SMALL, STATUS_OK};
use sim::{Point, Request, SimError};

/// The simulated frame's side in pixels, or 0 for a version outside 1 to 40.
#[no_mangle]
pub extern "C" fn optical_sim_side(version: u32) -> u32 {
    sim::output_side(version).map_or(0, |side| side as u32)
}

/// Simulates a print of the code at the given corners and writes the grey
/// frame, `optical_sim_side(version)` pixels a side, to `out`.
///
/// # Safety
/// `rgba..rgba + len` must be readable and `out..out + out_len` writable linear memory.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn optical_sim_print(
    rgba: *const u8,
    len: usize,
    width: u32,
    height: u32,
    version: u32,
    taps: u32,
    tlx: f64,
    tly: f64,
    trx: f64,
    try_: f64,
    brx: f64,
    bry: f64,
    blx: f64,
    bly: f64,
    out: *mut u8,
    out_len: usize,
) -> i32 {
    if rgba.is_null() || out.is_null() {
        return STATUS_BAD_INPUT;
    }
    // SAFETY: guaranteed by the caller.
    let rgba = unsafe { core::slice::from_raw_parts(rgba, len) };
    // SAFETY: guaranteed by the caller.
    let out = unsafe { core::slice::from_raw_parts_mut(out, out_len) };
    let request = Request {
        rgba,
        width: width as usize,
        height: height as usize,
        version,
        taps,
        corners: [
            Point { x: tlx, y: tly },
            Point { x: trx, y: try_ },
            Point { x: brx, y: bry },
            Point { x: blx, y: bly },
        ],
    };
    match sim::simulate_print(&request, out) {
        Ok(_) => STATUS_OK,
        Err(SimError::BadInput) => STATUS_BAD_INPUT,
        Err(SimError::BufferTooSmall) => STATUS_BUFFER_TOO_SMALL,
    }
}
