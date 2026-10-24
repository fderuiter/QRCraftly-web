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

//! In-house DEFLATE (RFC 1951) decompressor in plain Rust.

extern crate alloc;
use alloc::vec;
use alloc::vec::Vec;

pub struct BitReader<'a> {
    data: &'a [u8],
    pos: usize,
    bit_buf: u32,
    bits_count: u8,
}

impl<'a> BitReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            pos: 0,
            bit_buf: 0,
            bits_count: 0,
        }
    }

    pub fn read_bits(&mut self, count: u8) -> Option<u32> {
        while self.bits_count < count {
            if self.pos >= self.data.len() {
                return None;
            }
            self.bit_buf |= (self.data[self.pos] as u32) << self.bits_count;
            self.pos += 1;
            self.bits_count += 8;
        }
        let val = self.bit_buf & ((1u32 << count) - 1);
        self.bit_buf >>= count;
        self.bits_count -= count;
        Some(val)
    }

    pub fn align_byte(&mut self) {
        let discard = self.bits_count % 8;
        if discard > 0 {
            self.bit_buf >>= discard;
            self.bits_count -= discard;
        }
    }

    pub fn read_bytes(&mut self, len: usize) -> Option<&'a [u8]> {
        self.align_byte();
        let remaining_buffered = (self.bits_count / 8) as usize;
        self.pos -= remaining_buffered;
        self.bit_buf = 0;
        self.bits_count = 0;

        if self.pos + len > self.data.len() {
            None
        } else {
            let res = &self.data[self.pos..self.pos + len];
            self.pos += len;
            Some(res)
        }
    }
}

struct HuffmanTable {
    counts: [u16; 16],
    symbols: Vec<u16>,
}

impl HuffmanTable {
    fn from_lengths(lengths: &[u8]) -> Option<Self> {
        let mut counts = [0u16; 16];
        let mut max_len = 0;
        for &len in lengths {
            if len > 0 {
                if len > 15 {
                    return None;
                }
                counts[len as usize] += 1;
                if len > max_len {
                    max_len = len;
                }
            }
        }

        let mut offsets = [0u16; 16];
        let mut offset = 0u16;
        for i in 1..=15 {
            offsets[i] = offset;
            offset += counts[i];
        }

        let mut symbols = vec![0u16; offset as usize];

        for (sym, &len) in lengths.iter().enumerate() {
            if len > 0 {
                let off = offsets[len as usize];
                symbols[off as usize] = sym as u16;
                offsets[len as usize] += 1;
            }
        }

        Some(Self { counts, symbols })
    }

    fn decode(&self, reader: &mut BitReader) -> Option<u16> {
        let mut code = 0u32;
        let mut first = 0u32;
        let mut index = 0usize;

        for len in 1..=15 {
            let bit = reader.read_bits(1)?;
            code = (code << 1) | bit;
            let count = self.counts[len] as u32;

            if code < first + count {
                let sym_idx = index + (code - first) as usize;
                return self.symbols.get(sym_idx).copied();
            }

            first = (first + count) << 1;
            index += count as usize;
        }
        None
    }
}

static LENGTH_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
static LENGTH_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];

static DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
static DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];

static CODE_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

pub const MAX_UNCOMPRESSED_SIZE: usize = 64 * 1024 * 1024;

