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

//! Unified Fountain and BC-UR WebAssembly Kernel.
//!
//! Provides zero-allocation, deterministic execution for:
//! - Fountain code belief-propagation peeling & GF(2) Gauss-Jordan matrix elimination
//! - Bytewords minimal pair encoding and decoding with CRC-32 checks
//! - Minimal CBOR subset encoding and decoding
//! - BC-UR single-part and multipart camera frame stream reassembly

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod bcur_decoder;
pub mod bytewords;
pub mod cbor;
pub mod fountain_decoder;
pub mod gf2;
pub mod sha256;
pub mod soliton;
pub mod xoshiro;

use alloc::boxed::Box;
use alloc::vec::Vec;
use bcur_decoder::{BcUrDecoder, BcUrIngestStatus};
use bytewords::{decode_bytewords_minimal, encode_bytewords_minimal};
use cbor::{cbor_decode, cbor_encode, CborValue};
use fountain_decoder::FountainDecoder;
use gf2::{solve_gf2, GF2Equation};
use qrcraftly_core::abi::{
    STATUS_BAD_INPUT, STATUS_BUFFER_TOO_SMALL, STATUS_OK,
};

pub struct GF2Solver {
    block_size: usize,
    equations: Vec<GF2Equation>,
    solved_keys: Vec<usize>,
    solved_payloads: Vec<Vec<u8>>,
    residual_equations: Vec<GF2Equation>,
}

