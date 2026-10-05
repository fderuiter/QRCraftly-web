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

//! Fixed tables and bit patterns from ISO/IEC 18004 that the QR encoder (#1177)
//! and decoder (#1178) share: symbol sizes, codeword counts, error correction
//! blocks, alignment pattern positions, format and version information, and the
//! data masks.

/// Error correction level. The discriminant is the index used across the ABI.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Ecc {
    L = 0,
    M = 1,
    Q = 2,
    H = 3,
}

impl Ecc {
    pub const ALL: [Ecc; 4] = [Ecc::L, Ecc::M, Ecc::Q, Ecc::H];

    pub fn from_index(index: u8) -> Option<Ecc> {
        Ecc::ALL.get(index as usize).copied()
    }

    /// The two bits the format information carries for this level.
    pub fn format_bits(self) -> u32 {
        match self {
            Ecc::L => 1,
            Ecc::M => 0,
            Ecc::Q => 3,
            Ecc::H => 2,
        }
    }
}

pub const MIN_VERSION: u8 = 1;
pub const MAX_VERSION: u8 = 40;
/// Modules along one side of a version 40 symbol.
pub const MAX_SIZE: usize = 177;

/// Total codewords (data plus error correction) per version, index 0 unused.
const TOTAL_CODEWORDS: [u16; 41] = [
    0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346, 404, 466, 532, 581, 655, 733, 815, 901, 991,
    1085, 1156, 1258, 1364, 1474, 1588, 1706, 1828, 1921, 2051, 2185, 2323, 2465, 2611, 2761, 2876,
    3034, 3196, 3362, 3532, 3706,
];

/// Error correction blocks per version, in the order L, M, Q, H.
const EC_BLOCKS: [[u8; 4]; 40] = [
    [1, 1, 1, 1],
    [1, 1, 1, 1],
    [1, 1, 2, 2],
    [1, 2, 2, 4],
    [1, 2, 4, 4],
    [2, 4, 4, 4],
    [2, 4, 6, 5],
    [2, 4, 6, 6],
    [2, 5, 8, 8],
    [4, 5, 8, 8],
    [4, 5, 8, 11],
    [4, 8, 10, 11],
    [4, 9, 12, 16],
    [4, 9, 16, 16],
    [6, 10, 12, 18],
    [6, 10, 17, 16],
    [6, 11, 16, 19],
    [6, 13, 18, 21],
    [7, 14, 21, 25],
    [8, 16, 20, 25],
    [8, 17, 23, 25],
    [9, 17, 23, 34],
    [9, 18, 25, 30],
    [10, 20, 27, 32],
    [12, 21, 29, 35],
    [12, 23, 34, 37],
    [12, 25, 34, 40],
    [13, 26, 35, 42],
    [14, 28, 38, 45],
    [15, 29, 40, 48],
    [16, 31, 43, 51],
    [17, 33, 45, 54],
    [18, 35, 48, 57],
    [19, 37, 51, 60],
    [19, 38, 53, 63],
    [20, 40, 56, 66],
    [21, 43, 59, 70],
    [22, 45, 62, 74],
    [24, 47, 65, 77],
    [25, 49, 68, 81],
];

/// Error correction codewords in the whole symbol per version, in the order L, M, Q, H.
const EC_CODEWORDS: [[u16; 4]; 40] = [
    [7, 10, 13, 17],
    [10, 16, 22, 28],
    [15, 26, 36, 44],
    [20, 36, 52, 64],
    [26, 48, 72, 88],
    [36, 64, 96, 112],
    [40, 72, 108, 130],
    [48, 88, 132, 156],
    [60, 110, 160, 192],
    [72, 130, 192, 224],
    [80, 150, 224, 264],
    [96, 176, 260, 308],
    [104, 198, 288, 352],
    [120, 216, 320, 384],
    [132, 240, 360, 432],
    [144, 280, 408, 480],
    [168, 308, 448, 532],
    [180, 338, 504, 588],
    [196, 364, 546, 650],
    [224, 416, 600, 700],
    [224, 442, 644, 750],
    [252, 476, 690, 816],
    [270, 504, 750, 900],
    [300, 560, 810, 960],
    [312, 588, 870, 1050],
    [336, 644, 952, 1110],
    [360, 700, 1020, 1200],
    [390, 728, 1050, 1260],
    [420, 784, 1140, 1350],
    [450, 812, 1200, 1440],
    [480, 868, 1290, 1530],
    [510, 924, 1350, 1620],
    [540, 980, 1440, 1710],
    [570, 1036, 1530, 1800],
    [570, 1064, 1590, 1890],
    [600, 1120, 1680, 1980],
    [630, 1204, 1770, 2100],
    [660, 1260, 1860, 2220],
    [720, 1316, 1950, 2310],
    [750, 1372, 2040, 2430],
];

