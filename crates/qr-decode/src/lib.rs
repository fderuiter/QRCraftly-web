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

//! QR code decoder (ISO/IEC 18004) for QRCraftly (#1178).
//!
//! The pipeline: greyscale ([`image`]), local or global binarisation, finder
//! pattern search ([`finder`]), triples, module size, dimension, alignment
//! pattern and perspective sampling ([`detect`]), format and version
//! information, unmasking, de-interleaving and Reed-Solomon correction
//! ([`symbol`]), then the data bit stream ([`bitstream`]). Mirrored codes and
//! light-on-dark codes are read too, and one frame can hold several codes.
//!
//! The one export, `qr_decode`, takes a request and writes the codes it found.
//! Both are little-endian byte layouts, read and written by
//! `src/packages/qr-decode` on the TypeScript side:
//!
//! Request:
//! - bytes 0 to 3: width as u32; bytes 4 to 7: height as u32.
//! - byte 8: channels per pixel, 1 (grey) or 4 (RGBA); byte 9: flags (1 scan
//!   every other row, 2 also try light-on-dark, 4 also try one global
//!   threshold, 8 also try at half size); byte 10: the most codes to return
//!   (1 to 8); byte 11: 0.
//! - Then `width * height * channels` pixel bytes, row by row.
//!
//! Result: byte 0 is the number of codes; bytes 1 to 3 are 0. Per code:
//! - version, level (0 L, 1 M, 2 Q, 3 H), mask, flags (1 mirrored, 2 light on
//!   dark, 4 structured append, 8 GS1, 16 FNC1 in second position), each a u8;
//!   then structured append index, total and parity, and 0.
//! - 14 f32: the symbol's corners (top-left, top-right, bottom-right,
//!   bottom-left) and the finder centres (top-left, top-right, bottom-left),
//!   as x, y pairs in frame pixels; then the alignment centre as two f32, NaN
//!   when none was used.
//! - codewords corrected as u16, segment count as u16, byte length as u32.
//! - Per segment, 16 bytes: mode u8, three zero bytes, ECI assignment u32
//!   (0xFFFFFFFF for none), start u32 and length u32 in this code's bytes.
//! - The bytes.
//!
//! Every input is untrusted: sizes are checked before anything is allocated,
//! candidate counts are capped, and nothing indexes outside a buffer.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

#[cfg(target_arch = "wasm32")]
qrcraftly_core::module_exports!();

pub mod bitstream;
pub mod detect;
pub mod finder;
pub mod image;
pub mod math;
pub mod symbol;
pub mod transform;

use alloc::vec::Vec;
use bitstream::Content;
use image::{Binary, Luma};
use qrcraftly_core::abi::{STATUS_BAD_INPUT, STATUS_BUFFER_TOO_SMALL, STATUS_OK};
use qrcraftly_core::qr::Ecc;
use symbol::{decode_grid, Failure};

pub const FLAG_DENSE: u8 = 1;
pub const FLAG_INVERTED: u8 = 2;
pub const FLAG_GLOBAL: u8 = 4;
pub const FLAG_HALF: u8 = 8;

pub const RESULT_MIRRORED: u8 = 1;
pub const RESULT_INVERTED: u8 = 2;
pub const RESULT_STRUCTURED: u8 = 4;
pub const RESULT_GS1: u8 = 8;
pub const RESULT_FNC1_SECOND: u8 = 16;

/// Frames up to this many pixels a side (8K).
pub const MAX_SIDE: usize = 8192;
pub const MAX_CODES: usize = 8;
const REQUEST_HEADER: usize = 12;
const CODE_HEADER: usize = 8 + 16 * 4 + 8;
const SEGMENT_RECORD: usize = 16;
/// Triples tried per pass, so a frame full of finder-like noise stays cheap.
const MAX_ATTEMPTS: usize = 64;

/// How hard to look.
#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub dense: bool,
    pub inverted: bool,
    pub global: bool,
    pub half: bool,
    pub max_codes: usize,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            dense: false,
            inverted: false,
            global: false,
            half: false,
            max_codes: 1,
        }
    }
}

/// One decoded code.
#[derive(Debug)]
pub struct Decoded {
    pub version: u8,
    pub ecc: Ecc,
    pub mask: u8,
    pub mirrored: bool,
    pub inverted: bool,
    pub corrected: usize,
    /// Top-left, top-right, bottom-right, bottom-left.
    pub corners: [(f32, f32); 4],
    /// Top-left, top-right, bottom-left.
    pub finders: [(f32, f32); 3],
    pub alignment: Option<(f32, f32)>,
    pub content: Content,
}

/// Tries every size a triple suggests until one decodes.
fn decode_triple(binary: &Binary, luma: &Luma, t: &detect::Triple) -> Option<Decoded> {
    let (module, sizes) = detect::dimensions(binary, t);
    let mut queue = sizes;
    let mut tried: Vec<usize> = Vec::new();
    while let Some(size) = (!queue.is_empty()).then(|| queue.remove(0)) {
        if tried.contains(&size) {
            continue;
        }
        tried.push(size);
        for use_alignment in [true, false] {
            let placement = detect::place(binary, t, module, size, use_alignment);
            if !use_alignment && size == 21 {
                break;
            }
            if let Some(found) = decode_placement(binary, luma, t, &placement, &mut queue) {
                return Some(found);
            }
            if placement.alignment.is_none() {
                // Nothing different to try without it.
                break;
            }
        }
    }
    None
}

