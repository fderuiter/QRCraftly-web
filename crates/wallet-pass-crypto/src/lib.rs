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

//! Native Rust WebAssembly kernel for PEM parsing, ASN.1 DER, CMS signing and RSA.

#![cfg_attr(target_arch = "wasm32", no_std)]

#[cfg(target_arch = "wasm32")]
extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

#[cfg(not(target_arch = "wasm32"))]
extern crate alloc;

pub mod biguint;
pub mod cms;
pub mod der;
pub mod pem;
pub mod rsa;
pub mod sha256;
pub mod zeroize;

use qrcraftly_core::abi::{STATUS_BAD_INPUT, STATUS_BUFFER_TOO_SMALL, STATUS_OK};
use zeroize::{zeroize_bytes, ZeroizingVec};

/// Safety helper to create a slice from a pointer and length.
unsafe fn input_slice<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if ptr.is_null() || len == 0 {
        &[]
    } else {
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
}

/// Helper to write output bytes into linear memory buffer.
unsafe fn write_output(
    src: &[u8],
    out_ptr: *mut u8,
    out_len: usize,
    out_actual_len: *mut u32,
) -> i32 {
    if !out_actual_len.is_null() {
        unsafe { *out_actual_len = src.len() as u32 };
    }
    if out_len < src.len() || (src.len() > 0 && out_ptr.is_null()) {
        return STATUS_BUFFER_TOO_SMALL;
    }
    if !out_ptr.is_null() && src.len() > 0 {
        unsafe {
            core::ptr::copy_nonoverlapping(src.as_ptr(), out_ptr, src.len());
        }
    }
    STATUS_OK
}

/// Zeroes linear memory buffer at `ptr` for `len` bytes.
#[no_mangle]
pub unsafe extern "C" fn wallet_pass_zeroize(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };
        zeroize_bytes(slice);
    }
}

/// Parses PEM text and returns PKCS#8 DER bytes.
#[no_mangle]
pub unsafe extern "C" fn wallet_pass_pem_to_pkcs8(
    pem_ptr: *const u8,
    pem_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
    out_actual_len: *mut u32,
) -> i32 {
    let pem_bytes = unsafe { input_slice(pem_ptr, pem_len) };
    let pem_str = match core::str::from_utf8(pem_bytes) {
        Ok(s) => s,
        Err(_) => return STATUS_BAD_INPUT,
    };

    match pem::private_key_to_pkcs8(pem_str) {
        Ok(pkcs8) => unsafe { write_output(pkcs8.as_slice(), out_ptr, out_len, out_actual_len) },
        Err(_) => STATUS_BAD_INPUT,
    }
}

/// Calculates RSASSA-PKCS1-v1_5 SHA-256 signature over `data`.
#[no_mangle]
pub unsafe extern "C" fn wallet_pass_rsa_sign(
    key_pem_ptr: *const u8,
    key_pem_len: usize,
    data_ptr: *const u8,
    data_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
    out_actual_len: *mut u32,
) -> i32 {
    let key_pem_bytes = unsafe { input_slice(key_pem_ptr, key_pem_len) };
    let data = unsafe { input_slice(data_ptr, data_len) };

    let key_pem_str = match core::str::from_utf8(key_pem_bytes) {
        Ok(s) => s,
        Err(_) => return STATUS_BAD_INPUT,
    };

    match rsa::rsa_sign_sha256_pem(key_pem_str, data) {
        Ok(signature) => unsafe { write_output(signature.as_slice(), out_ptr, out_len, out_actual_len) },
        Err(_) => STATUS_BAD_INPUT,
    }
}

/// Creates a detached CMS SignedData ContentInfo DER for Apple .pkpass files.
#[no_mangle]
pub unsafe extern "C" fn wallet_pass_cms_sign(
    content_ptr: *const u8,
    content_len: usize,
    signer_der_ptr: *const u8,
    signer_der_len: usize,
    chain_buf_ptr: *const u8,
    chain_buf_len: usize,
    chain_count: usize,
    key_pem_ptr: *const u8,
    key_pem_len: usize,
    time_sec: f64,
    out_ptr: *mut u8,
    out_len: usize,
    out_actual_len: *mut u32,
) -> i32 {
    let content = unsafe { input_slice(content_ptr, content_len) };
    let signer_der = unsafe { input_slice(signer_der_ptr, signer_der_len) };
    let key_pem_bytes = unsafe { input_slice(key_pem_ptr, key_pem_len) };

    let key_pem_str = match core::str::from_utf8(key_pem_bytes) {
        Ok(s) => s,
        Err(_) => return STATUS_BAD_INPUT,
    };

    // Parse chain_buf: `chain_count` length-prefixed byte chunks
    let chain_buf = unsafe { input_slice(chain_buf_ptr, chain_buf_len) };
    let mut chain_ders = alloc::vec::Vec::with_capacity(chain_count);
    let mut offset = 0;
    for _ in 0..chain_count {
        if offset + 4 > chain_buf.len() {
            return STATUS_BAD_INPUT;
        }
        let cert_len = u32::from_be_bytes([
            chain_buf[offset],
            chain_buf[offset + 1],
            chain_buf[offset + 2],
            chain_buf[offset + 3],
        ]) as usize;
        offset += 4;
        if offset + cert_len > chain_buf.len() {
            return STATUS_BAD_INPUT;
        }
        chain_ders.push(&chain_buf[offset..offset + cert_len]);
        offset += cert_len;
    }

    match cms::sign_detached_cms(content, signer_der, &chain_ders, key_pem_str, time_sec as i64) {
        Ok(cms_der) => unsafe { write_output(cms_der.as_slice(), out_ptr, out_len, out_actual_len) },
        Err(_) => STATUS_BAD_INPUT,
    }
}

/// Parses PEM certificates from a file buffer. Returns concatenated length-prefixed DER certificates.
#[no_mangle]
pub unsafe extern "C" fn wallet_pass_certificates_from_file(
    file_ptr: *const u8,
    file_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
    out_actual_len: *mut u32,
) -> i32 {
    let file_bytes = unsafe { input_slice(file_ptr, file_len) };
    let certs = match pem::certificates_from_file(file_bytes) {
        Ok(c) => c,
        Err(_) => return STATUS_BAD_INPUT,
    };

    let mut packed = ZeroizingVec::new();
    for cert in certs {
        let len_bytes = (cert.len() as u32).to_be_bytes();
        packed.extend_from_slice(&len_bytes);
        packed.extend_from_slice(cert.as_slice());
    }

    unsafe { write_output(packed.as_slice(), out_ptr, out_len, out_actual_len) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zeroize_clears_memory() {
        let mut buf = [0xaa_u8; 32];
        unsafe { wallet_pass_zeroize(buf.as_mut_ptr(), buf.len()) };
        assert_eq!(buf, [0u8; 32]);
    }
}
