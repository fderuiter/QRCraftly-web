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

//! The code's pseudo-random generator: SplitMix64 (Steele, Lea and Flood,
//! 2014). Integer only, so every engine draws the same numbers.

/// A SplitMix64 stream.
#[derive(Clone, Debug)]
pub struct Rng(u64);

/// Added to the state on every draw (2^64 divided by the golden ratio).
const GAMMA: u64 = 0x9E37_79B9_7F4A_7C15;

impl Rng {
    /// A stream for one purpose of one transfer. `tag` keeps the streams of
    /// different symbols and of the precode apart.
    pub fn new(seed: u64, tag: u64) -> Self {
        let mut rng = Rng(seed ^ tag.wrapping_mul(0xD6E8_FEB8_6659_FD93));
        rng.next_u64();
        rng
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(GAMMA);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// A number in `0..n` (`n` at most 2^32), by multiply and shift.
    pub fn below(&mut self, n: usize) -> usize {
        (((self.next_u64() >> 32) * n as u64) >> 32) as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_published_splitmix64_sequence() {
        // Reference outputs for state 0 from the SplitMix64 paper's C code.
        let mut rng = Rng(0);
        assert_eq!(rng.next_u64(), 0xE220_A839_7B1D_CDAF);
        assert_eq!(rng.next_u64(), 0x6E78_9E6A_A1B9_65F4);
        assert_eq!(rng.next_u64(), 0x06C4_5D18_8009_454F);
    }

    #[test]
    fn below_stays_in_range() {
        let mut rng = Rng::new(7, 1);
        for n in [1, 2, 3, 19, 8_446] {
            for _ in 0..1000 {
                assert!(rng.below(n) < n);
            }
        }
    }
}
