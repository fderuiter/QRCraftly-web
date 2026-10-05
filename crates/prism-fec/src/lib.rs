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

//! Prism's outer code (#1176): a rateless erasure code for optical transfer.
//!
//! The design is the multi-stage Raptor shape built only from techniques whose
//! patents have expired (#1174, ADR 0037): a sparse LDPC precode, then a
//! non-systematic LT code with its own degree distribution and generator,
//! decoded by plain Gaussian elimination over GF(2). It has no systematic
//! index, no half-weight precode stage, no inactivation and no subsymbols, and
//! none of RFC 5053's tables or constants. See [`code`] for the structure.
//!
//! A receiver needs K + 1 symbols in the median and at most about K + 8 in 99
//! of 100 transfers, whatever symbols it catches.
//!
//! Exports, over the shared calling convention (`crates/core/src/abi.rs`). An
//! instance holds one encoder or decoder at a time, because the module
//! allocator only reclaims memory once everything is freed; the TypeScript
//! wrapper in `src/packages/optical-transfer/lib/fec/` creates one instance per
//! block.
//!
//! - `fec_encoder_new(k, t, seed, source, len)` returns an encoder, or 0.
//! - `fec_encoder_symbol(encoder, esi)` returns the address of the symbol's T bytes.
//! - `fec_decoder_new(k, t, seed)` returns a decoder, or 0.
//! - `fec_decoder_inbox(decoder)` returns where to write a symbol's T bytes;
//!   `fec_decoder_add(decoder, esi)` adds it and returns 0 (redundant),
//!   1 (innovative) or 2 (complete).
//! - `fec_decoder_rank` and `fec_decoder_needed` report progress (rank of L).
//! - `fec_decoder_solve(decoder)` returns the address of the K × T source bytes,
//!   or 0 before the block is complete.
//! - `fec_encoder_free` and `fec_decoder_free` release them.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod code;
pub mod decoder;
pub mod encoder;
pub mod rng;
pub mod symbol;

use alloc::boxed::Box;

pub use code::{Code, MAX_SOURCE_SYMBOLS, MAX_SYMBOL_BYTES};
pub use decoder::{Added, Decoder};
pub use encoder::Encoder;

/// Creates an encoder for `k` symbols of `t` bytes at `source`, or returns null.
///
/// # Safety
/// `source..source + len` must be readable linear memory.
#[no_mangle]
pub unsafe extern "C" fn fec_encoder_new(
    k: u32,
    t: u32,
    seed: u32,
    source: *const u8,
    len: usize,
) -> *mut Encoder {
    if source.is_null() {
        return core::ptr::null_mut();
    }
    // SAFETY: guaranteed by the caller.
    let bytes = unsafe { core::slice::from_raw_parts(source, len) };
    match Encoder::new(k as usize, t as usize, seed, bytes) {
        Some(encoder) => Box::into_raw(Box::new(encoder)),
        None => core::ptr::null_mut(),
    }
}

/// Makes encoding symbol `esi` and returns the address of its T bytes.
///
/// # Safety
/// `encoder` must come from `fec_encoder_new` and not be freed.
#[no_mangle]
pub unsafe extern "C" fn fec_encoder_symbol(encoder: *mut Encoder, esi: u32) -> *const u8 {
    // SAFETY: guaranteed by the caller.
    unsafe { &mut *encoder }.symbol(esi).as_ptr()
}

/// Frees an encoder.
///
/// # Safety
/// `encoder` must come from `fec_encoder_new` and not be freed already.
#[no_mangle]
pub unsafe extern "C" fn fec_encoder_free(encoder: *mut Encoder) {
    if !encoder.is_null() {
        // SAFETY: guaranteed by the caller.
        drop(unsafe { Box::from_raw(encoder) });
    }
}

/// Creates a decoder for `k` symbols of `t` bytes, or returns null.
#[no_mangle]
pub extern "C" fn fec_decoder_new(k: u32, t: u32, seed: u32) -> *mut Decoder {
    match Decoder::new(k as usize, t as usize, seed) {
        Some(decoder) => Box::into_raw(Box::new(decoder)),
        None => core::ptr::null_mut(),
    }
}

/// The address to write the next symbol's T bytes to.
///
/// # Safety
/// `decoder` must come from `fec_decoder_new` and not be freed.
#[no_mangle]
pub unsafe extern "C" fn fec_decoder_inbox(decoder: *mut Decoder) -> *mut u8 {
    // SAFETY: guaranteed by the caller.
    unsafe { &mut *decoder }.inbox().as_mut_ptr()
}

/// Adds symbol `esi` from the inbox: 0 redundant, 1 innovative, 2 complete.
///
/// # Safety
/// `decoder` must come from `fec_decoder_new` and not be freed.
#[no_mangle]
pub unsafe extern "C" fn fec_decoder_add(decoder: *mut Decoder, esi: u32) -> u32 {
    // SAFETY: guaranteed by the caller.
    unsafe { &mut *decoder }.add_inbox(esi) as u32
}

/// Independent equations so far.
///
/// # Safety
/// `decoder` must come from `fec_decoder_new` and not be freed.
#[no_mangle]
pub unsafe extern "C" fn fec_decoder_rank(decoder: *const Decoder) -> u32 {
    // SAFETY: guaranteed by the caller.
    unsafe { &*decoder }.rank() as u32
}

/// The rank at which the block solves, L.
///
/// # Safety
/// `decoder` must come from `fec_decoder_new` and not be freed.
#[no_mangle]
pub unsafe extern "C" fn fec_decoder_needed(decoder: *const Decoder) -> u32 {
    // SAFETY: guaranteed by the caller.
    unsafe { &*decoder }.code().l as u32
}

/// Solves the block and returns the address of its K × T bytes, or null if it is not complete.
///
/// # Safety
/// `decoder` must come from `fec_decoder_new` and not be freed.
#[no_mangle]
pub unsafe extern "C" fn fec_decoder_solve(decoder: *mut Decoder) -> *const u8 {
    // SAFETY: guaranteed by the caller.
    match unsafe { &mut *decoder }.solve() {
        Some(out) => out.as_ptr(),
        None => core::ptr::null(),
    }
}

/// Frees a decoder.
///
/// # Safety
/// `decoder` must come from `fec_decoder_new` and not be freed already.
#[no_mangle]
pub unsafe extern "C" fn fec_decoder_free(decoder: *mut Decoder) {
    if !decoder.is_null() {
        // SAFETY: guaranteed by the caller.
        drop(unsafe { Box::from_raw(decoder) });
    }
}
