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

//! Data segments: modes, character count fields, bit costs and the bit stream.

use alloc::vec::Vec;

/// A segment's encoding mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Numeric,
    Alphanumeric,
    Byte,
    Kanji,
    /// Extended Channel Interpretation: switches the character set that follows.
    Eci,
}

impl Mode {
    /// The 4-bit mode indicator, also the mode's code in the ABI.
    pub fn indicator(self) -> u32 {
        match self {
            Mode::Numeric => 1,
            Mode::Alphanumeric => 2,
            Mode::Byte => 4,
            Mode::Kanji => 8,
            Mode::Eci => 7,
        }
    }

    pub fn from_indicator(code: u8) -> Option<Mode> {
        match code {
            1 => Some(Mode::Numeric),
            2 => Some(Mode::Alphanumeric),
            4 => Some(Mode::Byte),
            8 => Some(Mode::Kanji),
            7 => Some(Mode::Eci),
            _ => None,
        }
    }

    /// Width of the character count field. ECI segments have none.
    pub fn count_bits(self, version: u8) -> u32 {
        let range = if version < 10 {
            0
        } else if version < 27 {
            1
        } else {
            2
        };
        match self {
            Mode::Numeric => [10, 12, 14][range],
            Mode::Alphanumeric => [9, 11, 13][range],
            Mode::Byte => [8, 16, 16][range],
            Mode::Kanji => [8, 10, 12][range],
            Mode::Eci => 0,
        }
    }

    /// Bits for `chars` characters of payload, without the mode indicator or count.
    pub fn payload_bits(self, chars: usize) -> usize {
        match self {
            Mode::Numeric => 10 * (chars / 3) + [0, 4, 7][chars % 3],
            Mode::Alphanumeric => 11 * (chars / 2) + 6 * (chars % 2),
            Mode::Byte => 8 * chars,
            Mode::Kanji => 13 * chars,
            Mode::Eci => eci_bits(chars as u32),
        }
    }
}

/// The 45 characters of alphanumeric mode, in code order.
const ALPHANUMERIC: &[u8; 45] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

pub fn alphanumeric_code(byte: u8) -> Option<u32> {
    ALPHANUMERIC
        .iter()
        .position(|&c| c == byte)
        .map(|i| i as u32)
}

pub fn is_numeric(byte: u8) -> bool {
    byte.is_ascii_digit()
}

pub fn is_alphanumeric(byte: u8) -> bool {
    alphanumeric_code(byte).is_some()
}

/// The largest ECI assignment number (six decimal digits).
pub const MAX_ECI: u32 = 999_999;

fn eci_bits(assignment: u32) -> usize {
    if assignment < 128 {
        8
    } else if assignment < 16_384 {
        16
    } else {
        24
    }
}

/// Converts a Shift JIS code to the 13-bit kanji mode value, or `None` outside the
/// two ranges kanji mode covers.
pub fn kanji_value(sjis: u16) -> Option<u32> {
    let offset = match sjis {
        0x8140..=0x9FFC => sjis - 0x8140,
        0xE040..=0xEBBF => sjis - 0xC140,
        _ => return None,
    } as u32;
    let value = (offset >> 8) * 0xC0 + (offset & 0xFF);
    // The low byte of a valid Shift JIS code keeps the value under 2^13.
    (value < 0x2000).then_some(value)
}

/// One segment. `data` holds ASCII digits or alphanumeric characters, raw bytes,
/// or big-endian Shift JIS pairs, by mode. For ECI, `chars` is the assignment number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Segment<'a> {
    pub mode: Mode,
    pub data: &'a [u8],
    pub chars: usize,
    /// Where `data` starts in the caller's input, reported back in the result.
    pub offset: usize,
}