/// Modules along one side.
pub fn symbol_size(version: u8) -> usize {
    version as usize * 4 + 17
}

pub fn total_codewords(version: u8) -> usize {
    TOTAL_CODEWORDS[version as usize] as usize
}

pub fn ec_blocks(version: u8, ecc: Ecc) -> usize {
    EC_BLOCKS[version as usize - 1][ecc as usize] as usize
}

pub fn ec_codewords(version: u8, ecc: Ecc) -> usize {
    EC_CODEWORDS[version as usize - 1][ecc as usize] as usize
}

pub fn data_codewords(version: u8, ecc: Ecc) -> usize {
    total_codewords(version) - ec_codewords(version, ecc)
}

/// Bits available for segments in a symbol.
pub fn data_bits(version: u8, ecc: Ecc) -> usize {
    data_codewords(version, ecc) * 8
}

/// Row and column centres of the alignment patterns, in increasing order.
/// Returns the number of positions written to `out` (0 for version 1).
pub fn alignment_coords(version: u8, out: &mut [usize; 7]) -> usize {
    if version == 1 {
        return 0;
    }
    let count = version as usize / 7 + 2;
    let size = symbol_size(version);
    let step = if size == 145 {
        26
    } else {
        (size - 13).div_ceil(2 * count - 2) * 2
    };
    out[count - 1] = size - 7;
    for i in (1..count - 1).rev() {
        out[i] = out[i + 1] - step;
    }
    out[0] = 6;
    count
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

/// Whether mask pattern `mask` flips the module at `row`, `col`.
pub fn mask_bit(mask: u8, row: usize, col: usize) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Data modules per version, from the closed form in the specification's capacity tables.
    fn raw_data_modules(version: u8) -> usize {
        let v = version as usize;
        let mut result = (16 * v + 128) * v + 64;
        if v >= 2 {
            let align = v / 7 + 2;
            result -= (25 * align - 10) * align - 55;
            if v >= 7 {
                result -= 36;
            }
        }
        result
    }

    #[test]
    fn codeword_counts_match_the_symbol_area() {
        for version in MIN_VERSION..=MAX_VERSION {
            assert_eq!(
                raw_data_modules(version) / 8,
                total_codewords(version),
                "version {version}"
            );
            for ecc in Ecc::ALL {
                assert_eq!(
                    ec_codewords(version, ecc) % ec_blocks(version, ecc),
                    0,
                    "{version} {ecc:?}"
                );
            }
        }
    }

    #[test]
    fn alignment_positions_match_the_specification() {
        let mut out = [0usize; 7];
        assert_eq!(alignment_coords(1, &mut out), 0);
        assert_eq!(alignment_coords(2, &mut out), 2);
        assert_eq!(&out[..2], &[6, 18]);
        assert_eq!(alignment_coords(7, &mut out), 3);
        assert_eq!(&out[..3], &[6, 22, 38]);
        assert_eq!(alignment_coords(32, &mut out), 6);
        assert_eq!(&out[..6], &[6, 34, 60, 86, 112, 138]);
        assert_eq!(alignment_coords(40, &mut out), 7);
        assert_eq!(&out[..7], &[6, 30, 58, 86, 114, 142, 170]);
    }

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
}