#[no_mangle]
pub extern "C" fn fountain_gf2_solver_new(block_size: usize) -> *mut GF2Solver {
    Box::into_raw(Box::new(GF2Solver {
        block_size,
        equations: Vec::new(),
        solved_keys: Vec::new(),
        solved_payloads: Vec::new(),
        residual_equations: Vec::new(),
    }))
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_add_eq(
    solver: *mut GF2Solver,
    indices_ptr: *const usize,
    indices_len: usize,
    data_ptr: *const u8,
    data_len: usize,
) {
    if solver.is_null() || indices_ptr.is_null() || data_ptr.is_null() {
        return;
    }
    let solver = unsafe { &mut *solver };
    let indices = unsafe { core::slice::from_raw_parts(indices_ptr, indices_len) };
    let data = unsafe { core::slice::from_raw_parts(data_ptr, data_len) };

    solver.equations.push(GF2Equation {
        columns: indices.to_vec(),
        data: data.to_vec(),
    });
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_solve(
    solver: *mut GF2Solver,
    unknowns_ptr: *const usize,
    unknowns_len: usize,
) -> u32 {
    if solver.is_null() || unknowns_ptr.is_null() {
        return 0;
    }
    let solver = unsafe { &mut *solver };
    let unknowns = unsafe { core::slice::from_raw_parts(unknowns_ptr, unknowns_len) };

    let sol = solve_gf2(&solver.equations, unknowns, solver.block_size);

    solver.solved_keys.clear();
    solver.solved_payloads.clear();
    for (k, v) in sol.solved {
        solver.solved_keys.push(k);
        solver.solved_payloads.push(v);
    }
    solver.residual_equations = sol.residual;

    sol.rank as u32
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_solved_count(solver: *const GF2Solver) -> usize {
    if solver.is_null() {
        0
    } else {
        unsafe { &*solver }.solved_keys.len()
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_get_solved_key(
    solver: *const GF2Solver,
    idx: usize,
) -> usize {
    if solver.is_null() {
        0
    } else {
        let solver = unsafe { &*solver };
        solver.solved_keys.get(idx).copied().unwrap_or(0)
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_get_solved_data(
    solver: *const GF2Solver,
    idx: usize,
) -> *const u8 {
    if solver.is_null() {
        core::ptr::null()
    } else {
        let solver = unsafe { &*solver };
        match solver.solved_payloads.get(idx) {
            Some(v) => v.as_ptr(),
            None => core::ptr::null(),
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_residual_count(solver: *const GF2Solver) -> usize {
    if solver.is_null() {
        0
    } else {
        unsafe { &*solver }.residual_equations.len()
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_get_residual_cols_ptr(
    solver: *const GF2Solver,
    idx: usize,
) -> *const usize {
    if solver.is_null() {
        core::ptr::null()
    } else {
        let solver = unsafe { &*solver };
        match solver.residual_equations.get(idx) {
            Some(eq) => eq.columns.as_ptr(),
            None => core::ptr::null(),
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_get_residual_cols_len(
    solver: *const GF2Solver,
    idx: usize,
) -> usize {
    if solver.is_null() {
        0
    } else {
        let solver = unsafe { &*solver };
        match solver.residual_equations.get(idx) {
            Some(eq) => eq.columns.len(),
            None => 0,
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_get_residual_data(
    solver: *const GF2Solver,
    idx: usize,
) -> *const u8 {
    if solver.is_null() {
        core::ptr::null()
    } else {
        let solver = unsafe { &*solver };
        match solver.residual_equations.get(idx) {
            Some(eq) => eq.data.as_ptr(),
            None => core::ptr::null(),
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_gf2_solver_free(solver: *mut GF2Solver) {
    if !solver.is_null() {
        drop(unsafe { Box::from_raw(solver) });
    }
}

pub struct FountainDecoderWrapper {
    pub decoder: FountainDecoder,
    pub finalized_buf: Vec<u8>,
}

#[no_mangle]
pub extern "C" fn fountain_decoder_new(
    k: u32,
    message_len: u32,
    checksum: u32,
    block_size: u32,
) -> *mut FountainDecoderWrapper {
    Box::into_raw(Box::new(FountainDecoderWrapper {
        decoder: FountainDecoder::new(
            k as usize,
            message_len as usize,
            checksum,
            block_size as usize,
        ),
        finalized_buf: Vec::new(),
    }))
}

#[no_mangle]
pub unsafe extern "C" fn fountain_decoder_ingest_droplet(
    wrapper: *mut FountainDecoderWrapper,
    seq: u32,
    data_ptr: *const u8,
    data_len: usize,
) -> u32 {
    if wrapper.is_null() || data_ptr.is_null() {
        return 0;
    }
    let wrapper = unsafe { &mut *wrapper };
    let data = unsafe { core::slice::from_raw_parts(data_ptr, data_len) };
    if wrapper.decoder.ingest_droplet(seq as usize, data) {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_decoder_ingest_equation(
    wrapper: *mut FountainDecoderWrapper,
    indices_ptr: *const u32,
    indices_len: usize,
    data_ptr: *const u8,
    data_len: usize,
) -> u32 {
    if wrapper.is_null() || indices_ptr.is_null() || data_ptr.is_null() {
        return 0;
    }
    let wrapper = unsafe { &mut *wrapper };
    let raw_indices = unsafe { core::slice::from_raw_parts(indices_ptr, indices_len) };
    let indices: Vec<usize> = raw_indices.iter().map(|&i| i as usize).collect();
    let data = unsafe { core::slice::from_raw_parts(data_ptr, data_len) };

    if wrapper.decoder.ingest_equation(&indices, data) {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_decoder_progress(
    wrapper: *const FountainDecoderWrapper,
) -> u32 {
    if wrapper.is_null() {
        0
    } else {
        unsafe { &*wrapper }.decoder.progress()
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_decoder_rank(wrapper: *const FountainDecoderWrapper) -> u32 {
    if wrapper.is_null() {
        0
    } else {
        unsafe { &*wrapper }.decoder.rank() as u32
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_decoder_is_complete(
    wrapper: *const FountainDecoderWrapper,
) -> u32 {
    if wrapper.is_null() {
        0
    } else if unsafe { &*wrapper }.decoder.is_complete() {
        1
    } else {
        0
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_decoder_finalize(
    wrapper: *mut FountainDecoderWrapper,
) -> *const u8 {
    if wrapper.is_null() {
        return core::ptr::null();
    }
    let wrapper = unsafe { &mut *wrapper };
    match wrapper.decoder.finalize() {
        Some(buf) => {
            wrapper.finalized_buf = buf;
            wrapper.finalized_buf.as_ptr()
        }
        None => core::ptr::null(),
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_decoder_finalize_len(
    wrapper: *const FountainDecoderWrapper,
) -> usize {
    if wrapper.is_null() {
        0
    } else {
        unsafe { &*wrapper }.finalized_buf.len()
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_decoder_reset(wrapper: *mut FountainDecoderWrapper) {
    if !wrapper.is_null() {
        let wrapper = unsafe { &mut *wrapper };
        wrapper.decoder.reset();
        wrapper.finalized_buf.clear();
    }
}

#[no_mangle]
pub unsafe extern "C" fn fountain_decoder_free(wrapper: *mut FountainDecoderWrapper) {
    if !wrapper.is_null() {
        drop(unsafe { Box::from_raw(wrapper) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn bytewords_encode_minimal_c(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_cap: usize,
    out_written: *mut usize,
) -> i32 {
    if in_ptr.is_null() || out_ptr.is_null() || out_written.is_null() {
        return STATUS_BAD_INPUT;
    }
    let input = unsafe { core::slice::from_raw_parts(in_ptr, in_len) };
    let encoded = encode_bytewords_minimal(input);
    if out_cap < encoded.len() {
        return STATUS_BUFFER_TOO_SMALL;
    }
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, encoded.len()) };
    out.copy_from_slice(&encoded);
    unsafe { *out_written = encoded.len() };
    STATUS_OK
}

#[no_mangle]
pub unsafe extern "C" fn bytewords_decode_minimal_c(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_cap: usize,
    out_written: *mut usize,
) -> i32 {
    if in_ptr.is_null() || out_ptr.is_null() || out_written.is_null() {
        return STATUS_BAD_INPUT;
    }
    let input = unsafe { core::slice::from_raw_parts(in_ptr, in_len) };
    let decoded = match decode_bytewords_minimal(input) {
        Some(d) => d,
        None => return STATUS_BAD_INPUT,
    };
    if out_cap < decoded.len() {
        return STATUS_BUFFER_TOO_SMALL;
    }
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, decoded.len()) };
    out.copy_from_slice(&decoded);
    unsafe { *out_written = decoded.len() };
    STATUS_OK
}

#[no_mangle]
pub unsafe extern "C" fn cbor_encode_bytes_c(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_cap: usize,
    out_written: *mut usize,
) -> i32 {
    if in_ptr.is_null() || out_ptr.is_null() || out_written.is_null() {
        return STATUS_BAD_INPUT;
    }
    let input = unsafe { core::slice::from_raw_parts(in_ptr, in_len) };
    let encoded = cbor_encode(&CborValue::Bytes(input.to_vec()));
    if out_cap < encoded.len() {
        return STATUS_BUFFER_TOO_SMALL;
    }
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, encoded.len()) };
    out.copy_from_slice(&encoded);
    unsafe { *out_written = encoded.len() };
    STATUS_OK
}

#[no_mangle]
pub unsafe extern "C" fn cbor_decode_bytes_c(
    in_ptr: *const u8,
    in_len: usize,
    out_ptr: *mut u8,
    out_cap: usize,
    out_written: *mut usize,
) -> i32 {
    if in_ptr.is_null() || out_ptr.is_null() || out_written.is_null() {
        return STATUS_BAD_INPUT;
    }
    let input = unsafe { core::slice::from_raw_parts(in_ptr, in_len) };
    let decoded_val = match cbor_decode(input) {
        Some(v) => v,
        None => return STATUS_BAD_INPUT,
    };
    let bytes = match decoded_val {
        CborValue::Bytes(b) => b,
        _ => return STATUS_BAD_INPUT,
    };
    if out_cap < bytes.len() {
        return STATUS_BUFFER_TOO_SMALL;
    }
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, bytes.len()) };
    out.copy_from_slice(&bytes);
    unsafe { *out_written = bytes.len() };
    STATUS_OK
}

pub struct BcUrDecoderWrapper {
    pub decoder: BcUrDecoder,
    pub result_buf: Vec<u8>,
    pub ur_type_buf: Vec<u8>,
}

#[no_mangle]
pub extern "C" fn bcur_decoder_new() -> *mut BcUrDecoderWrapper {
    Box::into_raw(Box::new(BcUrDecoderWrapper {
        decoder: BcUrDecoder::new(),
        result_buf: Vec::new(),
        ur_type_buf: Vec::new(),
    }))
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_ingest_str(
    wrapper: *mut BcUrDecoderWrapper,
    str_ptr: *const u8,
    str_len: usize,
) -> u32 {
    if wrapper.is_null() || str_ptr.is_null() {
        return 0; // Rejected
    }
    let wrapper = unsafe { &mut *wrapper };
    let bytes = unsafe { core::slice::from_raw_parts(str_ptr, str_len) };
    let text = match core::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return 0, // Rejected
    };

    match wrapper.decoder.ingest_str(text) {
        BcUrIngestStatus::Rejected => 0,
        BcUrIngestStatus::Progress { .. } => 1,
        BcUrIngestStatus::Complete(res) => {
            wrapper.result_buf = res.cbor;
            wrapper.ur_type_buf = res.ur_type.as_bytes().to_vec();
            2
        }
        BcUrIngestStatus::Failed(_) => 3,
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_progress(wrapper: *const BcUrDecoderWrapper) -> f64 {
    if wrapper.is_null() {
        0.0
    } else {
        unsafe { &*wrapper }.decoder.progress()
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_received_count(
    wrapper: *const BcUrDecoderWrapper,
) -> u32 {
    if wrapper.is_null() {
        0
    } else {
        unsafe { &*wrapper }.decoder.simple.len() as u32
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_seq_len(wrapper: *const BcUrDecoderWrapper) -> u32 {
    if wrapper.is_null() {
        0
    } else {
        unsafe { &*wrapper }.decoder.seq_len as u32
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_result_ptr(
    wrapper: *const BcUrDecoderWrapper,
) -> *const u8 {
    if wrapper.is_null() {
        core::ptr::null()
    } else {
        unsafe { &*wrapper }.result_buf.as_ptr()
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_result_len(
    wrapper: *const BcUrDecoderWrapper,
) -> usize {
    if wrapper.is_null() {
        0
    } else {
        unsafe { &*wrapper }.result_buf.len()
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_result_kind(
    wrapper: *const BcUrDecoderWrapper,
) -> u32 {
    if wrapper.is_null() {
        2 // Cbor
    } else {
        let wrapper = unsafe { &*wrapper };
        match wrapper.decoder.done.as_ref() {
            Some(res) => res.content_kind.clone() as u32,
            None => 2,
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_ur_type_ptr(
    wrapper: *const BcUrDecoderWrapper,
) -> *const u8 {
    if wrapper.is_null() {
        core::ptr::null()
    } else {
        unsafe { &*wrapper }.ur_type_buf.as_ptr()
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_ur_type_len(
    wrapper: *const BcUrDecoderWrapper,
) -> usize {
    if wrapper.is_null() {
        0
    } else {
        unsafe { &*wrapper }.ur_type_buf.len()
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_reset(wrapper: *mut BcUrDecoderWrapper) {
    if !wrapper.is_null() {
        let wrapper = unsafe { &mut *wrapper };
        wrapper.decoder.reset();
        wrapper.result_buf.clear();
        wrapper.ur_type_buf.clear();
    }
}

#[no_mangle]
pub unsafe extern "C" fn bcur_decoder_free(wrapper: *mut BcUrDecoderWrapper) {
    if !wrapper.is_null() {
        drop(unsafe { Box::from_raw(wrapper) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fountain_decoder_end_to_end() {
        let k = 4;
        let block_size = 8;
        let mut source = alloc::vec![0u8; k * block_size];
        for i in 0..source.len() {
            source[i] = (i + 1) as u8;
        }

        let checksum = qrcraftly_core::crc32::checksum(&source);
        let mut decoder = FountainDecoder::new(k, source.len(), checksum, block_size);

        for seq in 1..=k {
            let start = (seq - 1) * block_size;
            let chunk = &source[start..start + block_size];
            decoder.ingest_droplet(seq, chunk);
        }

        assert!(decoder.is_complete());
        let finalized = decoder.finalize().expect("should finalize");
        assert_eq!(finalized, source);
    }
}
