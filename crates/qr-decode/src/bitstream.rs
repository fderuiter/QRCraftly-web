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

//! The data bit stream: mode indicators, character counts and every mode
//! (numeric, alphanumeric, byte, kanji, hanzi), plus ECI, structured append
//! and FNC1 headers.
//!
//! Characters come out as bytes: digits and alphanumerics as ASCII, byte mode
//! as written, kanji as two Shift JIS bytes and hanzi as two GB 2312 bytes.
//! Turning them into text is left to the caller, which knows the charsets.

use alloc::vec::Vec;

pub const MODE_NUMERIC: u8 = 1;
pub const MODE_ALPHANUMERIC: u8 = 2;
pub const MODE_STRUCTURED_APPEND: u8 = 3;
pub const MODE_BYTE: u8 = 4;
pub const MODE_FNC1_FIRST: u8 = 5;
pub const MODE_ECI: u8 = 7;
pub const MODE_KANJI: u8 = 8;
pub const MODE_FNC1_SECOND: u8 = 9;
pub const MODE_HANZI: u8 = 13;

/// No ECI designator has been read.
pub const NO_ECI: u32 = u32::MAX;

const ALPHANUMERIC: &[u8; 45] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/// A run of characters in one mode, as a range of [`Content::bytes`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub mode: u8,
    /// The ECI assignment in force, or [`NO_ECI`].
    pub eci: u32,
    pub start: usize,
    pub len: usize,
}

/// Everything a symbol's data stream carries.
#[derive(Debug, Default, PartialEq)]
pub struct Content {
    pub bytes: Vec<u8>,
    pub segments: Vec<Segment>,
    /// Structured append: index, total and parity.
    pub structured: Option<(u8, u8, u8)>,
    /// 0 none, 1 GS1 (FNC1 first position), 2 FNC1 second position.
    pub fnc1: u8,
}

struct Bits<'a> {
    data: &'a [u8],
    at: usize,
}

impl Bits<'_> {
    fn remaining(&self) -> usize {
        self.data.len() * 8 - self.at
    }

    fn read(&mut self, count: usize) -> Option<u32> {
        if count > self.remaining() {
            return None;
        }
        let mut value = 0u32;
        for _ in 0..count {
            let bit = (self.data[self.at / 8] >> (7 - self.at % 8)) & 1;
            value = (value << 1) | bit as u32;
            self.at += 1;
        }
        Some(value)
    }
}

/// Character count bits per mode and version range (1 to 9, 10 to 26, 27 to 40).
fn count_bits(mode: u8, version: u8) -> usize {
    let range = if version < 10 {
        0
    } else if version < 27 {
        1
    } else {
        2
    };
    let table: [usize; 3] = match mode {
        MODE_NUMERIC => [10, 12, 14],
        MODE_ALPHANUMERIC => [9, 11, 13],
        MODE_BYTE => [8, 16, 16],
        _ => [8, 10, 12],
    };
    table[range]
}

