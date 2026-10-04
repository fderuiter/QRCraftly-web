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

//! QR code encoder (ISO/IEC 18004) for QRCraftly (#1177).
//!
//! Numeric, alphanumeric, byte and kanji segments; ECI; structured append;
//! versions 1 to 40 at levels L, M, Q and H; the smallest version or a fixed
//! one; all eight masks scored, or a fixed mask. Text is split into segments
//! optimally ([`optimal`]); callers can also supply their own segments.
//!
//! The one export, `qr_encode`, takes a request and writes the symbol. Both are
//! little-endian byte layouts, decoded and encoded by
//! `src/packages/qr-matrix/lib/encoder.ts`:
//!
//! Request:
//! - byte 0: level (0 L, 1 M, 2 Q, 3 H); byte 1: version (0 = smallest that fits);
//!   byte 2: mask (0 to 7, or 8 = best); byte 3: flags (1 raise the level while the
//!   version stays the same, 2 structured append, 4 caller segments, 8 ECI).
//! - With flag 2: symbol index, symbol count and parity, one byte each.
//! - With flag 8: the ECI assignment number as a u32.
//! - Then, with flag 4, segments as `mode u8, length u32, bytes` (mode 1 numeric,
//!   2 alphanumeric, 4 byte, 8 kanji as big-endian Shift JIS); otherwise UTF-8 text.
//!
//! Result:
//! - bytes 0 to 3: version, level, mask, 0; bytes 4 to 5: size as u16; bytes 6 to 7:
//!   segment count as u16; bytes 8 to 11: data bits used as u32.
//! - `size * size` modules, row by row, 1 for dark.
//! - Per segment, 13 bytes: mode u8, character count u32 (the assignment number for
//!   ECI), and the offset and length of its bytes in the text or the request body, u32 each.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod optimal;
pub mod segment;
pub mod symbol;
pub mod tables;

use alloc::vec::Vec;
use qrcraftly_core::abi::{
    STATUS_BAD_INPUT, STATUS_BUFFER_TOO_SMALL, STATUS_DATA_TOO_LONG, STATUS_OK,
};
use segment::{total_bits, Mode, Segment, StructuredAppend};
use symbol::Matrix;
use tables::{data_bits, Ecc, MAX_SIZE, MAX_VERSION, MIN_VERSION};

pub const FLAG_BOOST_ECC: u8 = 1;
pub const FLAG_STRUCTURED_APPEND: u8 = 2;
pub const FLAG_SEGMENTS: u8 = 4;
pub const FLAG_ECI: u8 = 8;
pub const AUTO_MASK: u8 = 8;

const RESULT_HEADER: usize = 12;
const SEGMENT_RECORD: usize = 13;

/// What to encode and how. The body is UTF-8 text or caller segments.
pub struct Request<'a> {
    pub ecc: Ecc,
    pub version: Option<u8>,
    pub mask: Option<u8>,
    pub boost_ecc: bool,
    pub header: Option<StructuredAppend>,
    pub eci: Option<u32>,
    pub body: Body<'a>,
}