pub fn decompress_deflate(input: &[u8], max_size: usize) -> Option<Vec<u8>> {
    let mut reader = BitReader::new(input);
    let mut out = Vec::new();

    loop {
        let bfinal = reader.read_bits(1)?;
        let btype = reader.read_bits(2)?;

        match btype {
            0 => {
                reader.align_byte();
                let len = reader.read_bits(16)? as usize;
                let nlen = reader.read_bits(16)? as usize;
                if (len ^ 0xFFFF) != nlen {
                    return None;
                }
                if out.len().checked_add(len)? > max_size {
                    return None;
                }
                let bytes = reader.read_bytes(len)?;
                out.extend_from_slice(bytes);
            }
            1 => {
                let mut lit_lens = [0u8; 288];
                lit_lens[..144].fill(8);
                lit_lens[144..256].fill(9);
                lit_lens[256..280].fill(7);
                lit_lens[280..288].fill(8);
                let lit_table = HuffmanTable::from_lengths(&lit_lens)?;

                let dist_lens = [5u8; 32];
                let dist_table = HuffmanTable::from_lengths(&dist_lens)?;

                decode_block(&mut reader, &lit_table, &dist_table, &mut out, max_size)?;
            }
            2 => {
                let hlit = (reader.read_bits(5)? + 257) as usize;
                let hdist = (reader.read_bits(5)? + 1) as usize;
                let hclen = (reader.read_bits(4)? + 4) as usize;

                let mut code_lens = [0u8; 19];
                for i in 0..hclen {
                    code_lens[CODE_ORDER[i]] = reader.read_bits(3)? as u8;
                }
                let code_table = HuffmanTable::from_lengths(&code_lens)?;

                let total = hlit + hdist;
                let mut combined_lens = Vec::with_capacity(total);
                while combined_lens.len() < total {
                    let sym = code_table.decode(&mut reader)?;
                    match sym {
                        0..=15 => combined_lens.push(sym as u8),
                        16 => {
                            let last = *combined_lens.last()?;
                            let rep = (reader.read_bits(2)? + 3) as usize;
                            if combined_lens.len().checked_add(rep)? > total {
                                return None;
                            }
                            combined_lens.resize(combined_lens.len() + rep, last);
                        }
                        17 => {
                            let rep = (reader.read_bits(3)? + 3) as usize;
                            if combined_lens.len().checked_add(rep)? > total {
                                return None;
                            }
                            combined_lens.resize(combined_lens.len() + rep, 0);
                        }
                        18 => {
                            let rep = (reader.read_bits(7)? + 11) as usize;
                            if combined_lens.len().checked_add(rep)? > total {
                                return None;
                            }
                            combined_lens.resize(combined_lens.len() + rep, 0);
                        }
                        _ => return None,
                    }
                }

                let lit_table = HuffmanTable::from_lengths(&combined_lens[..hlit])?;
                let dist_table = HuffmanTable::from_lengths(&combined_lens[hlit..])?;

                decode_block(&mut reader, &lit_table, &dist_table, &mut out, max_size)?;
            }
            _ => return None,
        }

        if bfinal != 0 {
            break;
        }
    }

    Some(out)
}