/// Parses a symbol's data codewords. `None` for a malformed or truncated stream.
pub fn parse(data: &[u8], version: u8) -> Option<Content> {
    let mut bits = Bits { data, at: 0 };
    let mut out = Content::default();
    let mut eci = NO_ECI;
    while bits.remaining() >= 4 {
        let mode = bits.read(4)? as u8;
        let start = out.bytes.len();
        match mode {
            0 => break,
            MODE_ECI => {
                let first = bits.read(8)?;
                eci = if first & 0x80 == 0 {
                    first
                } else if first & 0xC0 == 0x80 {
                    ((first & 0x3F) << 8) | bits.read(8)?
                } else if first & 0xE0 == 0xC0 {
                    ((first & 0x1F) << 16) | bits.read(16)?
                } else {
                    return None;
                };
                continue;
            }
            MODE_STRUCTURED_APPEND => {
                let index = bits.read(4)? as u8;
                let total = bits.read(4)? as u8 + 1;
                let parity = bits.read(8)? as u8;
                out.structured = Some((index, total, parity));
                continue;
            }
            MODE_FNC1_FIRST => {
                out.fnc1 = 1;
                continue;
            }
            MODE_FNC1_SECOND => {
                bits.read(8)?;
                out.fnc1 = 2;
                continue;
            }
            MODE_NUMERIC => {
                let mut count = bits.read(count_bits(mode, version))? as usize;
                while count > 0 {
                    let (digits, width, limit) = match count {
                        1 => (1, 4, 10),
                        2 => (2, 7, 100),
                        _ => (3, 10, 1000),
                    };
                    let mut value = bits.read(width)?;
                    if value >= limit {
                        return None;
                    }
                    let mut chars = [0u8; 3];
                    for i in (0..digits).rev() {
                        chars[i] = b'0' + (value % 10) as u8;
                        value /= 10;
                    }
                    out.bytes.extend_from_slice(&chars[..digits]);
                    count -= digits;
                }
            }
            MODE_ALPHANUMERIC => {
                let mut count = bits.read(count_bits(mode, version))? as usize;
                while count >= 2 {
                    let value = bits.read(11)? as usize;
                    if value >= 45 * 45 {
                        return None;
                    }
                    out.bytes.push(ALPHANUMERIC[value / 45]);
                    out.bytes.push(ALPHANUMERIC[value % 45]);
                    count -= 2;
                }
                if count == 1 {
                    let value = bits.read(6)? as usize;
                    out.bytes.push(*ALPHANUMERIC.get(value)?);
                }
            }
            MODE_BYTE => {
                let count = bits.read(count_bits(mode, version))? as usize;
                if count * 8 > bits.remaining() {
                    return None;
                }
                for _ in 0..count {
                    out.bytes.push(bits.read(8)? as u8);
                }
            }
            MODE_KANJI | MODE_HANZI => {
                if mode == MODE_HANZI && bits.read(4)? != 1 {
                    // Only the GB 2312 subset is defined.
                    return None;
                }
                let count = bits.read(count_bits(mode, version))? as usize;
                if count * 13 > bits.remaining() {
                    return None;
                }
                for _ in 0..count {
                    let value = bits.read(13)?;
                    let code = if mode == MODE_KANJI {
                        let packed = ((value / 0xC0) << 8) | (value % 0xC0);
                        packed + if packed < 0x1F00 { 0x8140 } else { 0xC140 }
                    } else {
                        let packed = ((value / 0x60) << 8) | (value % 0x60);
                        packed + if packed < 0x0A00 { 0xA1A1 } else { 0xA6A1 }
                    };
                    out.bytes.push((code >> 8) as u8);
                    out.bytes.push(code as u8);
                }
            }
            _ => return None,
        }
        out.segments.push(Segment {
            mode,
            eci,
            start,
            len: out.bytes.len() - start,
        });
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    /// Packs (value, width) pairs into bytes, zero padded.
    fn pack(fields: &[(u32, usize)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut acc = 0u64;
        let mut n = 0;
        for &(value, width) in fields {
            acc = (acc << width) | value as u64;
            n += width;
            while n >= 8 {
                out.push((acc >> (n - 8)) as u8);
                n -= 8;
            }
        }
        if n > 0 {
            out.push((acc << (8 - n)) as u8);
        }
        out
    }

    #[test]
    fn numeric_from_the_specification() {
        // ISO/IEC 18004 7.4.3: "01234567" at version 1.
        let data = pack(&[(1, 4), (8, 10), (12, 10), (345, 10), (67, 7), (0, 4)]);
        let content = parse(&data, 1).unwrap();
        assert_eq!(content.bytes, b"01234567");
        assert_eq!(
            content.segments,
            vec![Segment {
                mode: 1,
                eci: NO_ECI,
                start: 0,
                len: 8
            }]
        );
    }

    #[test]
    fn alphanumeric_byte_and_eci() {
        // "AC-42" alphanumeric, then ECI 26 and two bytes.
        let data = pack(&[
            (2, 4),
            (5, 9),
            (10 * 45 + 12, 11),
            (41 * 45 + 4, 11),
            (2, 6),
            (7, 4),
            (26, 8),
            (4, 4),
            (2, 8),
            (0xC3, 8),
            (0xA9, 8),
        ]);
        let content = parse(&data, 1).unwrap();
        assert_eq!(content.bytes, b"AC-42\xC3\xA9");
        assert_eq!(
            content.segments[1],
            Segment {
                mode: 4,
                eci: 26,
                start: 5,
                len: 2
            }
        );
    }

    #[test]
    fn kanji_becomes_shift_jis() {
        // The specification's example: 点 (0x935F) and 茗 (0xE4AA).
        let data = pack(&[(8, 4), (2, 8), (0x0D9F, 13), (0x1AAA, 13)]);
        assert_eq!(parse(&data, 1).unwrap().bytes, vec![0x93, 0x5F, 0xE4, 0xAA]);
    }

    #[test]
    fn structured_append_header() {
        let data = pack(&[
            (3, 4),
            (1, 4),
            (3, 4),
            (0x5A, 8),
            (4, 4),
            (1, 8),
            (b'x' as u32, 8),
        ]);
        let content = parse(&data, 1).unwrap();
        assert_eq!(content.structured, Some((1, 4, 0x5A)));
        assert_eq!(content.bytes, b"x");
    }

    #[test]
    fn malformed_streams_fail() {
        // Byte mode claiming more bytes than there are.
        assert_eq!(parse(&pack(&[(4, 4), (200, 8), (1, 8)]), 1), None);
        // Numeric triple over 999.
        assert_eq!(parse(&pack(&[(1, 4), (3, 10), (1000, 10)]), 1), None);
        // Unknown mode.
        assert_eq!(parse(&pack(&[(6, 4), (0, 4)]), 1), None);
        assert_eq!(parse(&[], 1), Some(Content::default()));
    }
}
