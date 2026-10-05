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

//! From a sampled grid of modules to corrected data codewords: format and
//! version information, unmasking, the zigzag codeword order, block
//! de-interleaving and Reed-Solomon correction.

use alloc::vec;
use alloc::vec::Vec;
use qrcraftly_core::qr::{
    alignment_coords, data_codewords, ec_blocks, ec_codewords, format_bits, mask_bit, symbol_size,
    total_codewords, version_bits, Ecc, MAX_VERSION,
};
use qrcraftly_core::reed_solomon;

/// Modules sampled from a frame: 1 dark, 0 light, row by row. `weak` marks
/// modules whose brightness was close to the threshold.
pub struct Grid {
    pub size: usize,
    pub bits: Vec<u8>,
    pub weak: Vec<u8>,
}

impl Grid {
    #[inline]
    pub fn get(&self, row: usize, col: usize) -> bool {
        self.bits[row * self.size + col] != 0
    }

    /// The grid reflected across its main diagonal, as a mirrored code reads.
    pub fn transposed(&self) -> Grid {
        let n = self.size;
        let mut bits = vec![0u8; n * n];
        let mut weak = vec![0u8; n * n];
        for r in 0..n {
            for c in 0..n {
                bits[c * n + r] = self.bits[r * n + c];
                weak[c * n + r] = self.weak[r * n + c];
            }
        }
        Grid {
            size: n,
            bits,
            weak,
        }
    }
}

/// The most bits a format or version word may be off by and still be read.
const MAX_BIT_ERRORS: u32 = 3;

/// Level and mask from the two copies of the format information.
pub fn read_format(grid: &Grid) -> Option<(Ecc, u8)> {
    let n = grid.size;
    let mut near = 0u32;
    let mut far = 0u32;
    for i in 0..15 {
        let (r, c) = match i {
            0..=5 => (i, 8),
            6 => (7, 8),
            7 => (8, 8),
            8 => (8, 7),
            _ => (8, 14 - i),
        };
        near |= u32::from(grid.get(r, c)) << i;
        let (r, c) = if i < 8 {
            (8, n - 1 - i)
        } else {
            (n - 15 + i, 8)
        };
        far |= u32::from(grid.get(r, c)) << i;
    }
    let mut best = None;
    let mut best_distance = MAX_BIT_ERRORS + 1;
    for ecc in Ecc::ALL {
        for mask in 0..8 {
            let word = format_bits(ecc, mask);
            let d = (word ^ near).count_ones().min((word ^ far).count_ones());
            if d < best_distance {
                best_distance = d;
                best = Some((ecc, mask));
            }
        }
    }
    best
}

/// The version from the two version information blocks (versions 7 and up).
pub fn read_version(grid: &Grid) -> Option<u8> {
    let n = grid.size;
    let mut right = 0u32;
    let mut bottom = 0u32;
    for i in 0..18 {
        let (a, b) = (i / 3, i % 3 + n - 11);
        right |= u32::from(grid.get(a, b)) << i;
        bottom |= u32::from(grid.get(b, a)) << i;
    }
    let mut best = None;
    let mut best_distance = MAX_BIT_ERRORS + 1;
    for version in 7..=MAX_VERSION {
        let word = version_bits(version);
        let d = (word ^ right)
            .count_ones()
            .min((word ^ bottom).count_ones());
        if d < best_distance {
            best_distance = d;
            best = Some(version);
        }
    }
    best
}

/// Marks finder, separator, timing, alignment, format and version modules.
fn function_modules(version: u8) -> Vec<u8> {
    let n = symbol_size(version);
    let mut map = vec![0u8; n * n];
    let mut fill = |r0: usize, c0: usize, rows: usize, cols: usize| {
        for r in r0..r0 + rows {
            for c in c0..c0 + cols {
                map[r * n + c] = 1;
            }
        }
    };
    // Finders with separators and format information.
    fill(0, 0, 9, 9);
    fill(0, n - 8, 9, 8);
    fill(n - 8, 0, 8, 9);
    // Timing patterns.
    fill(6, 0, 1, n);
    fill(0, 6, n, 1);
    let mut coords = [0usize; 7];
    let count = alignment_coords(version, &mut coords);
    for i in 0..count {
        for j in 0..count {
            if (i == 0 && j == 0) || (i == 0 && j == count - 1) || (i == count - 1 && j == 0) {
                continue;
            }
            fill(coords[i] - 2, coords[j] - 2, 5, 5);
        }
    }
    if version >= 7 {
        fill(0, n - 11, 6, 3);
        fill(n - 11, 0, 3, 6);
    }
    map
}

