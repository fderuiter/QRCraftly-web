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

use crate::gf2::{solve_gf2, GF2Equation};
use crate::soliton::{build_robust_soliton_cdf, get_neighbors_for_seq};
use alloc::collections::BTreeSet;
use alloc::vec::Vec;
use qrcraftly_core::crc32;

const MAX_ELIMINATION_UNKNOWNS: usize = 4096;

pub struct PendingEquation {
    pub neighbors: BTreeSet<usize>,
    pub data: Vec<u8>,
    pub independent: bool,
}

pub struct FountainDecoder {
    pub k: usize,
    pub message_length: usize,
    pub checksum: u32,
    pub block_size: usize,

    pub cdf: Vec<f64>,
    pub solved_blocks: Vec<Option<Vec<u8>>>,
    pub solved_count: usize,
    pub pending: Vec<PendingEquation>,
    pub received_seq_numbers: BTreeSet<usize>,
    pub droplets: usize,
    pub equations_since_elimination: usize,
    pub elimination_runs: usize,
}

impl FountainDecoder {
    pub fn new(k: usize, message_length: usize, checksum: u32, block_size: usize) -> Self {
        let cdf = build_robust_soliton_cdf(k, 0.1, 0.05);
        Self {
            k,
            message_length,
            checksum,
            block_size,
            cdf,
            solved_blocks: alloc::vec![None; k],
            solved_count: 0,
            pending: Vec::new(),
            received_seq_numbers: BTreeSet::new(),
            droplets: 0,
            equations_since_elimination: 0,
            elimination_runs: 0,
        }
    }

    pub fn is_complete(&self) -> bool {
        self.solved_count >= self.k
    }

    pub fn progress(&self) -> u32 {
        if self.k == 0 {
            0
        } else {
            ((self.solved_count * 100) / self.k) as u32
        }
    }

    pub fn rank(&self) -> usize {
        let independent = self.pending.iter().filter(|eq| eq.independent).count();
        (self.solved_count + independent).min(self.k)
    }

    pub fn ingest_droplet(&mut self, seq: usize, data: &[u8]) -> bool {
        if self.is_complete() || self.received_seq_numbers.contains(&seq) {
            return false;
        }
        self.received_seq_numbers.insert(seq);
        self.droplets += 1;

        let (_deg, indices) = get_neighbors_for_seq(seq, self.k, Some(&self.cdf));
        self.ingest_equation(&indices, data)
    }

    pub fn ingest_equation(&mut self, indices: &[usize], data: &[u8]) -> bool {
        if self.is_complete() {
            return false;
        }

        let mut payload = alloc::vec![0u8; self.block_size];
        let copy_len = data.len().min(self.block_size);
        payload[..copy_len].copy_from_slice(&data[..copy_len]);

        let mut remaining = BTreeSet::new();
        for &idx in indices {
            if idx >= self.k {
                return false;
            }
            if let Some(ref solved) = self.solved_blocks[idx] {
                for b in 0..self.block_size {
                    payload[b] ^= solved[b];
                }
            } else if remaining.contains(&idx) {
                remaining.remove(&idx);
            } else {
                remaining.insert(idx);
            }
        }

        if remaining.is_empty() {
            return false;
        }

        let before = self.solved_count;
        if remaining.len() == 1 {
            let first = *remaining.iter().next().unwrap();
            self.ripple(alloc::vec![(first, payload)]);
        } else {
            self.pending.push(PendingEquation {
                neighbors: remaining,
                data: payload,
                independent: false,
            });
            self.equations_since_elimination += 1;
        }

        if !self.is_complete() {
            self.maybe_eliminate();
        }

        self.solved_count > before
    }

    fn ripple(&mut self, mut queue: Vec<(usize, Vec<u8>)>) {
        while !queue.is_empty() {
            let (index, block_data) = queue.remove(0);
            if self.solved_blocks[index].is_some() {
                continue;
            }
            self.solved_blocks[index] = Some(block_data.clone());
            self.solved_count += 1;

            let mut still_pending = Vec::new();
            let mut pending_eqs = core::mem::take(&mut self.pending);

            for mut eq in pending_eqs.drain(..) {
                if !eq.neighbors.contains(&index) {
                    still_pending.push(eq);
                    continue;
                }
                for b in 0..self.block_size {
                    eq.data[b] ^= block_data[b];
                }
                eq.neighbors.remove(&index);
                if eq.neighbors.len() == 1 {
                    let first = *eq.neighbors.iter().next().unwrap();
                    queue.push((first, eq.data));
                } else if eq.neighbors.len() > 1 {
                    still_pending.push(eq);
                }
            }

            self.pending = still_pending;
        }
    }

    fn maybe_eliminate(&mut self) {
        let unknown_count = self.k - self.solved_count;
        if unknown_count > MAX_ELIMINATION_UNKNOWNS || self.pending.len() < unknown_count {
            return;
        }

        let threshold = 1.max((unknown_count + 15) / 16);
        if self.equations_since_elimination < threshold {
            return;
        }

        self.equations_since_elimination = 0;
        self.elimination_runs += 1;

        let mut unknowns = Vec::new();
        for i in 0..self.k {
            if self.solved_blocks[i].is_none() {
                unknowns.push(i);
            }
        }

        let gf2_equations: Vec<GF2Equation> = self
            .pending
            .iter()
            .map(|eq| GF2Equation {
                columns: eq.neighbors.iter().copied().collect(),
                data: eq.data.clone(),
            })
            .collect();

        let sol = solve_gf2(&gf2_equations, &unknowns, self.block_size);

        self.pending = sol
            .residual
            .into_iter()
            .map(|eq| PendingEquation {
                neighbors: eq.columns.into_iter().collect(),
                data: eq.data,
                independent: true,
            })
            .collect();

        let mut queue = Vec::new();
        for (idx, data) in sol.solved {
            queue.push((idx, data));
        }

        self.ripple(queue);
    }

    pub fn finalize(&self) -> Option<Vec<u8>> {
        if !self.is_complete() {
            return None;
        }

        let mut full = alloc::vec![0u8; self.k * self.block_size];
        for i in 0..self.k {
            let block = self.solved_blocks[i].as_ref()?;
            full[i * self.block_size..(i + 1) * self.block_size].copy_from_slice(block);
        }

        if self.message_length > full.len() {
            return None;
        }

        let result = full[..self.message_length].to_vec();
        if crc32::checksum(&result) != self.checksum {
            return None;
        }

        Some(result)
    }

    pub fn reset(&mut self) {
        self.solved_blocks = alloc::vec![None; self.k];
        self.solved_count = 0;
        self.pending.clear();
        self.received_seq_numbers.clear();
        self.droplets = 0;
        self.equations_since_elimination = 0;
        self.elimination_runs = 0;
    }
}
