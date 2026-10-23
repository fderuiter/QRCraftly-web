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

//! Cryptographic address validation and hash kernels for QRCraftly.
//!
//! Provides SHA-256, Keccak-256, Base58Check, Bech32/Bech32m and wallet address
//! checksum verification over linear memory for the WASM runtime.
//!
//! Note: These hashes and checksums are used solely for offline wallet address
//! validation, not for security purposes (ADR 0040 forbids custom cryptography
//! for security purposes).

#![cfg_attr(target_arch = "wasm32", no_std)]
#![forbid(unsafe_op_in_unsafe_fn)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod address;
pub mod base58;
pub mod bech32;
pub mod keccak256;
pub use qrcraftly_core::sha256;

use address::{ADDRESS_INVALID, ADDRESS_UNCHECKED};
use qrcraftly_core::abi::{STATUS_BAD_INPUT, STATUS_BUFFER_TOO_SMALL, STATUS_OK};

unsafe fn input<'a>(ptr: *const u8, len: usize) -> Option<&'a [u8]> {
    if len == 0 {
        Some(&[])
    } else if ptr.is_null() {
        None
    } else {
        // SAFETY: guaranteed by caller if ptr is valid for len bytes.
        Some(unsafe { core::slice::from_raw_parts(ptr, len) })
    }
}

/// SHA-256 digest of `in_len` bytes at `in_ptr`. Writes 32 bytes to `out_ptr`.
///
/// # Safety
/// `in_ptr..in_ptr + in_len` must be readable and `out_ptr..out_ptr + out_len` writable.
#[no_mangle]
pub unsafe extern "C" fn crypto_sha256(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> i32 {
    if out_len < 32 {
        return STATUS_BUFFER_TOO_SMALL;
    }
    if out_ptr.is_null() {
        return STATUS_BAD_INPUT;
    }
    let Some(input_bytes) = (unsafe { input(in_ptr, in_len) }) else {
        return STATUS_BAD_INPUT;
    };
    let digest = sha256::sha256(input_bytes);
    unsafe {
        core::ptr::copy_nonoverlapping(digest.as_ptr(), out_ptr, 32);
    }
    STATUS_OK
}

/// Keccak-256 digest of `in_len` bytes at `in_ptr`. Writes 32 bytes to `out_ptr`.
///
/// # Safety
/// `in_ptr..in_ptr + in_len` must be readable and `out_ptr..out_ptr + out_len` writable.
#[no_mangle]
pub unsafe extern "C" fn crypto_keccak256(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> i32 {
    if out_len < 32 {
        return STATUS_BUFFER_TOO_SMALL;
    }
    if out_ptr.is_null() {
        return STATUS_BAD_INPUT;
    }
    let Some(input_bytes) = (unsafe { input(in_ptr, in_len) }) else {
        return STATUS_BAD_INPUT;
    };
    let digest = keccak256::keccak256(input_bytes);
    unsafe {
        core::ptr::copy_nonoverlapping(digest.as_ptr(), out_ptr, 32);
    }
    STATUS_OK
}

/// Validates a cryptocurrency address checksum for a network.
/// Returns 0 for valid, 1 for invalid, 2 for unchecked.
///
/// # Safety
/// `net_ptr..net_ptr + net_len` and `addr_ptr..addr_ptr + addr_len` must be readable linear memory.
#[no_mangle]
pub unsafe extern "C" fn crypto_validate_address(
    net_ptr: *const u8,
    net_len: usize,
    addr_ptr: *const u8,
    addr_len: usize,
) -> i32 {
    let Some(net_bytes) = (unsafe { input(net_ptr, net_len) }) else {
        return ADDRESS_INVALID;
    };
    let Some(addr_bytes) = (unsafe { input(addr_ptr, addr_len) }) else {
        return ADDRESS_INVALID;
    };
    let Ok(net_str) = core::str::from_utf8(net_bytes) else {
        return ADDRESS_UNCHECKED;
    };
    let Ok(addr_str) = core::str::from_utf8(addr_bytes) else {
        return ADDRESS_INVALID;
    };
    address::validate_address(net_str, addr_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::String;

    fn to_hex(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for &b in bytes {
            use core::fmt::Write;
            write!(s, "{:02x}", b).unwrap();
        }
        s
    }

    #[test]
    fn test_crypto_sha256_export() {
        let msg = b"123456789";
        let mut out = [0u8; 32];
        let status = unsafe { crypto_sha256(msg.as_ptr(), msg.len(), out.as_mut_ptr(), out.len()) };
        assert_eq!(status, STATUS_OK);
        assert_eq!(
            to_hex(&out),
            "15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225"
        );
    }

    #[test]
    fn test_crypto_validate_address_export() {
        let net = b"bitcoin";
        let addr = b"1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2";
        let status =
            unsafe { crypto_validate_address(net.as_ptr(), net.len(), addr.as_ptr(), addr.len()) };
        assert_eq!(status, 0);
    }
}