/// Codewords in placement order, and for each whether any of its modules was weak.
fn read_codewords(grid: &Grid, version: u8, mask: u8) -> (Vec<u8>, Vec<bool>) {
    let n = grid.size;
    let function = function_modules(version);
    let total = total_codewords(version);
    let mut words = vec![0u8; total];
    let mut weak = vec![false; total];
    // Every mask repeats every 12 rows and 12 columns, so one tile of it serves the grid.
    let mut pattern = [false; 144];
    for (k, p) in pattern.iter_mut().enumerate() {
        *p = mask_bit(mask, k / 12, k % 12);
    }
    let mut bit = 0usize;
    let mut col = n - 1;
    let mut upward = true;
    'outer: loop {
        if col == 6 {
            col -= 1;
        }
        for step in 0..n {
            let row = if upward { n - 1 - step } else { step };
            for dc in 0..2 {
                let c = col - dc;
                let i = row * n + c;
                if function[i] == 1 {
                    continue;
                }
                if bit / 8 >= total {
                    break 'outer;
                }
                let dark = (grid.bits[i] != 0) ^ pattern[(row % 12) * 12 + c % 12];
                if dark {
                    words[bit / 8] |= 0x80 >> (bit % 8);
                }
                weak[bit / 8] |= grid.weak[i] != 0;
                bit += 1;
            }
        }
        upward = !upward;
        if col < 2 {
            break;
        }
        col -= 2;
    }
    (words, weak)
}

/// A symbol's corrected data codewords.
pub struct Codewords {
    pub version: u8,
    pub ecc: Ecc,
    pub mask: u8,
    pub data: Vec<u8>,
    /// Codewords Reed-Solomon changed, over every block.
    pub corrected: usize,
}

/// Why a grid did not decode.
#[derive(Debug, PartialEq)]
pub enum Failure {
    /// Neither format copy is within three bits of a valid word.
    Format,
    /// The version information names another size: sample again at `size`.
    Size(usize),
    /// A block has more errors than its check symbols can correct.
    Correction,
}

/// Check codewords that versions 1 to 3 hold back from correction, so that a
/// badly damaged symbol is rejected rather than misread (ISO/IEC 18004 table 9).
fn misdecode_reserve(version: u8, ecc: Ecc) -> usize {
    match (version, ecc) {
        (1, Ecc::L) => 3,
        (1, Ecc::M) | (2, Ecc::L) => 2,
        (1, _) | (3, Ecc::L) => 1,
        _ => 0,
    }
}