pub enum Body<'a> {
    Text(&'a [u8]),
    Segments(Vec<Segment<'a>>),
}

/// The encoded symbol.
pub struct Symbol<'a> {
    pub version: u8,
    pub ecc: Ecc,
    pub mask: u8,
    pub bits: usize,
    pub segments: Vec<Segment<'a>>,
    pub matrix: Matrix,
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    let slice = bytes.get(at..at + 4)?;
    Some(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// Decodes a request, or `None` when it is malformed.
pub fn parse_request(bytes: &[u8]) -> Option<Request<'_>> {
    let ecc = Ecc::from_index(*bytes.first()?)?;
    let version = match *bytes.get(1)? {
        0 => None,
        v @ MIN_VERSION..=MAX_VERSION => Some(v),
        _ => return None,
    };
    let mask = match *bytes.get(2)? {
        AUTO_MASK => None,
        m @ 0..=7 => Some(m),
        _ => return None,
    };
    let flags = *bytes.get(3)?;
    if flags & !(FLAG_BOOST_ECC | FLAG_STRUCTURED_APPEND | FLAG_SEGMENTS | FLAG_ECI) != 0 {
        return None;
    }
    let mut at = 4;
    let header = if flags & FLAG_STRUCTURED_APPEND != 0 {
        let fields = bytes.get(at..at + 3)?;
        at += 3;
        Some(StructuredAppend::new(fields[0], fields[1], fields[2])?)
    } else {
        None
    };
    let eci = if flags & FLAG_ECI != 0 {
        let n = read_u32(bytes, at)?;
        at += 4;
        Segment::eci(n)?;
        Some(n)
    } else {
        None
    };
    let rest = &bytes[at..];
    let body = if flags & FLAG_SEGMENTS != 0 {
        let mut segments = Vec::new();
        let mut i = 0;
        while i < rest.len() {
            let mode = Mode::from_indicator(rest[i])?;
            if mode == Mode::Eci {
                return None;
            }
            let len = read_u32(rest, i + 1)? as usize;
            let start = i + 5;
            let data = rest.get(start..start.checked_add(len)?)?;
            segments.push(Segment::new(mode, data, start)?);
            i = start + len;
        }
        Body::Segments(segments)
    } else {
        core::str::from_utf8(rest).ok()?;
        if rest.is_empty() {
            return None;
        }
        Body::Text(rest)
    };
    Some(Request {
        ecc,
        version,
        mask,
        boost_ecc: flags & FLAG_BOOST_ECC != 0,
        header,
        eci,
        body,
    })
}

/// Index of a version's character count range.
fn range_of(version: u8) -> usize {
    if version < 10 {
        0
    } else if version < 27 {
        1
    } else {
        2
    }
}

/// Encodes a request. Errors are ABI status codes.
pub fn encode<'a>(request: &Request<'a>) -> Result<Symbol<'a>, i32> {
    let header = request.header.as_ref();
    // Text is segmented once per character count range, on first use.
    let mut by_range: [Option<Vec<Segment<'a>>>; 3] = [None, None, None];
    let versions = match request.version {
        Some(v) => v..=v,
        None => MIN_VERSION..=MAX_VERSION,
    };
    let mut found = None;
    for version in versions {
        let range = range_of(version);
        let segments = by_range[range].get_or_insert_with(|| {
            let mut segments = Vec::new();
            if let Some(eci) = request.eci {
                segments.extend(Segment::eci(eci));
            }
            match &request.body {
                Body::Text(text) => optimal::segment_text(text, version, &mut segments),
                Body::Segments(given) => segments.extend(given.iter().copied()),
            }
            segments
        });
        if let Some(bits) = total_bits(header, segments, version) {
            if bits <= data_bits(version, request.ecc) {
                found = Some((version, range, bits));
                break;
            }
        }
    }
    let (version, range, bits) = found.ok_or(STATUS_DATA_TOO_LONG)?;
    let segments = by_range[range].take().unwrap_or_default();

    let mut ecc = request.ecc;
    if request.boost_ecc {
        for higher in Ecc::ALL {
            if higher > ecc && bits <= data_bits(version, higher) {
                ecc = higher;
            }
        }
    }

    let words = symbol::codewords(header, &segments, version, ecc);
    let (matrix, mask) = symbol::build(version, ecc, request.mask, &words);
    Ok(Symbol {
        version,
        ecc,
        mask,
        bits,
        segments,
        matrix,
    })
}

/// Bytes `qr_encode` may write for a request of `request_len` bytes.
#[no_mangle]
pub extern "C" fn qr_output_capacity(request_len: usize) -> usize {
    RESULT_HEADER + MAX_SIZE * MAX_SIZE + SEGMENT_RECORD * (request_len + 1)
}

