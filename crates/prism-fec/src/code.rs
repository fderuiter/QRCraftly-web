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

//! The code's structure, shared by the encoder and the decoder.
//!
//! A source block of K symbols becomes L = K + S intermediate symbols: the K
//! source symbols, then S parity symbols from a sparse LDPC precode in which
//! every source symbol joins [`CHECKS_PER_SOURCE`] of the S checks. Each
//! encoding symbol is the XOR of a few intermediate symbols, picked by a
//! seeded generator from the symbol's ESI (encoding symbol identifier). No
//! encoding symbol equals a source symbol: the code is not systematic.
//!
//! Small blocks (K up to [`DENSE_LIMIT`]) skip the precode, and each encoding
//! symbol is the XOR of a uniformly random non-empty subset of the source.

use crate::rng::Rng;

/// Most source symbols in one block. Matches `MAX_FEC_SOURCE_SYMBOLS` in
/// `src/packages/optical-transfer/lib/limits.ts`.
pub const MAX_SOURCE_SYMBOLS: usize = 8_192;

/// Largest symbol in bytes. Matches `MAX_FEC_SYMBOL_BYTES` in `limits.ts`.
pub const MAX_SYMBOL_BYTES: usize = 1_024;

/// Blocks of up to this many source symbols use dense random rows and no precode.
pub const DENSE_LIMIT: usize = 64;

/// Number of precode checks each source symbol belongs to.
pub const CHECKS_PER_SOURCE: usize = 3;

/// Highest degree of an encoding symbol.
pub const MAX_DEGREE: usize = 64;

/// The degree distribution, as `(degree, cumulative weight out of 65,536)`:
/// 38% degree 3, 19% degree 4, 14% degree 6, 12% degree 12, 7% degree 24,
/// 5% degree 48 and 5% degree 64. There are no degree 1 or 2 symbols: the
/// decoder is Gaussian elimination, which gains nothing from them, and they
/// are the ones most often wasted. The few wide symbols cover what the narrow
/// ones miss.
const DEGREES: [(usize, u32); 7] = [
    (3, 24_904),
    (4, 37_356),
    (6, 46_531),
    (12, 54_395),
    (24, 58_982),
    (48, 62_259),
    (64, 65_536),
];

/// Separates the precode's random stream from every symbol's.
const PRECODE_TAG: u64 = 0x5052_4543_4F44_4521;

/// One block's code: its sizes and seed.
#[derive(Clone, Debug)]
pub struct Code {
    /// Source symbols, K.
    pub k: usize,
    /// Precode parity symbols, S.
    pub s: usize,
    /// Intermediate symbols, L = K + S.
    pub l: usize,
    seed: u64,
}

/// Number of precode checks for `k` source symbols.
pub fn precode_size(k: usize) -> usize {
    if k <= DENSE_LIMIT {
        0
    } else {
        (3 * k).div_ceil(100) + 8
    }
}

impl Code {
    /// The code for `k` source symbols and a transfer's `seed`, or `None` when
    /// `k` is 0 or over [`MAX_SOURCE_SYMBOLS`].
    pub fn new(k: usize, seed: u32) -> Option<Self> {
        if k == 0 || k > MAX_SOURCE_SYMBOLS {
            return None;
        }
        let s = precode_size(k);
        Some(Code {
            k,
            s,
            l: k + s,
            seed: u64::from(seed) | (k as u64) << 32,
        })
    }

    /// Whether this block uses dense random rows instead of the precode.
    pub fn is_dense(&self) -> bool {
        self.s == 0
    }

    /// Calls `each(source, check)` for every precode membership: source symbol
    /// `source` (below K) belongs to check `check` (below S).
    pub fn for_each_check(&self, mut each: impl FnMut(usize, usize)) {
        if self.s == 0 {
            return;
        }
        let mut rng = Rng::new(self.seed, PRECODE_TAG);
        for source in 0..self.k {
            let mut picked = [usize::MAX; CHECKS_PER_SOURCE];
            let mut n = 0;
            while n < CHECKS_PER_SOURCE {
                let check = rng.below(self.s);
                if !picked[..n].contains(&check) {
                    picked[n] = check;
                    n += 1;
                    each(source, check);
                }
            }
        }
    }

