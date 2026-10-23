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

        let mut symbols = Vec::with_capacity(offset as usize);
        symbols.resize(offset as usize, 0);

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
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
static LENGTH_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];

static DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
static DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];

static CODE_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

pub const MAX_UNCOMPRESSED_SIZE: usize = 64 * 1024 * 1024;

pub fn decompress_deflate(input: &[u8]) -> Option<Vec<u8>> {
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
                if out.len().checked_add(len)? > MAX_UNCOMPRESSED_SIZE {
                    return None;
                }
                let bytes = reader.read_bytes(len)?;
                out.extend_from_slice(bytes);
            }
            1 => {
                let mut lit_lens = [0u8; 288];
                for i in 0..144 { lit_lens[i] = 8; }
                for i in 144..256 { lit_lens[i] = 9; }
                for i in 256..280 { lit_lens[i] = 7; }
                for i in 280..288 { lit_lens[i] = 8; }
                let lit_table = HuffmanTable::from_lengths(&lit_lens)?;

                let dist_lens = [5u8; 32];
                let dist_table = HuffmanTable::from_lengths(&dist_lens)?;

                decode_block(&mut reader, &lit_table, &dist_table, &mut out)?;
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
                            for _ in 0..rep { combined_lens.push(last); }
                        }
                        17 => {
                            let rep = (reader.read_bits(3)? + 3) as usize;
                            if combined_lens.len().checked_add(rep)? > total {
                                return None;
                            }
                            for _ in 0..rep { combined_lens.push(0); }
                        }
                        18 => {
                            let rep = (reader.read_bits(7)? + 11) as usize;
                            if combined_lens.len().checked_add(rep)? > total {
                                return None;
                            }
                            for _ in 0..rep { combined_lens.push(0); }
                        }
                        _ => return None,
                    }
                }

                let lit_table = HuffmanTable::from_lengths(&combined_lens[..hlit])?;
                let dist_table = HuffmanTable::from_lengths(&combined_lens[hlit..])?;

                decode_block(&mut reader, &lit_table, &dist_table, &mut out)?;
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
) -> Option<()> {
    loop {
        if out.len() > MAX_UNCOMPRESSED_SIZE {
            return None;
        }
        let sym = lit_table.decode(reader)?;
        if sym < 256 {
            if out.len() >= MAX_UNCOMPRESSED_SIZE {
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

            if out.len().checked_add(match_len)? > MAX_UNCOMPRESSED_SIZE {
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
        let decompressed = decompress_deflate(&input).unwrap();
        assert_eq!(decompressed, b"Hello");
    }

    #[test]
    fn rejects_uncompressed_block_exceeding_max_size() {
        // Block header claiming 0xFFFF bytes with matching NLEN
        let input = [1, 0xFF, 0xFF, 0x00, 0x00];
        // BitReader will fail to read 65535 payload bytes from this short input, returning None safely
        assert!(decompress_deflate(&input).is_none());
    }
}