impl<'a> Segment<'a> {
    /// A segment over `data`, checked against its mode. `offset` is reported back.
    pub fn new(mode: Mode, data: &'a [u8], offset: usize) -> Option<Segment<'a>> {
        let chars = match mode {
            Mode::Numeric if data.iter().all(|&b| is_numeric(b)) => data.len(),
            Mode::Alphanumeric if data.iter().all(|&b| is_alphanumeric(b)) => data.len(),
            Mode::Byte => data.len(),
            Mode::Kanji
                if data.len().is_multiple_of(2)
                    && data
                        .chunks_exact(2)
                        .all(|p| kanji_value(u16::from_be_bytes([p[0], p[1]])).is_some()) =>
            {
                data.len() / 2
            }
            _ => return None,
        };
        Some(Segment {
            mode,
            data,
            chars,
            offset,
        })
    }

    pub fn eci(assignment: u32) -> Option<Segment<'static>> {
        (assignment <= MAX_ECI).then_some(Segment {
            mode: Mode::Eci,
            data: &[],
            chars: assignment as usize,
            offset: 0,
        })
    }

    /// Bits including the mode indicator and count, or `None` when the count
    /// does not fit its field at `version`.
    pub fn total_bits(&self, version: u8) -> Option<usize> {
        let count_bits = self.mode.count_bits(version);
        if self.mode != Mode::Eci && self.chars >= 1usize << count_bits {
            return None;
        }
        Some(4 + count_bits as usize + self.mode.payload_bits(self.chars))
    }

    pub fn write(&self, version: u8, out: &mut BitBuffer) {
        out.put(self.mode.indicator(), 4);
        match self.mode {
            Mode::Eci => {
                let n = self.chars as u32;
                match eci_bits(n) {
                    8 => out.put(n, 8),
                    16 => out.put(0b10 << 14 | n, 16),
                    _ => out.put(0b110 << 21 | n, 24),
                }
                return;
            }
            mode => out.put(self.chars as u32, mode.count_bits(version)),
        }
        match self.mode {
            Mode::Numeric => {
                for group in self.data.chunks(3) {
                    let value = group
                        .iter()
                        .fold(0u32, |acc, &d| acc * 10 + (d - b'0') as u32);
                    out.put(value, group.len() as u32 * 3 + 1);
                }
            }
            Mode::Alphanumeric => {
                for pair in self.data.chunks(2) {
                    let first = alphanumeric_code(pair[0]).unwrap_or(0);
                    match pair.get(1) {
                        Some(&second) => {
                            out.put(first * 45 + alphanumeric_code(second).unwrap_or(0), 11)
                        }
                        None => out.put(first, 6),
                    }
                }
            }
            Mode::Byte => {
                for &byte in self.data {
                    out.put(byte as u32, 8);
                }
            }
            Mode::Kanji => {
                for pair in self.data.chunks_exact(2) {
                    let value = kanji_value(u16::from_be_bytes([pair[0], pair[1]])).unwrap_or(0);
                    out.put(value, 13);
                }
            }
            Mode::Eci => {}
        }
    }
}

/// Structured append header: this symbol's position, the symbol count and the
/// parity byte of the whole message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StructuredAppend {
    pub index: u8,
    pub total: u8,
    pub parity: u8,
}

impl StructuredAppend {
    pub const BITS: usize = 20;

    pub fn new(index: u8, total: u8, parity: u8) -> Option<StructuredAppend> {
        ((2..=16).contains(&total) && index < total).then_some(StructuredAppend {
            index,
            total,
            parity,
        })
    }

    pub fn write(&self, out: &mut BitBuffer) {
        out.put(0b0011, 4);
        out.put(self.index as u32, 4);
        out.put(self.total as u32 - 1, 4);
        out.put(self.parity as u32, 8);
    }
}