fn decode_block(
    reader: &mut BitReader,
    lit_table: &HuffmanTable,
    dist_table: &HuffmanTable,
    out: &mut Vec<u8>,
    max_size: usize,
) -> Option<()> {
    loop {
        if out.len() > max_size {
            return None;
        }
        let sym = lit_table.decode(reader)?;
        if sym < 256 {
            if out.len() >= max_size {
                return None;
            }
            out.push(sym as u8);
        } else if sym == 256 {
            break;
        } else {
            let len_idx = (sym - 257) as usize;
            if len_idx >= LENGTH_BASE.len() {
                return None;
            }
            let base_len = LENGTH_BASE[len_idx] as usize;
            let extra_bits = LENGTH_EXTRA[len_idx];
            let add_len = if extra_bits > 0 {
                reader.read_bits(extra_bits)? as usize
            } else {
                0
            };
            let match_len = base_len + add_len;

            let dist_sym = dist_table.decode(reader)? as usize;
            if dist_sym >= DIST_BASE.len() {
                return None;
            }
            let base_dist = DIST_BASE[dist_sym] as usize;
            let dist_extra_bits = DIST_EXTRA[dist_sym];
            let add_dist = if dist_extra_bits > 0 {
                reader.read_bits(dist_extra_bits)? as usize
            } else {
                0
            };
            let match_dist = base_dist + add_dist;

            if match_dist > out.len() {
                return None;
            }

            if out.len().checked_add(match_len)? > max_size {
                return None;
            }

            let start = out.len() - match_dist;
            for i in 0..match_len {
                let byte = out[start + i];
                out.push(byte);
            }
        }
    }
    Some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uncompressed_block_round_trip() {
        let input = [1, 5, 0, 250, 255, b'H', b'e', b'l', b'l', b'o'];
        let decompressed = decompress_deflate(&input, MAX_UNCOMPRESSED_SIZE).unwrap();
        assert_eq!(decompressed, b"Hello");
    }

    #[test]
    fn rejects_uncompressed_block_exceeding_max_size() {
        // Valid uncompressed block header claiming 15 bytes payload (LEN=15, NLEN=~15=65520)
        let mut input = vec![
            0x01, // BFINAL=1, BTYPE=00
            0x0F, // LEN low
            0x00, // LEN high (15)
            0xF0, // NLEN low
            0xFF, // NLEN high (~15 = 0xFFF0)
        ];
        input.extend_from_slice(b"123456789012345"); // 15 valid payload bytes

        // With max_size=10, decompress_deflate returns None because 15 > 10
        assert!(decompress_deflate(&input, 10).is_none());
        // With max_size=20, decompress_deflate succeeds and returns 15 bytes
        assert_eq!(decompress_deflate(&input, 20).unwrap(), b"123456789012345");
    }

    // Raw DEFLATE (no zlib header) produced by Python's zlib as a reference encoder:
    // zlib.compressobj(9, zlib.DEFLATED, -15).
    // Block type check: the first byte is 0xcb = 0b11001011. Bit 0 is BFINAL = 1 and
    // bits 1-2 are BTYPE = 01, so the single block is FIXED-Huffman.
    #[test]
    fn inflates_fixed_huffman_block_from_zlib() {
        let compressed: [u8; 15] = [
            0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x57, 0xc8, 0x40, 0x22, 0xcb, 0xf3, 0x8b, 0x72, 0x52,
            0x00,
        ];
        let expected: &[u8] = b"hello hello hello world";
        let decompressed = decompress_deflate(&compressed, MAX_UNCOMPRESSED_SIZE).unwrap();
        assert_eq!(decompressed, expected);
    }

    // Raw DEFLATE (no zlib header) produced by Python's zlib as a reference encoder:
    // zlib.compressobj(9, zlib.DEFLATED, -15) over a 594-byte CSV-like input.
    // Block type check: the first byte is 0x7d = 0b01111101. Bit 0 is BFINAL = 1 and
    // bits 1-2 are BTYPE = 10, so the single block is DYNAMIC-Huffman.
    #[test]
    fn inflates_dynamic_huffman_block_from_zlib() {
        let compressed: [u8; 161] = [
            0x7d, 0xd2, 0xcd, 0x0a, 0x02, 0x21, 0x14, 0x86, 0xe1, 0x7d, 0x57, 0x21, 0xb3, 0x96,
            0xf4, 0xf8, 0x3b, 0x76, 0x0d, 0x21, 0x14, 0x74, 0x01, 0x43, 0x09, 0x05, 0x89, 0x43,
            0x19, 0xcd, 0xe5, 0x37, 0x74, 0x5a, 0x99, 0xba, 0x3d, 0x9c, 0x67, 0xf3, 0xf2, 0xf9,
            0x29, 0x06, 0x7a, 0x3a, 0xee, 0xa9, 0x4f, 0x39, 0x6c, 0x1e, 0xe9, 0xcd, 0x81, 0xfa,
            0xf5, 0x46, 0x80, 0x5e, 0x73, 0x9e, 0x9f, 0x3b, 0xc6, 0xc2, 0x32, 0xc5, 0xf9, 0x1e,
            0xb6, 0xe7, 0x14, 0xd9, 0x2d, 0x87, 0xc8, 0x2c, 0x1d, 0x0e, 0xaf, 0xf5, 0xfd, 0x42,
            0x49, 0x0e, 0x4b, 0x26, 0x30, 0x7c, 0xa1, 0x40, 0x28, 0xda, 0x10, 0x54, 0x21, 0x05,
            0x4a, 0x89, 0x52, 0xb6, 0xa5, 0x80, 0x42, 0x4a, 0x94, 0x0a, 0xa5, 0xea, 0xc8, 0xb1,
            0x90, 0x0a, 0xa5, 0x46, 0xa9, 0xdb, 0x52, 0xea, 0x42, 0x72, 0x94, 0x06, 0xa5, 0x69,
            0x4b, 0x25, 0xea, 0x85, 0x2c, 0x4a, 0xdb, 0x91, 0xae, 0x5e, 0x68, 0x44, 0x39, 0xb6,
            0xa5, 0x36, 0xf5, 0x42, 0x0e, 0xa5, 0x6b, 0x4b, 0x23, 0xab, 0x85, 0x80, 0xff, 0x86,
            0xc0, 0x3b, 0x4b, 0xe0, 0xff, 0x89, 0x3e,
        ];
        let expected: &[u8] = b"Name,URL,Note\nrow01,Name 1,https://example.com/item/7,\"Quoted, text 1\"\nrow02,Name 2,https://example.com/item/14,\"Quoted, text 2\"\nrow03,Name 3,https://example.com/item/21,\"Quoted, text 3\"\nrow04,Name 4,https://example.com/item/28,\"Quoted, text 4\"\nrow05,Name 5,https://example.com/item/35,\"Quoted, text 0\"\nrow06,Name 6,https://example.com/item/42,\"Quoted, text 1\"\nrow07,Name 7,https://example.com/item/49,\"Quoted, text 2\"\nrow08,Name 8,https://example.com/item/56,\"Quoted, text 3\"\nrow09,Name 9,https://example.com/item/63,\"Quoted, text 4\"\nrow10,Name 10,https://example.com/item/70,\"Quoted, text 0\"\n";
        let decompressed = decompress_deflate(&compressed, MAX_UNCOMPRESSED_SIZE).unwrap();
        assert_eq!(decompressed, expected);
    }
}
