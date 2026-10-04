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

//! Codewords and the module matrix: padding, Reed-Solomon blocks and their
//! interleaving, function patterns, data placement, masking and the format and
//! version information.
//!
//! Layout and mask scoring follow the `qrcode` package the encoder replaced, so
//! the same segments and mask give the same matrix bit for bit, and the same
//! automatic mask choice.

use crate::segment::{BitBuffer, Segment, StructuredAppend};
use crate::tables::{
    alignment_coords, data_codewords, ec_blocks, ec_codewords, symbol_size, total_codewords, Ecc,
};
use alloc::vec;
use alloc::vec::Vec;
use qrcraftly_core::reed_solomon;

/// Data codewords followed by error correction codewords, interleaved by block.
pub fn codewords(
    header: Option<&StructuredAppend>,
    segments: &[Segment<'_>],
    version: u8,
    ecc: Ecc,
) -> Vec<u8> {
    let data_len = data_codewords(version, ecc);
    let capacity_bits = data_len * 8;
    let mut bits = BitBuffer::with_capacity(data_len);
    if let Some(header) = header {
        header.write(&mut bits);
    }
    for segment in segments {
        segment.write(version, &mut bits);
    }
    // Terminator, then zero bits to a byte boundary, then alternating pad bytes.
    if bits.len + 4 <= capacity_bits {
        bits.put(0, 4);
    }
    while !bits.len.is_multiple_of(8) {
        bits.put_bit(false);
    }
    let mut pad = 0xEC;
    while bits.bytes.len() < data_len {
        bits.bytes.push(pad);
        pad ^= 0xEC ^ 0x11;
    }
    let data = bits.bytes;

    let total = total_codewords(version);
    let blocks = ec_blocks(version, ecc);
    let ec_per_block = ec_codewords(version, ecc) / blocks;
    let long_blocks = total % blocks;
    let short_blocks = blocks - long_blocks;
    let short_data = data_len / blocks;

    let mut generator = [0u8; reed_solomon::MAX_DEGREE + 1];
    reed_solomon::generator(ec_per_block, &mut generator);
    let generator = &generator[..=ec_per_block];

    let mut ec = vec![0u8; blocks * ec_per_block];
    let mut starts = [0usize; 82];
    let mut offset = 0;
    for b in 0..blocks {
        let len = short_data + usize::from(b >= short_blocks);
        starts[b] = offset;
        reed_solomon::encode(
            &data[offset..offset + len],
            generator,
            &mut ec[b * ec_per_block..(b + 1) * ec_per_block],
        );
        offset += len;
    }
    starts[blocks] = offset;

    let mut out = Vec::with_capacity(total);
    for i in 0..=short_data {
        for b in 0..blocks {
            if starts[b] + i < starts[b + 1] {
                out.push(data[starts[b] + i]);
            }
        }
    }
    for i in 0..ec_per_block {
        for b in 0..blocks {
            out.push(ec[b * ec_per_block + i]);
        }
    }
    out
}

/// A square of modules (1 dark, 0 light) and which of them are function patterns.
pub struct Matrix {
    pub size: usize,
    pub modules: Vec<u8>,
    reserved: Vec<u8>,
}

/// Format information: level and mask with their BCH(15,5) code, masked with 0x5412.
pub fn format_bits(ecc: Ecc, mask: u8) -> u32 {
    let data = (ecc.format_bits() << 3) | mask as u32;
    let mut rem = data << 10;
    for i in (10..15).rev() {
        if rem & (1 << i) != 0 {
            rem ^= 0x537 << (i - 10);
        }
    }
    ((data << 10) | rem) ^ 0x5412
}

/// Version information: the version with its BCH(18,6) code.
pub fn version_bits(version: u8) -> u32 {
    let data = version as u32;
    let mut rem = data << 12;
    for i in (12..18).rev() {
        if rem & (1 << i) != 0 {
            rem ^= 0x1F25 << (i - 12);
        }
    }
    (data << 12) | rem
}

fn mask_bit(mask: u8, row: usize, col: usize) -> bool {
    match mask {
        0 => (row + col).is_multiple_of(2),
        1 => row.is_multiple_of(2),
        2 => col.is_multiple_of(3),
        3 => (row + col).is_multiple_of(3),
        4 => (row / 2 + col / 3).is_multiple_of(2),
        5 => (row * col) % 2 + (row * col) % 3 == 0,
        6 => ((row * col) % 2 + (row * col) % 3).is_multiple_of(2),
        _ => ((row * col) % 3 + (row + col) % 2).is_multiple_of(2),
    }
}

impl Matrix {
    fn new(size: usize) -> Matrix {
        Matrix {
            size,
            modules: vec![0; size * size],
            reserved: vec![0; size * size],
        }
    }

    pub fn get(&self, row: usize, col: usize) -> u8 {
        self.modules[row * self.size + col]
    }

    fn set_function(&mut self, row: usize, col: usize, dark: bool) {
        let i = row * self.size + col;
        self.modules[i] = u8::from(dark);
        self.reserved[i] = 1;
    }

    fn finders(&mut self) {
        let size = self.size as isize;
        for (row, col) in [(0, 0), (size - 7, 0), (0, size - 7)] {
            for r in -1..=7isize {
                for c in -1..=7isize {
                    let (y, x) = (row + r, col + c);
                    if y < 0 || y >= size || x < 0 || x >= size {
                        continue;
                    }
                    let dark = ((0..=6).contains(&r) && (c == 0 || c == 6))
                        || ((0..=6).contains(&c) && (r == 0 || r == 6))
                        || ((2..=4).contains(&r) && (2..=4).contains(&c));
                    self.set_function(y as usize, x as usize, dark);
                }
            }
        }
    }

    fn timing(&mut self) {
        for i in 8..self.size - 8 {
            self.set_function(i, 6, i % 2 == 0);
            self.set_function(6, i, i % 2 == 0);
        }
    }

    fn alignments(&mut self, version: u8) {
        let mut coords = [0usize; 7];
        let n = alignment_coords(version, &mut coords);
        for i in 0..n {
            for j in 0..n {
                if (i == 0 && j == 0) || (i == 0 && j == n - 1) || (i == n - 1 && j == 0) {
                    continue;
                }
                let (row, col) = (coords[i], coords[j]);
                for r in -2..=2isize {
                    for c in -2..=2isize {
                        let dark = r.abs() == 2 || c.abs() == 2 || (r == 0 && c == 0);
                        self.set_function(
                            (row as isize + r) as usize,
                            (col as isize + c) as usize,
                            dark,
                        );
                    }
                }
            }
        }
    }

    fn format(&mut self, ecc: Ecc, mask: u8) {
        let size = self.size;
        let bits = format_bits(ecc, mask);
        for i in 0..15 {
            let dark = (bits >> i) & 1 == 1;
            match i {
                0..=5 => self.set_function(i, 8, dark),
                6..=7 => self.set_function(i + 1, 8, dark),
                _ => self.set_function(size - 15 + i, 8, dark),
            }
            match i {
                0..=7 => self.set_function(8, size - i - 1, dark),
                8 => self.set_function(8, 15 - i, dark),
                _ => self.set_function(8, 15 - i - 1, dark),
            }
        }
        // The dark module.
        self.set_function(size - 8, 8, true);
    }

    fn version_info(&mut self, version: u8) {
        let bits = version_bits(version);
        for i in 0..18 {
            let dark = (bits >> i) & 1 == 1;
            let (a, b) = (i / 3, i % 3 + self.size - 11);
            self.set_function(a, b, dark);
            self.set_function(b, a, dark);
        }
    }

    /// Places codewords in the two-column zigzag, skipping function modules.
    fn data(&mut self, data: &[u8]) {
        let size = self.size;
        let mut bit = 0usize;
        let total_bits = data.len() * 8;
        let mut col = size - 1;
        let mut upward = true;
        while col > 0 {
            if col == 6 {
                col -= 1;
            }
            for step in 0..size {
                let row = if upward { size - 1 - step } else { step };
                for c in 0..2 {
                    let x = col - c;
                    let i = row * size + x;
                    if self.reserved[i] == 1 {
                        continue;
                    }
                    let dark = bit < total_bits && (data[bit / 8] >> (7 - bit % 8)) & 1 == 1;
                    self.modules[i] = u8::from(dark);
                    bit += 1;
                }
            }
            upward = !upward;
            if col < 2 {
                break;
            }
            col -= 2;
        }
    }

    fn apply_mask(&mut self, mask: u8) {
        let size = self.size;
        for row in 0..size {
            for col in 0..size {
                let i = row * size + col;
                if self.reserved[i] == 0 && mask_bit(mask, row, col) {
                    self.modules[i] ^= 1;
                }
            }
        }
    }

    /// The four penalty rules, scored as the `qrcode` package scores them.
    pub fn penalty(&self) -> u32 {
        let size = self.size;
        let mut points = 0u32;

        // Rule 1: runs of five or more same-colour modules in a row or column.
        for a in 0..size {
            let (mut run_row, mut run_col) = (0u32, 0u32);
            let (mut last_row, mut last_col) = (2u8, 2u8);
            for b in 0..size {
                let m = self.get(a, b);
                if m == last_row {
                    run_row += 1;
                } else {
                    if run_row >= 5 {
                        points += 3 + run_row - 5;
                    }
                    last_row = m;
                    run_row = 1;
                }
                let m = self.get(b, a);
                if m == last_col {
                    run_col += 1;
                } else {
                    if run_col >= 5 {
                        points += 3 + run_col - 5;
                    }
                    last_col = m;
                    run_col = 1;
                }
            }
            if run_row >= 5 {
                points += 3 + run_row - 5;
            }
            if run_col >= 5 {
                points += 3 + run_col - 5;
            }
        }

        // Rule 2: 2x2 blocks of one colour.
        let mut blocks = 0u32;
        for row in 0..size - 1 {
            for col in 0..size - 1 {
                let sum = self.get(row, col)
                    + self.get(row, col + 1)
                    + self.get(row + 1, col)
                    + self.get(row + 1, col + 1);
                if sum == 0 || sum == 4 {
                    blocks += 1;
                }
            }
        }
        points += blocks * 3;

        // Rule 3: finder-like 1:1:3:1:1 patterns with four light modules on one side.
        let mut finders = 0u32;
        for a in 0..size {
            let (mut row_bits, mut col_bits) = (0u32, 0u32);
            for b in 0..size {
                row_bits = ((row_bits << 1) & 0x7FF) | self.get(a, b) as u32;
                col_bits = ((col_bits << 1) & 0x7FF) | self.get(b, a) as u32;
                if b >= 10 {
                    if row_bits == 0x5D0 || row_bits == 0x05D {
                        finders += 1;
                    }
                    if col_bits == 0x5D0 || col_bits == 0x05D {
                        finders += 1;
                    }
                }
            }
        }
        points += finders * 40;

        // Rule 4: deviation of the dark share from 50%, in steps of 5%.
        let total = self.modules.len();
        let dark: usize = self.modules.iter().map(|&m| m as usize).sum();
        let step = (dark * 20).div_ceil(total);
        points += step.abs_diff(10) as u32 * 10;

        points
    }
}

/// Builds the symbol. `mask` picks a mask (0 to 7); `None` scores all eight
/// and keeps the first with the lowest penalty. Returns the matrix and the mask.
pub fn build(version: u8, ecc: Ecc, mask: Option<u8>, codewords: &[u8]) -> (Matrix, u8) {
    let mut m = Matrix::new(symbol_size(version));
    m.finders();
    m.timing();
    m.alignments(version);
    // Reserve the format areas before placing data; the bits are rewritten below.
    m.format(ecc, 0);
    if version >= 7 {
        m.version_info(version);
    }
    m.data(codewords);

    let mask = match mask {
        Some(mask) => mask,
        None => {
            let mut best = 0u8;
            let mut lowest = u32::MAX;
            for candidate in 0..8u8 {
                m.format(ecc, candidate);
                m.apply_mask(candidate);
                let penalty = m.penalty();
                m.apply_mask(candidate);
                if penalty < lowest {
                    lowest = penalty;
                    best = candidate;
                }
            }
            best
        }
    };
    m.apply_mask(mask);
    m.format(ecc, mask);
    (m, mask)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::segment::Mode;

    #[test]
    fn format_bits_match_the_specification_table() {
        assert_eq!(format_bits(Ecc::M, 0), 0x5412);
        assert_eq!(format_bits(Ecc::L, 0), 0x77C4);
        assert_eq!(format_bits(Ecc::H, 7), 0x083B);
        assert_eq!(format_bits(Ecc::Q, 5), 0x2183);
        assert_eq!(format_bits(Ecc::Q, 7), 0x2BED);
    }

    #[test]
    fn version_bits_match_the_specification_table() {
        assert_eq!(version_bits(7), 0x07C94);
        assert_eq!(version_bits(21), 0x15683);
        assert_eq!(version_bits(40), 0x28C69);
    }

    #[test]
    fn specification_example_codewords() {
        // ISO/IEC 18004 Annex I: "01234567" as 1-M.
        let seg = Segment::new(Mode::Numeric, b"01234567", 0).unwrap();
        let words = codewords(None, &[seg], 1, Ecc::M);
        assert_eq!(
            words,
            [
                0x10, 0x20, 0x0C, 0x56, 0x61, 0x80, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11, 0xEC, 0x11,
                0xEC, 0x11, 0xA5, 0x24, 0xD4, 0xC1, 0xED, 0x36, 0xC7, 0x87, 0x2C, 0x55
            ]
        );
    }

    #[test]
    fn interleaves_blocks_of_two_lengths() {
        // 5-Q has two blocks of 15 and two of 16 data codewords.
        let data: Vec<u8> = (0..62u8).collect();
        let seg = Segment::new(Mode::Byte, &data, 0).unwrap();
        let words = codewords(None, &[seg], 5, Ecc::Q);
        assert_eq!(words.len(), total_codewords(5));
        // The first column holds the first codeword of each block.
        let mut bits = BitBuffer::with_capacity(62);
        seg.write(5, &mut bits);
        assert_eq!(words[0], bits.bytes[0]);
        assert_eq!(words[1], bits.bytes[15]);
        assert_eq!(words[2], bits.bytes[30]);
        assert_eq!(words[3], bits.bytes[46]);
    }

    #[test]
    fn every_module_is_placed_exactly_once() {
        for version in [1u8, 2, 6, 7, 14, 40] {
            let words: Vec<u8> = alloc::vec![0xFF; total_codewords(version)];
            let (m, _) = build(version, Ecc::L, Some(0), &words);
            let data_modules = m.reserved.iter().filter(|&&r| r == 0).count();
            assert_eq!(data_modules / 8, total_codewords(version), "v{version}");
            assert!(data_modules - total_codewords(version) * 8 < 8);
        }
    }
}