/// Samples and decodes one placement; a size hint from the version
/// information is pushed onto `queue`.
fn decode_placement(
    binary: &Binary,
    luma: &Luma,
    t: &detect::Triple,
    placement: &detect::Placement,
    queue: &mut Vec<usize>,
) -> Option<Decoded> {
    let size = placement.size;
    {
        let grid = detect::sample(binary, luma, placement)?;
        // A mirrored code samples as the transpose of itself; its format bits can
        // still pass as some other word, so any failure but a size hint tries it.
        let (result, mirrored) = match decode_grid(&grid) {
            Ok(cw) => (Ok(cw), false),
            Err(Failure::Size(n)) => (Err(Failure::Size(n)), false),
            Err(_) => (decode_grid(&grid.transposed()), true),
        };
        let codewords = match result {
            Ok(cw) => cw,
            Err(Failure::Size(n)) => {
                queue.insert(0, n);
                return None;
            }
            Err(_) => return None,
        };
        let content = bitstream::parse(&codewords.data, codewords.version)?;
        let d = size as f32;
        let tr = &placement.transform;
        // A mirrored code was sampled transposed: its own corners swap top-right and bottom-left.
        let (top_right, bottom_left) = if mirrored {
            ((0.0, d), (d, 0.0))
        } else {
            ((d, 0.0), (0.0, d))
        };
        let finders = if mirrored {
            [
                (t.top_left.x, t.top_left.y),
                (t.bottom_left.x, t.bottom_left.y),
                (t.top_right.x, t.top_right.y),
            ]
        } else {
            [
                (t.top_left.x, t.top_left.y),
                (t.top_right.x, t.top_right.y),
                (t.bottom_left.x, t.bottom_left.y),
            ]
        };
        Some(Decoded {
            version: codewords.version,
            ecc: codewords.ecc,
            mask: codewords.mask,
            mirrored,
            inverted: false,
            corrected: codewords.corrected,
            corners: [
                tr.apply(0.0, 0.0),
                tr.apply(top_right.0, top_right.1),
                tr.apply(d, d),
                tr.apply(bottom_left.0, bottom_left.1),
            ],
            finders,
            alignment: placement.alignment,
            content,
        })
    }
}

/// Finds and decodes up to `max` codes in one binarised frame.
fn scan(binary: &Binary, luma: &Luma, dense: bool, max: usize, out: &mut Vec<Decoded>) {
    let finders = finder::find(binary, dense);
    if finders.len() < 3 {
        return;
    }
    let mut used = [false; finder::MAX_CANDIDATES];
    for t in detect::triples(&finders).iter().take(MAX_ATTEMPTS) {
        if out.len() >= max {
            return;
        }
        if t.indexes.iter().any(|&i| used[i]) {
            continue;
        }
        if let Some(found) = decode_triple(binary, luma, t) {
            let centre = found
                .corners
                .iter()
                .fold((0.0, 0.0), |a, c| (a.0 + c.0 / 4.0, a.1 + c.1 / 4.0));
            let duplicate = out.iter().any(|o| {
                let oc = o
                    .corners
                    .iter()
                    .fold((0.0, 0.0), |a, c| (a.0 + c.0 / 4.0, a.1 + c.1 / 4.0));
                o.content == found.content && math::distance(oc.0, oc.1, centre.0, centre.1) < 8.0
            });
            for &i in &t.indexes {
                used[i] = true;
            }
            if !duplicate {
                out.push(found);
            }
        }
    }
}

