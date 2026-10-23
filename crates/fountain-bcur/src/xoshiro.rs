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

use crate::sha256;
use alloc::vec::Vec;

fn rotl(x: u64, k: u32) -> u64 {
    (x << k) | (x >> (64 - k))
}

fn floor(x: f64) -> f64 {
    if x < 0.0 {
        let i = x as i64;
        let fi = i as f64;
        if x < fi {
            fi - 1.0
        } else {
            fi
        }
    } else {
        (x as u64) as f64
    }
}

pub struct Xoshiro256 {
    s: [u64; 4],
}

impl Xoshiro256 {
    pub fn new(seed: &[u8]) -> Self {
        let hash = sha256::digest(seed);
        let mut s = [0u64; 4];
        for i in 0..4 {
            s[i] = u64::from_be_bytes(hash[i * 8..i * 8 + 8].try_into().unwrap());
        }
        Self { s }
    }

    pub fn next_u64(&mut self) -> u64 {
        let result = rotl(self.s[1].wrapping_mul(5), 7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = rotl(self.s[3], 45);
        result
    }

    pub fn next_double(&mut self) -> f64 {
        (self.next_u64() as f64) / 18446744073709551616.0
    }

    pub fn next_int(&mut self, low: usize, high: usize) -> usize {
        let d = self.next_double();
        let range = (high - low + 1) as f64;
        low + floor(d * range) as usize
    }
}

pub struct FragmentChooser {
    pub count: usize,
    pub probs: Vec<f64>,
    pub aliases: Vec<usize>,
}

impl FragmentChooser {
    pub fn new(count: usize) -> Self {
        let mut weights = Vec::with_capacity(count);
        let mut sum = 0.0f64;
        for i in 0..count {
            let w = 1.0 / ((i + 1) as f64);
            weights.push(w);
            sum += w;
        }
        for i in 0..count {
            weights[i] = (weights[i] * (count as f64)) / sum;
        }

        let mut small = Vec::new();
        let mut large = Vec::new();
        for i in (0..count).rev() {
            if weights[i] < 1.0 {
                small.push(i);
            } else {
                large.push(i);
            }
        }

        let mut probs = alloc::vec![0.0f64; count];
        let mut aliases = alloc::vec![0usize; count];

        while !small.is_empty() && !large.is_empty() {
            let less = small.pop().unwrap();
            let more = large.pop().unwrap();
            probs[less] = weights[less];
            aliases[less] = more;
            weights[more] = weights[more] + weights[less] - 1.0;
            if weights[more] < 1.0 {
                small.push(more);
            } else {
                large.push(more);
            }
        }

        for &i in &large {
            probs[i] = 1.0;
        }
        for &i in &small {
            probs[i] = 1.0;
        }

        Self {
            count,
            probs,
            aliases,
        }
    }

    pub fn indexes_for(&self, seq_num: usize, checksum: u32) -> Vec<usize> {
        if seq_num <= self.count {
            return alloc::vec![seq_num - 1];
        }

        let mut seed = [0u8; 8];
        seed[0..4].copy_from_slice(&(seq_num as u32).to_be_bytes());
        seed[4..8].copy_from_slice(&checksum.to_be_bytes());

        let mut rng = Xoshiro256::new(&seed);
        let slot = floor(rng.next_double() * (self.count as f64)) as usize;
        let degree = if rng.next_double() < self.probs[slot] {
            slot
        } else {
            self.aliases[slot]
        } + 1;

        let mut remaining: Vec<usize> = (0..self.count).collect();
        let mut chosen = Vec::with_capacity(degree);
        while chosen.len() < degree {
            let idx = rng.next_int(0, remaining.len() - 1);
            chosen.push(remaining.remove(idx));
        }
        chosen
    }
}