/// Bits for a header and segments at `version`, or `None` if a count overflows.
pub fn total_bits(
    header: Option<&StructuredAppend>,
    segments: &[Segment<'_>],
    version: u8,
) -> Option<usize> {
    let mut bits = if header.is_some() {
        StructuredAppend::BITS
    } else {
        0
    };
    for segment in segments {
        bits = bits.checked_add(segment.total_bits(version)?)?;
    }
    Some(bits)
}

/// A most-significant-bit-first bit stream.
pub struct BitBuffer {
    pub bytes: Vec<u8>,
    pub len: usize,
}

impl BitBuffer {
    pub fn with_capacity(bytes: usize) -> BitBuffer {
        BitBuffer {
            bytes: Vec::with_capacity(bytes),
            len: 0,
        }
    }

    /// Appends the low `count` bits of `value`, most significant first.
    pub fn put(&mut self, value: u32, count: u32) {
        for i in (0..count).rev() {
            self.put_bit((value >> i) & 1 == 1);
        }
    }

    pub fn put_bit(&mut self, bit: bool) {
        if self.len.is_multiple_of(8) {
            self.bytes.push(0);
        }
        if bit {
            let last = self.bytes.len() - 1;
            self.bytes[last] |= 0x80 >> (self.len % 8);
        }
        self.len += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bits_of(buffer: &BitBuffer) -> alloc::string::String {
        (0..buffer.len)
            .map(|i| {
                if buffer.bytes[i / 8] & (0x80 >> (i % 8)) != 0 {
                    '1'
                } else {
                    '0'
                }
            })
            .collect()
    }

    #[test]
    fn numeric_matches_the_specification_example() {
        // ISO/IEC 18004 7.4.3: "01234567" at version 1.
        let seg = Segment::new(Mode::Numeric, b"01234567", 0).unwrap();
        let mut out = BitBuffer::with_capacity(8);
        seg.write(1, &mut out);
        assert_eq!(bits_of(&out), "00010000001000000000110001010110011000011");
        assert_eq!(seg.total_bits(1), Some(out.len));
    }

    #[test]
    fn alphanumeric_matches_the_specification_example() {
        // ISO/IEC 18004 7.4.4: "AC-42" at version 1.
        let seg = Segment::new(Mode::Alphanumeric, b"AC-42", 0).unwrap();
        let mut out = BitBuffer::with_capacity(8);
        seg.write(1, &mut out);
        assert_eq!(bits_of(&out), "00100000001010011100111011100111001000010");
        assert_eq!(seg.total_bits(1), Some(out.len));
    }

    #[test]
    fn kanji_values_match_the_specification_examples() {
        assert_eq!(kanji_value(0x935F), Some(0x0D9F));
        assert_eq!(kanji_value(0xE4AA), Some(0x1AAA));
        assert_eq!(kanji_value(0x0041), None);
        assert!(Segment::new(Mode::Kanji, &[0x93, 0x5F, 0xE4], 0).is_none());
    }

    #[test]
    fn rejects_characters_outside_the_mode() {
        assert!(Segment::new(Mode::Numeric, b"12a", 0).is_none());
        assert!(Segment::new(Mode::Alphanumeric, b"abc", 0).is_none());
        assert!(Segment::new(Mode::Byte, b"anything \xff", 0).is_some());
        assert!(Segment::new(Mode::Eci, b"", 0).is_none());
    }

    #[test]
    fn eci_designators_use_one_to_three_bytes() {
        for (n, expected) in [
            (26u32, "011100011010"),
            (1000, "01111000001111101000"),
            (999_999, "0111110011110100001000111111"),
        ] {
            let seg = Segment::eci(n).unwrap();
            let mut out = BitBuffer::with_capacity(4);
            seg.write(1, &mut out);
            assert_eq!(bits_of(&out), expected, "ECI {n}");
            assert_eq!(seg.total_bits(1), Some(out.len));
        }
        assert!(Segment::eci(MAX_ECI + 1).is_none());
    }

    #[test]
    fn counts_that_overflow_their_field_do_not_fit() {
        let data = [b'A'; 256];
        let seg = Segment::new(Mode::Byte, &data, 0).unwrap();
        assert_eq!(seg.total_bits(9), None);
        assert_eq!(seg.total_bits(10), Some(4 + 16 + 256 * 8));
    }

    #[test]
    fn structured_append_header() {
        assert!(StructuredAppend::new(2, 2, 0).is_none());
        assert!(StructuredAppend::new(0, 17, 0).is_none());
        let header = StructuredAppend::new(1, 3, 0xA5).unwrap();
        let mut out = BitBuffer::with_capacity(3);
        header.write(&mut out);
        assert_eq!(bits_of(&out), "00110001001010100101");
    }
}
