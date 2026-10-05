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

//! Fuzz-style tests with seeded random and mutated inputs: every layer takes
//! untrusted bytes, so none may panic, and what decodes must be what was encoded.

mod common;

use common::{code, plain, Rng};
use qr_decode::bitstream::parse;
use qr_decode::symbol::{decode_grid, Grid};
use qr_decode::{qr_decode, qr_decode_capacity};

fn call(request: &[u8], max_codes: usize) -> i32 {
    let mut out = vec![0u8; qr_decode_capacity(max_codes)];
    // SAFETY: both slices are valid for their lengths.
    unsafe { qr_decode(request.as_ptr(), request.len(), out.as_mut_ptr(), out.len()) }
}

fn header(width: u32, height: u32, channels: u8, flags: u8, max: u8) -> Vec<u8> {
    let mut h = Vec::new();
    h.extend_from_slice(&width.to_le_bytes());
    h.extend_from_slice(&height.to_le_bytes());
    h.extend_from_slice(&[channels, flags, max, 0]);
    h
}

#[test]
fn random_and_mutated_requests_never_panic() {
    let mut rng = Rng(0xF022);
    let luma = plain(&code(b"fuzz me", 0, 0, 8), 3);
    let mut valid = header(luma.width as u32, luma.height as u32, 1, 15, 4);
    valid.extend_from_slice(&luma.data);
    assert_eq!(call(&valid, 4), 0);
    for round in 0..300 {
        let mut request = if round % 3 == 0 {
            (0..rng.below(64)).map(|_| rng.below(256) as u8).collect()
        } else {
            valid.clone()
        };
        for _ in 0..1 + rng.below(8) {
            if request.is_empty() {
                break;
            }
            let at = if round % 3 == 1 {
                rng.below(12.min(request.len() as u32)) as usize
            } else {
                rng.below(request.len() as u32) as usize
            };
            request[at] = rng.below(256) as u8;
        }
        if round % 7 == 0 {
            request.truncate(rng.below(request.len() as u32 + 1) as usize);
        }
        call(&request, 1 + rng.below(8) as usize);
    }
    // A too-small output buffer is reported, not overrun.
    let mut out = vec![0u8; 8];
    // SAFETY: as above.
    let status = unsafe { qr_decode(valid.as_ptr(), valid.len(), out.as_mut_ptr(), out.len()) };
    assert_ne!(status, 0);
}

#[test]
fn random_data_streams_never_panic() {
    let mut rng = Rng(77);
    for round in 0..5000u32 {
        let version = 1 + (round % 40) as u8;
        let data: Vec<u8> = (0..rng.below(300)).map(|_| rng.below(256) as u8).collect();
        let _ = parse(&data, version);
    }
}

#[test]
fn random_and_bit_flipped_grids_never_misread() {
    let mut rng = Rng(5);
    for round in 0..1000u32 {
        let size = 17 + 4 * (1 + rng.below(40) as usize);
        let grid = if round % 2 == 0 {
            Grid {
                size,
                bits: (0..size * size).map(|_| rng.below(2) as u8).collect(),
                weak: (0..size * size)
                    .map(|_| u8::from(rng.below(8) == 0))
                    .collect(),
            }
        } else {
            let text: Vec<u8> = (0..1 + rng.below(40))
                .map(|_| b'a' + rng.below(26) as u8)
                .collect();
            let c = code(&text, rng.below(4) as u8, 0, 8);
            let mut grid = Grid {
                size: c.size,
                weak: vec![0; c.modules.len()],
                bits: c.modules,
            };
            for _ in 0..rng.below(60) {
                let i = rng.below((grid.size * grid.size) as u32) as usize;
                grid.bits[i] ^= 1;
                grid.weak[i] = rng.below(2) as u8;
            }
            if let Ok(words) = decode_grid(&grid) {
                let content = parse(&words.data, words.version).expect("corrected data parses");
                assert_eq!(content.bytes, text, "round {round}");
            }
            continue;
        };
        let _ = decode_grid(&grid);
    }
}