/// Writes a symbol into `out`, or returns the bytes it needs as an error.
pub fn write_result(symbol: &Symbol<'_>, out: &mut [u8]) -> Result<usize, usize> {
    let size = symbol.matrix.size;
    let len = RESULT_HEADER + size * size + SEGMENT_RECORD * symbol.segments.len();
    if out.len() < len {
        return Err(len);
    }
    out[0] = symbol.version;
    out[1] = symbol.ecc as u8;
    out[2] = symbol.mask;
    out[3] = 0;
    out[4..6].copy_from_slice(&(size as u16).to_le_bytes());
    out[6..8].copy_from_slice(&(symbol.segments.len() as u16).to_le_bytes());
    out[8..12].copy_from_slice(&(symbol.bits as u32).to_le_bytes());
    out[RESULT_HEADER..RESULT_HEADER + size * size].copy_from_slice(&symbol.matrix.modules);
    let mut at = RESULT_HEADER + size * size;
    for segment in &symbol.segments {
        out[at] = segment.mode.indicator() as u8;
        out[at + 1..at + 5].copy_from_slice(&(segment.chars as u32).to_le_bytes());
        out[at + 5..at + 9].copy_from_slice(&(segment.offset as u32).to_le_bytes());
        out[at + 9..at + 13].copy_from_slice(&(segment.data.len() as u32).to_le_bytes());
        at += SEGMENT_RECORD;
    }
    Ok(len)
}