/// Decodes up to `options.max_codes` codes from a greyscale frame.
pub fn decode(luma: &Luma, options: &Options) -> Vec<Decoded> {
    let max = options.max_codes.clamp(1, MAX_CODES);
    let mut out = Vec::new();
    let mut binary = Binary::hybrid(luma);
    scan(&binary, luma, options.dense, max, &mut out);
    if out.len() < max && options.inverted {
        binary.invert();
        let before = out.len();
        scan(&binary, luma, options.dense, max, &mut out);
        for d in &mut out[before..] {
            d.inverted = true;
        }
    }
    drop(binary);
    if out.is_empty() && options.global {
        let mut binary = Binary::global(luma);
        scan(&binary, luma, true, max, &mut out);
        if out.is_empty() && options.inverted {
            binary.invert();
            scan(&binary, luma, true, max, &mut out);
            for d in &mut out {
                d.inverted = true;
            }
        }
    }
    if out.is_empty() && options.half && luma.width >= 2 * 40 && luma.height >= 2 * 40 {
        let half = luma.half();
        let binary = Binary::hybrid(&half);
        scan(&binary, &half, options.dense, max, &mut out);
        for d in &mut out {
            for p in d
                .corners
                .iter_mut()
                .chain(d.finders.iter_mut())
                .chain(d.alignment.iter_mut())
            {
                *p = (p.0 * 2.0, p.1 * 2.0);
            }
        }
    }
    out
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    let s = bytes.get(at..at + 4)?;
    Some(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// Validates a request and converts its pixels to grey.
pub fn parse_request(bytes: &[u8]) -> Option<(Luma, Options)> {
    let width = read_u32(bytes, 0)? as usize;
    let height = read_u32(bytes, 4)? as usize;
    let channels = *bytes.get(8)? as usize;
    let flags = *bytes.get(9)?;
    let max_codes = *bytes.get(10)? as usize;
    if width == 0 || height == 0 || width > MAX_SIDE || height > MAX_SIDE {
        return None;
    }
    if !(channels == 1 || channels == 4)
        || flags & !(FLAG_DENSE | FLAG_INVERTED | FLAG_GLOBAL | FLAG_HALF) != 0
    {
        return None;
    }
    if !(1..=MAX_CODES).contains(&max_codes) || *bytes.get(11)? != 0 {
        return None;
    }
    let pixels = &bytes[REQUEST_HEADER..];
    if pixels.len() != width * height * channels {
        return None;
    }
    let luma = if channels == 4 {
        Luma::from_rgba(width, height, pixels)
    } else {
        Luma {
            width,
            height,
            data: pixels.to_vec(),
        }
    };
    let options = Options {
        dense: flags & FLAG_DENSE != 0,
        inverted: flags & FLAG_INVERTED != 0,
        global: flags & FLAG_GLOBAL != 0,
        half: flags & FLAG_HALF != 0,
        max_codes,
    };
    Some((luma, options))
}

/// Bytes one decoded code takes in the result.
fn record_len(d: &Decoded) -> usize {
    CODE_HEADER + SEGMENT_RECORD * d.content.segments.len() + d.content.bytes.len()
}

/// Writes the result layout, or returns the bytes needed as an error.
pub fn write_result(codes: &[Decoded], out: &mut [u8]) -> Result<usize, usize> {
    let len = 4 + codes.iter().map(record_len).sum::<usize>();
    if out.len() < len {
        return Err(len);
    }
    out[..4].copy_from_slice(&[codes.len() as u8, 0, 0, 0]);
    let mut at = 4;
    let mut put = |out: &mut [u8], bytes: &[u8]| {
        out[at..at + bytes.len()].copy_from_slice(bytes);
        at += bytes.len();
    };
    for d in codes {
        let c = &d.content;
        let mut flags = 0u8;
        if d.mirrored {
            flags |= RESULT_MIRRORED;
        }
        if d.inverted {
            flags |= RESULT_INVERTED;
        }
        if c.structured.is_some() {
            flags |= RESULT_STRUCTURED;
        }
        flags |= match c.fnc1 {
            1 => RESULT_GS1,
            2 => RESULT_FNC1_SECOND,
            _ => 0,
        };
        let (index, total, parity) = c.structured.unwrap_or((0, 0, 0));
        put(
            out,
            &[
                d.version,
                d.ecc as u8,
                d.mask,
                flags,
                index,
                total,
                parity,
                0,
            ],
        );
        let alignment = d.alignment.unwrap_or((f32::NAN, f32::NAN));
        for p in d
            .corners
            .iter()
            .chain(d.finders.iter())
            .chain(core::iter::once(&alignment))
        {
            put(out, &p.0.to_le_bytes());
            put(out, &p.1.to_le_bytes());
        }
        put(
            out,
            &(d.corrected.min(u16::MAX as usize) as u16).to_le_bytes(),
        );
        put(out, &(c.segments.len() as u16).to_le_bytes());
        put(out, &(c.bytes.len() as u32).to_le_bytes());
        for s in &c.segments {
            put(out, &[s.mode, 0, 0, 0]);
            put(out, &s.eci.to_le_bytes());
            put(out, &(s.start as u32).to_le_bytes());
            put(out, &(s.len as u32).to_le_bytes());
        }
        put(out, &c.bytes);
    }
    Ok(len)
}

/// Bytes `qr_decode` may write when asked for `max_codes` codes: a version 40
/// symbol holds at most 7,089 characters in at most 2,000 segments.
#[no_mangle]
pub extern "C" fn qr_decode_capacity(max_codes: usize) -> usize {
    4 + max_codes.clamp(1, MAX_CODES) * (CODE_HEADER + SEGMENT_RECORD * 2000 + 7089)
}

/// Decodes the request at `req_ptr` into `out_ptr`. Returns a status code: bad
/// input for a malformed request, buffer too small when `out_len` is under
/// `qr_decode_capacity`. Finding no code is a success with a count of 0.
///
/// # Safety
/// `req_ptr..req_ptr + req_len` must be readable and `out_ptr..out_ptr + out_len` writable.
#[no_mangle]
pub unsafe extern "C" fn qr_decode(
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
    let Some((luma, options)) = parse_request(request) else {
        return STATUS_BAD_INPUT;
    };
    let codes = decode(&luma, &options);
    match write_result(&codes, out) {
        Ok(_) => STATUS_OK,
        Err(_) => STATUS_BUFFER_TOO_SMALL,
    }
}
