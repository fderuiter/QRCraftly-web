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

//! The round-trip property over everything the encoder (#1177) can emit: every
//! mask, every mode, mixed segments, ECI and structured append decode to the
//! bytes and segment modes that went in.

mod common;

use common::{plain, Code, Rng};
use qr_decode::bitstream::{MODE_ALPHANUMERIC, MODE_BYTE, MODE_KANJI, MODE_NUMERIC, NO_ECI};
use qr_decode::{decode, Decoded, Options};
use qr_encode::segment::kanji_value;
use qr_encode::{encode, parse_request, FLAG_ECI, FLAG_SEGMENTS, FLAG_STRUCTURED_APPEND};

const MODES: [u8; 4] = [MODE_NUMERIC, MODE_ALPHANUMERIC, MODE_BYTE, MODE_KANJI];

fn data(rng: &mut Rng, mode: u8, chars: usize) -> Vec<u8> {
    const ALNUM: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
    match mode {
        MODE_NUMERIC => (0..chars).map(|_| b'0' + rng.below(10) as u8).collect(),
        MODE_ALPHANUMERIC => (0..chars)
            .map(|_| ALNUM[rng.below(ALNUM.len() as u32) as usize])
            .collect(),
        MODE_BYTE => (0..chars).map(|_| rng.below(256) as u8).collect(),
        _ => {
            let mut out = Vec::new();
            while out.len() < 2 * chars {
                let sjis =
                    if rng.below(2) == 0 { 0x8140 } else { 0xE040 } + rng.below(0x1E00) as u16;
                let trail = sjis & 0xff;
                if (0x40..=0xFC).contains(&trail) && trail != 0x7F && kanji_value(sjis).is_some() {
                    out.extend_from_slice(&sjis.to_be_bytes());
                }
            }
            out
        }
    }
}

/// Encodes caller segments with the given header fields and decodes them back.
fn round_trip(
    ecc: u8,
    version: u8,
    mask: u8,
    segments: &[(u8, Vec<u8>)],
    eci: Option<u32>,
    structured: Option<[u8; 3]>,
) -> Option<Decoded> {
    let mut flags = FLAG_SEGMENTS;
    let mut request = vec![ecc, version, mask, 0];
    if let Some(sa) = structured {
        flags |= FLAG_STRUCTURED_APPEND;
        request.extend_from_slice(&sa);
    }
    if let Some(n) = eci {
        flags |= FLAG_ECI;
        request.extend_from_slice(&n.to_le_bytes());
    }
    request[3] = flags;
    for (mode, bytes) in segments {
        request.push(*mode);
        request.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        request.extend_from_slice(bytes);
    }
    let symbol = encode(&parse_request(&request).expect("request")).ok()?;
    let code = Code {
        size: symbol.matrix.size,
        modules: symbol.matrix.modules.clone(),
    };
    let luma = plain(&code, if code.size > 120 { 3 } else { 4 });
    let mut found = decode(&luma, &Options::default());
    assert_eq!(found.len(), 1, "version {version} level {ecc} mask {mask}");
    found.pop()
}

fn check(got: &Decoded, mask: u8, segments: &[(u8, Vec<u8>)], eci: Option<u32>) {
    let expected: Vec<u8> = segments
        .iter()
        .flat_map(|(_, b)| b.iter().copied())
        .collect();
    assert_eq!(got.mask, mask);
    assert_eq!(got.content.bytes, expected);
    let data: Vec<_> = got
        .content
        .segments
        .iter()
        .filter(|s| MODES.contains(&s.mode))
        .collect();
    assert_eq!(
        data.iter().map(|s| s.mode).collect::<Vec<_>>(),
        segments.iter().map(|(m, _)| *m).collect::<Vec<_>>()
    );
    for s in data {
        assert_eq!(s.eci, eci.unwrap_or(NO_ECI));
    }
}

#[test]
fn every_mask_and_mode_round_trips() {
    let mut rng = Rng(0x1178);
    for mask in 0..8u8 {
        for (m, &mode) in MODES.iter().enumerate() {
            for (k, &version) in [1u8, 7, 10, 27, 40].iter().enumerate() {
                let ecc = ((mask as usize + m + k) % 4) as u8;
                let chars = 3 + rng.below(12 * version as u32) as usize;
                let segments = vec![(mode, data(&mut rng, mode, chars))];
                let Some(got) = round_trip(ecc, version, mask, &segments, None, None) else {
                    continue;
                };
                assert_eq!(got.version, version);
                check(&got, mask, &segments, None);
            }
        }
    }
}

#[test]
fn mixed_segments_eci_and_structured_append_round_trip() {
    let mut rng = Rng(0xEC1);
    for round in 0..40u32 {
        let count = 1 + rng.below(5) as usize;
        let segments: Vec<_> = (0..count)
            .map(|_| {
                let mode = MODES[rng.below(4) as usize];
                let chars = 1 + rng.below(20) as usize;
                (mode, data(&mut rng, mode, chars))
            })
            .collect();
        let eci = [None, Some(3), Some(26), Some(899), Some(123_456)][round as usize % 5];
        let structured = (round % 2 == 1).then(|| {
            let total = 2 + rng.below(15) as u8;
            [rng.below(total as u32) as u8, total, rng.below(256) as u8]
        });
        let mask = (round % 8) as u8;
        let got = round_trip((round % 4) as u8, 0, mask, &segments, eci, structured)
            .expect("fits a symbol");
        check(&got, mask, &segments, eci);
        assert_eq!(
            got.content.structured,
            structured.map(|[i, t, p]| (i, t, p)),
            "round {round}"
        );
    }
}