    /// Calls `each(column)` for every intermediate symbol that encoding symbol
    /// `esi` is the XOR of. Columns are distinct and there is at least one.
    pub fn for_each_column(&self, esi: u32, mut each: impl FnMut(usize)) {
        let mut rng = Rng::new(self.seed, u64::from(esi) + 1);
        if self.is_dense() {
            loop {
                let mut any = false;
                let mut bits = 0;
                for column in 0..self.l {
                    if column % 64 == 0 {
                        bits = rng.next_u64();
                    }
                    if bits & 1 == 1 {
                        each(column);
                        any = true;
                    }
                    bits >>= 1;
                }
                if any {
                    return;
                }
            }
        }
        let draw = (rng.next_u64() >> 48) as u32;
        let degree = DEGREES
            .iter()
            .find(|&&(_, cumulative)| draw < cumulative)
            .map_or(MAX_DEGREE, |&(degree, _)| degree)
            .min(self.l / 2);
        let mut picked = [0usize; MAX_DEGREE];
        let mut n = 0;
        while n < degree {
            let column = rng.below(self.l);
            if !picked[..n].contains(&column) {
                picked[n] = column;
                n += 1;
                each(column);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_follow_the_precode_rule() {
        assert_eq!(precode_size(1), 0);
        assert_eq!(precode_size(DENSE_LIMIT), 0);
        assert_eq!(precode_size(65), 10);
        assert_eq!(precode_size(1_000), 38);
        assert_eq!(precode_size(MAX_SOURCE_SYMBOLS), 254);
        assert!(Code::new(0, 1).is_none());
        assert!(Code::new(MAX_SOURCE_SYMBOLS + 1, 1).is_none());
    }

    #[test]
    fn degree_table_is_increasing_and_complete() {
        assert!(DEGREES
            .windows(2)
            .all(|w| w[0].0 < w[1].0 && w[0].1 < w[1].1));
        assert_eq!(DEGREES[DEGREES.len() - 1], (MAX_DEGREE, 65_536));
    }

    #[test]
    fn every_source_symbol_joins_three_distinct_checks() {
        let code = Code::new(1_000, 9).unwrap();
        let mut per_source = vec![Vec::new(); code.k];
        code.for_each_check(|source, check| {
            assert!(check < code.s);
            per_source[source].push(check);
        });
        for checks in per_source {
            assert_eq!(checks.len(), CHECKS_PER_SOURCE);
            assert!(checks[0] != checks[1] && checks[1] != checks[2] && checks[0] != checks[2]);
        }
    }

    #[test]
    fn columns_are_distinct_in_range_and_repeatable() {
        for k in [1, 10, 64, 65, 1_000, MAX_SOURCE_SYMBOLS] {
            let code = Code::new(k, 3).unwrap();
            for esi in [0, 1, 2, 77, u32::MAX] {
                let mut columns = Vec::new();
                code.for_each_column(esi, |c| columns.push(c));
                let mut again = Vec::new();
                code.for_each_column(esi, |c| again.push(c));
                assert_eq!(columns, again);
                assert!(!columns.is_empty());
                assert!(columns.iter().all(|&c| c < code.l));
                let mut sorted = columns.clone();
                sorted.sort_unstable();
                sorted.dedup();
                assert_eq!(sorted.len(), columns.len());
            }
        }
    }

    #[test]
    fn degrees_follow_the_table() {
        let code = Code::new(4_096, 5).unwrap();
        let mut counts = [0usize; MAX_DEGREE + 1];
        for esi in 0..65_536 {
            let mut d = 0;
            code.for_each_column(esi, |_| d += 1);
            counts[d] += 1;
        }
        // Each share within 1.5 points of its target.
        for (i, &(degree, cumulative)) in DEGREES.iter().enumerate() {
            let before = if i == 0 { 0 } else { DEGREES[i - 1].1 };
            let want = (cumulative - before) as f64 / 65_536.0;
            let got = counts[degree] as f64 / 65_536.0;
            assert!(
                (want - got).abs() < 0.015,
                "degree {degree}: {got} vs {want}"
            );
        }
    }
}