/// Encodes the request at `req_ptr` into `out_ptr`. Returns a status code:
/// bad input for a malformed request or text, data too long when no allowed
/// version holds it, buffer too small when `out_len` is under `qr_output_capacity`.
///
/// # Safety
/// `req_ptr..req_ptr + req_len` must be readable and `out_ptr..out_ptr + out_len` writable.
#[no_mangle]
pub unsafe extern "C" fn qr_encode(
    req_ptr: *const u8,
    req_len: usize,
    out_ptr: *mut u8,
    out_len: usize,
) -> i32 {
    if req_ptr.is_null() || out_ptr.is_null() {
        return STATUS_BAD_INPUT;
    }
    // SAFETY: guaranteed by the caller.
    let request = unsafe { core::slice::from_raw_parts(req_ptr, req_len) };
    // SAFETY: guaranteed by the caller.
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr, out_len) };
    let Some(parsed) = parse_request(request) else {
        return STATUS_BAD_INPUT;
    };
    match encode(&parsed) {
        Ok(symbol) => match write_result(&symbol, out) {
            Ok(_) => STATUS_OK,
            Err(_) => STATUS_BUFFER_TOO_SMALL,
        },
        Err(status) => status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn request(ecc: u8, version: u8, mask: u8, flags: u8, body: &[u8]) -> Vec<u8> {
        let mut bytes = vec![ecc, version, mask, flags];
        bytes.extend_from_slice(body);
        bytes
    }

    fn run(bytes: &[u8]) -> Result<Vec<u8>, i32> {
        let mut out = vec![0u8; qr_output_capacity(bytes.len())];
        let status = unsafe { qr_encode(bytes.as_ptr(), bytes.len(), out.as_mut_ptr(), out.len()) };
        if status != STATUS_OK {
            return Err(status);
        }
        Ok(out)
    }

    #[test]
    fn encodes_text_at_the_smallest_version() {
        let out = run(&request(1, 0, AUTO_MASK, 0, b"https://qrcraftly.com")).unwrap();
        assert_eq!(out[0], 2);
        assert_eq!(out[1], 1);
        assert!(out[2] < 8);
        assert_eq!(u16::from_le_bytes([out[4], out[5]]), 25);
        assert_eq!(u16::from_le_bytes([out[6], out[7]]), 1);
        // Top-left finder: a dark ring around a light ring.
        assert_eq!(out[RESULT_HEADER], 1);
        assert_eq!(out[RESULT_HEADER + 25 + 1], 0);
        assert_eq!(out[RESULT_HEADER + 2 * 25 + 2], 1);
    }

    #[test]
    fn capacities_at_version_40() {
        for (ecc, numeric, alnum, bytes) in [
            (0u8, 7089usize, 4296usize, 2953usize),
            (1, 5596, 3391, 2331),
            (2, 3993, 2420, 1663),
            (3, 3057, 1852, 1273),
        ] {
            for (fill, len) in [(b'7', numeric), (b'Z', alnum), (b'z', bytes)] {
                let text = vec![fill; len];
                let out = run(&request(ecc, 0, 0, 0, &text)).unwrap();
                assert_eq!(out[0], 40, "level {ecc} fill {fill} len {len}");
                let too_long = vec![fill; len + 1];
                assert_eq!(
                    run(&request(ecc, 0, 0, 0, &too_long)),
                    Err(STATUS_DATA_TOO_LONG)
                );
            }
        }
    }

    #[test]
    fn forced_version_and_mask() {
        let out = run(&request(0, 7, 3, 0, b"HELLO")).unwrap();
        assert_eq!((out[0], out[2]), (7, 3));
        assert_eq!(
            run(&request(3, 1, 0, 0, b"this is far too long for 1-H")),
            Err(STATUS_DATA_TOO_LONG)
        );
    }

    #[test]
    fn boost_raises_the_level_without_growing() {
        let out = run(&request(0, 0, 0, FLAG_BOOST_ECC, b"HI")).unwrap();
        assert_eq!((out[0], out[1]), (1, 3));
    }

    #[test]
    fn caller_segments_are_used_as_given() {
        let mut body = vec![2u8];
        body.extend_from_slice(&5u32.to_le_bytes());
        body.extend_from_slice(b"AC-42");
        body.push(4);
        body.extend_from_slice(&2u32.to_le_bytes());
        body.extend_from_slice(b"ok");
        let out = run(&request(1, 0, 0, FLAG_SEGMENTS, &body)).unwrap();
        let at = RESULT_HEADER + 21 * 21;
        assert_eq!(u16::from_le_bytes([out[6], out[7]]), 2);
        assert_eq!(out[at], 2);
        assert_eq!(read_u32(&out, at + 1), Some(5));
        assert_eq!(read_u32(&out, at + 5), Some(5));
        assert_eq!(out[at + 13], 4);
        assert_eq!(read_u32(&out, at + 13 + 5), Some(15));
        // Characters outside the mode are refused.
        let mut bad = vec![1u8];
        bad.extend_from_slice(&1u32.to_le_bytes());
        bad.push(b'x');
        assert_eq!(
            run(&request(1, 0, 0, FLAG_SEGMENTS, &bad)),
            Err(STATUS_BAD_INPUT)
        );
    }

    #[test]
    fn structured_append_and_eci_headers_cost_bits() {
        let plain = run(&request(1, 0, 0, 0, b"x")).unwrap();
        let mut body = vec![0u8, 2, 0x55];
        body.extend_from_slice(&26u32.to_le_bytes());
        body.push(b'x');
        let both = run(&request(1, 0, 0, FLAG_STRUCTURED_APPEND | FLAG_ECI, &body)).unwrap();
        assert_eq!(read_u32(&both, 8), read_u32(&plain, 8).map(|b| b + 20 + 12));
        assert_eq!(u16::from_le_bytes([both[6], both[7]]), 2);
    }

    #[test]
    fn malformed_requests_are_refused() {
        assert_eq!(run(&[]), Err(STATUS_BAD_INPUT));
        assert_eq!(run(&request(4, 0, 0, 0, b"x")), Err(STATUS_BAD_INPUT));
        assert_eq!(run(&request(0, 41, 0, 0, b"x")), Err(STATUS_BAD_INPUT));
        assert_eq!(run(&request(0, 0, 9, 0, b"x")), Err(STATUS_BAD_INPUT));
        assert_eq!(run(&request(0, 0, 0, 0x10, b"x")), Err(STATUS_BAD_INPUT));
        assert_eq!(run(&request(0, 0, 0, 0, b"")), Err(STATUS_BAD_INPUT));
        assert_eq!(run(&request(0, 0, 0, 0, b"\xff")), Err(STATUS_BAD_INPUT));
        assert_eq!(
            run(&request(0, 0, 0, FLAG_STRUCTURED_APPEND, &[3, 2, 0, b'x'])),
            Err(STATUS_BAD_INPUT)
        );
        let mut out = vec![0u8; 10];
        let bytes = request(0, 0, 0, 0, b"x");
        let status = unsafe { qr_encode(bytes.as_ptr(), bytes.len(), out.as_mut_ptr(), out.len()) };
        assert_eq!(status, STATUS_BUFFER_TOO_SMALL);
    }
}