/// Reads and corrects a grid sampled at a version's size.
pub fn decode_grid(grid: &Grid) -> Result<Codewords, Failure> {
    let n = grid.size;
    if !(21..=177).contains(&n) || !(n - 17).is_multiple_of(4) {
        return Err(Failure::Format);
    }
    let (ecc, mask) = read_format(grid).ok_or(Failure::Format)?;
    let version = ((n - 17) / 4) as u8;
    if version >= 7 {
        if let Some(read) = read_version(grid) {
            if read != version {
                return Err(Failure::Size(symbol_size(read)));
            }
        }
    }
    let (words, weak) = read_codewords(grid, version, mask);

    let total = total_codewords(version);
    let blocks = ec_blocks(version, ecc);
    let check = ec_codewords(version, ecc) / blocks;
    let data_len = data_codewords(version, ecc);
    let short_data = data_len / blocks;
    let short_blocks = blocks - total % blocks;

    let mut data = Vec::with_capacity(data_len);
    let mut corrected = 0;
    let mut block = [0u8; 256];
    let mut block_weak = [false; 256];
    for b in 0..blocks {
        let len = short_data + usize::from(b >= short_blocks);
        // Data codewords interleave first, then check codewords; long blocks
        // carry their extra data codeword after every short block's last one.
        for i in 0..len {
            let at = if i < short_data {
                i * blocks + b
            } else {
                short_data * blocks + (b - short_blocks)
            };
            block[i] = words[at];
            block_weak[i] = weak[at];
        }
        for i in 0..check {
            let at = data_len + i * blocks + b;
            block[len + i] = words[at];
            block_weak[len + i] = weak[at];
        }
        let n_block = len + check;
        let received = block;
        let mut erased = [false; 256];
        if reed_solomon::decode(&mut block[..n_block], check, &[]).is_none() {
            // Try again with the weak codewords as erasures, when there are few enough.
            let mut erasures = [0usize; 256];
            let mut count = 0;
            for (i, &w) in block_weak[..n_block].iter().enumerate() {
                if w {
                    erasures[count] = i;
                    erased[i] = true;
                    count += 1;
                }
            }
            if count == 0 || count > check {
                return Err(Failure::Correction);
            }
            reed_solomon::decode(&mut block[..n_block], check, &erasures[..count])
                .ok_or(Failure::Correction)?;
        }
        // Errors cost two check codewords and erasures one. Small symbols keep
        // some in reserve against misdecoding (ISO/IEC 18004 table 9), and an
        // erasure pass keeps at least one so its result is still checked.
        let erasures = erased[..n_block].iter().filter(|&&e| e).count();
        let errors = (0..n_block)
            .filter(|&i| !erased[i] && block[i] != received[i])
            .count();
        let reserve = misdecode_reserve(version, ecc).max(usize::from(erasures > 0));
        if erasures + 2 * errors + reserve > check {
            return Err(Failure::Correction);
        }
        let fixed = (0..n_block).filter(|&i| block[i] != received[i]).count();
        corrected += fixed;
        data.extend_from_slice(&block[..len]);
    }
    Ok(Codewords {
        version,
        ecc,
        mask,
        data,
        corrected,
    })
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use qr_encode::{encode, parse_request};

    /// The encoder's matrix for `text` at a fixed level, version and mask.
    pub fn matrix(text: &[u8], ecc: u8, version: u8, mask: u8) -> Grid {
        let mut request = vec![ecc, version, mask, 0];
        request.extend_from_slice(text);
        let symbol = encode(&parse_request(&request).unwrap()).unwrap();
        let size = symbol.matrix.size;
        Grid {
            size,
            bits: symbol.matrix.modules.clone(),
            weak: vec![0; size * size],
        }
    }

    #[test]
    fn reads_format_and_version_of_every_combination() {
        for version in [1u8, 2, 6, 7, 10, 22, 40] {
            for ecc in 0..4u8 {
                for mask in 0..8u8 {
                    let grid = matrix(b"QRCRAFTLY", ecc, version, mask);
                    let (e, m) = read_format(&grid).unwrap();
                    assert_eq!((e as u8, m), (ecc, mask));
                    if version >= 7 {
                        assert_eq!(read_version(&grid), Some(version));
                    }
                }
            }
        }
    }

    #[test]
    fn corrects_flipped_modules() {
        let mut grid = matrix(b"https://qrcraftly.com/text-qr-code", 3, 4, 2);
        let clean = decode_grid(&grid).unwrap();
        assert_eq!(clean.corrected, 0);
        // Ruin six codewords' worth of modules in the data area.
        for i in 0..6 {
            let r = 20 + i % 3;
            let c = 12 + i;
            grid.bits[r * grid.size + c] ^= 1;
        }
        let fixed = decode_grid(&grid).unwrap();
        assert_eq!(fixed.data, clean.data);
        assert!(fixed.corrected > 0);
    }

    #[test]
    fn mirrored_grid_needs_the_transpose() {
        let grid = matrix(b"MIRROR", 1, 3, 5);
        let mirrored = grid.transposed();
        let plain = decode_grid(&grid).unwrap();
        // The transpose swaps the format copies' bit order, so it reads as another word or none.
        if let Ok(other) = decode_grid(&mirrored) {
            assert_ne!(other.data, plain.data);
        }
        assert_eq!(
            decode_grid(&mirrored.transposed()).unwrap().data,
            plain.data
        );
    }

    #[test]
    fn wrong_size_is_reported() {
        let grid = matrix(b"x", 0, 9, 0);
        let mut small = Grid {
            size: 49,
            bits: vec![0; 49 * 49],
            weak: vec![0; 49 * 49],
        };
        // Copy the version 9 grid's corners into a version 8 sized grid, so the version blocks read 9.
        for r in 0..49 {
            for c in 0..49 {
                let (sr, sc) = (
                    if r < 25 { r } else { r + 4 },
                    if c < 25 { c } else { c + 4 },
                );
                small.bits[r * 49 + c] = grid.bits[sr * grid.size + sc];
            }
        }
        assert_eq!(decode_grid(&small).err(), Some(Failure::Size(53)));
    }
}
