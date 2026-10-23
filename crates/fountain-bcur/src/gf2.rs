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

use alloc::collections::BTreeMap;
use alloc::vec::Vec;

pub struct GF2Equation {
    pub columns: Vec<usize>,
    pub data: Vec<u8>,
}

pub struct GF2Solution {
    pub solved: BTreeMap<usize, Vec<u8>>,
    pub residual: Vec<GF2Equation>,
    pub rank: usize,
}

pub fn solve_gf2(equations: &[GF2Equation], unknowns: &[usize], block_size: usize) -> GF2Solution {
    let width = unknowns.len();
    if width == 0 || equations.is_empty() {
        return GF2Solution {
            solved: BTreeMap::new(),
            residual: Vec::new(),
            rank: 0,
        };
    }

    let words = width.div_ceil(32);
    let mut position = BTreeMap::new();
    for (i, &col) in unknowns.iter().enumerate() {
        position.insert(col, i);
    }

    let mut rows: Vec<Vec<u32>> = Vec::with_capacity(equations.len());
    let mut payloads: Vec<Vec<u8>> = Vec::with_capacity(equations.len());

    for eq in equations {
        let mut bits = alloc::vec![0u32; words];
        let mut non_zero = false;
        for &col in &eq.columns {
            if let Some(&p) = position.get(&col) {
                bits[p / 32] ^= 1u32 << (p % 32);
                non_zero = true;
            }
        }
        if !non_zero {
            continue;
        }
        rows.push(bits);
        let mut payload = alloc::vec![0u8; block_size];
        let len = eq.data.len().min(block_size);
        payload[..len].copy_from_slice(&eq.data[..len]);
        payloads.push(payload);
    }

    let mut pivot_columns = Vec::new();
    let mut rank = 0;
    let num_rows = rows.len();

    for c in 0..width {
        if rank >= num_rows {
            break;
        }
        let word = c / 32;
        let mask = 1u32 << (c % 32);
        let mut pivot = None;

        for (r, row) in rows.iter().enumerate().take(num_rows).skip(rank) {
            if (row[word] & mask) != 0 {
                pivot = Some(r);
                break;
            }
        }

        let pivot_idx = match pivot {
            Some(p) => p,
            None => continue,
        };

        if pivot_idx != rank {
            rows.swap(pivot_idx, rank);
            payloads.swap(pivot_idx, rank);
        }

        let pivot_row = rows[rank].clone();
        let pivot_data = payloads[rank].clone();

        for r in 0..num_rows {
            if r == rank || (rows[r][word] & mask) == 0 {
                continue;
            }
            for w in word..words {
                rows[r][w] ^= pivot_row[w];
            }
            for b in 0..block_size {
                payloads[r][b] ^= pivot_data[b];
            }
        }

        pivot_columns.push(c);
        rank += 1;
    }

    let mut solved = BTreeMap::new();
    let mut residual = Vec::new();

    for r in 0..rank {
        let mut columns = Vec::new();
        let row = &rows[r];
        for (w, &word_val) in row.iter().enumerate() {
            let mut bits = word_val;
            while bits != 0 {
                let low = bits & bits.wrapping_neg();
                let bit_idx = 31 - low.leading_zeros() as usize;
                let u_idx = w * 32 + bit_idx;
                if u_idx < unknowns.len() {
                    columns.push(unknowns[u_idx]);
                }
                bits ^= low;
            }
        }

        if columns.len() == 1 {
            solved.insert(unknowns[pivot_columns[r]], payloads[r].clone());
        } else if !columns.is_empty() {
            residual.push(GF2Equation {
                columns,
                data: payloads[r].clone(),
            });
        }
    }

    GF2Solution {
        solved,
        residual,
        rank,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_solve_gf2_simple() {
        let eq1 = GF2Equation {
            columns: alloc::vec![0, 1],
            data: alloc::vec![0x03],
        };
        let eq2 = GF2Equation {
            columns: alloc::vec![1],
            data: alloc::vec![0x01],
        };

        let unknowns = alloc::vec![0, 1];
        let sol = solve_gf2(&[eq1, eq2], &unknowns, 1);

        assert_eq!(sol.rank, 2);
        assert_eq!(sol.solved.get(&1).unwrap(), &[0x01]);
        assert_eq!(sol.solved.get(&0).unwrap(), &[0x02]);
    }
}
