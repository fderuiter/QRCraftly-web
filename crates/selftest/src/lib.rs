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

//! A tiny module that proves the toolchain, the committed build, the loader
//! and the calling convention work end to end (#1182). Feature modules copy
//! its shape.

#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

use qrcraftly_core::abi::{STATUS_BAD_INPUT, STATUS_BUFFER_TOO_SMALL, STATUS_OK};
use qrcraftly_core::{crc32, gf256};

/// Builds a slice from a pointer and length, treating a null or empty input as empty.
///
/// # Safety
/// `ptr..ptr + len` must be readable linear memory.
unsafe fn input<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        // SAFETY: guaranteed by the caller.
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
}

/// CRC-32 of `len` bytes at `ptr`.
///
/// # Safety
/// `ptr..ptr + len` must be readable linear memory.
#[no_mangle]
pub unsafe extern "C" fn selftest_crc32(ptr: *const u8, len: usize) -> u32 {
    // SAFETY: forwarded from the caller.
    crc32::checksum(unsafe { input(ptr, len) })
}

/// The GF(256) product of `a` and `b`; only the low byte of each is used.
#[no_mangle]
pub extern "C" fn selftest_gf_mul(a: u32, b: u32) -> u32 {
    gf256::mul(a as u8, b as u8) as u32
}

/// Multiplies every input byte by `factor` in GF(256) and writes the result to
/// `out`. Returns a status code; `factor` 0 is rejected to exercise the error path.
///
/// # Safety
/// `in_ptr..in_ptr + len` must be readable and `out_ptr..out_ptr + out_len` writable.
#[no_mangle]
pub unsafe extern "C" fn selftest_scale(
    in_ptr: *const u8,
    len: usize,
    factor: u32,
    out_ptr: *mut u8,
    out_len: usize,
) -> i32 {
    if factor == 0 || factor > 255 {
        return STATUS_BAD_INPUT;
    }
    if out_len < len || (len > 0 && out_ptr.is_null()) {
        return STATUS_BUFFER_TOO_SMALL;
    }
    // SAFETY: forwarded from the caller.
    let src = unsafe { input(in_ptr, len) };
    for (i, &byte) in src.iter().enumerate() {
        // SAFETY: i < len <= out_len.
        unsafe { *out_ptr.add(i) = gf256::mul(byte, factor as u8) };
    }
    STATUS_OK
}

/// Always traps, so the loader's error path can be tested.
#[no_mangle]
pub extern "C" fn selftest_trap() -> u32 {
    panic!("selftest_trap")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc32_export_matches_the_check_value() {
        let data = b"123456789";
        assert_eq!(
            unsafe { selftest_crc32(data.as_ptr(), data.len()) },
            0xCBF4_3926
        );
        assert_eq!(unsafe { selftest_crc32(core::ptr::null(), 0) }, 0);
    }

    #[test]
    fn scale_writes_products_and_reports_errors() {
        let data = [0u8, 1, 2, 0x80];
        let mut out = [0u8; 4];
        let status = unsafe { selftest_scale(data.as_ptr(), 4, 2, out.as_mut_ptr(), 4) };
        assert_eq!(status, STATUS_OK);
        assert_eq!(out, [0, 2, 4, 0x1d]);
        assert_eq!(
            unsafe { selftest_scale(data.as_ptr(), 4, 0, out.as_mut_ptr(), 4) },
            STATUS_BAD_INPUT
        );
        assert_eq!(
            unsafe { selftest_scale(data.as_ptr(), 4, 2, out.as_mut_ptr(), 3) },
            STATUS_BUFFER_TOO_SMALL
        );
    }

    #[test]
    fn gf_mul_uses_the_low_byte() {
        assert_eq!(selftest_gf_mul(0x102, 0x80), 0x1d);
    }
}
