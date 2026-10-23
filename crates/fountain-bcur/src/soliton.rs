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

use alloc::collections::BTreeSet;
use alloc::vec::Vec;

pub struct Mulberry32 {
    a: u32,
}

impl Mulberry32 {
    pub fn new(seed: u32) -> Self {
        Self { a: seed }
    }

    pub fn next_f64(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6d2b_79f5);
        let mut t = (self.a ^ (self.a >> 15)).wrapping_mul(1 | self.a);
        t = (t + (t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        let u = (t ^ (t >> 14)) as f64;
        u / 4294967296.0
    }
}

pub fn ln(x: f64) -> f64 {
    if x <= 0.0 {
        return f64::NAN;
    }
    let mut k = 0i32;
    let mut m = x;
    while m > 1.4142135623730951 {
        m /= 2.0;
        k += 1;
    }
    while m < 0.7071067811865476 {
        m *= 2.0;
        k -= 1;
    }
    let f = m - 1.0;
    let s = f / (2.0 + f);
    let s2 = s * s;
    let mut p = s;
    let mut term = s;
    let mut i = 3.0;
    while i <= 15.0 {
        term *= s2;
        p += term / i;
        i += 2.0;
    }
    let ln_m = 2.0 * p;
    ln_m + (k as f64) * 0.6931471805599453
}

pub fn sqrt(x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    let mut guess = x;
    for _ in 0..12 {
        guess = 0.5 * (guess + x / guess);
    }
    guess
}

pub fn floor(x: f64) -> f64 {
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

pub fn build_robust_soliton_cdf(k: usize, c: f64, delta: f64) -> Vec<f64> {
    if k <= 1 {
        return alloc::vec![1.0];
    }

    let mut rho = alloc::vec![0.0f64; k + 1];
    rho[1] = 1.0 / (k as f64);
    for d in 2..=k {
        rho[d] = 1.0 / ((d * (d - 1)) as f64);
    }

    let mut tau = alloc::vec![0.0f64; k + 1];
    let capital_r = c * ln((k as f64) / delta) * sqrt(k as f64);
    let pivot = floor(k as f64 / capital_r) as usize;
    let pivot = pivot.clamp(1, k);

    for d in 1..pivot {
        if d <= k {
            tau[d] = capital_r / ((d * k) as f64);
        }
    }
    if pivot <= k {
        tau[pivot] = (capital_r * ln(capital_r / delta)) / (k as f64);
    }

    let mut beta = 0.0f64;
    for d in 1..=k {
        beta += rho[d] + tau[d];
    }

    let mut cdf = alloc::vec![0.0f64; k];
    let mut cumulative = 0.0f64;
    for d in 1..=k {
        cumulative += (rho[d] + tau[d]) / beta;
        cdf[d - 1] = cumulative.min(1.0);
    }
    cdf[k - 1] = 1.0;

    cdf
}

pub fn sample_degree_from_cdf(cdf: &[f64], rand_val: f64) -> usize {
    let k = cdf.len();
    if k <= 1 {
        return 1;
    }

    let mut low = 0;
    let mut high = k - 1;
    while low < high {
        let mid = (low + high) / 2;
        if cdf[mid] < rand_val {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    low + 1
}

pub fn get_neighbors_for_seq(seq: usize, k: usize, cdf_opt: Option<&[f64]>) -> (usize, Vec<usize>) {
    if k <= 1 {
        return (1, alloc::vec![0]);
    }

    if seq <= k {
        return (1, alloc::vec![seq - 1]);
    }

    let owned_cdf;
    let cdf = match cdf_opt {
        Some(c) => c,
        None => {
            owned_cdf = build_robust_soliton_cdf(k, 0.1, 0.05);
            &owned_cdf
        }
    };

    let mut prng = Mulberry32::new(seq as u32);
    let degree = sample_degree_from_cdf(cdf, prng.next_f64());

    if degree >= k {
        let mut all = Vec::with_capacity(k);
        for i in 0..k {
            all.push(i);
        }
        return (k, all);
    }

    if degree == 1 {
        let idx = floor(prng.next_f64() * (k as f64)) as usize;
        return (1, alloc::vec![idx]);
    }

    let mut selected = BTreeSet::new();
    while selected.len() < degree {
        let candidate = floor(prng.next_f64() * (k as f64)) as usize;
        selected.insert(candidate);
    }

    let mut indices: Vec<usize> = selected.into_iter().collect();
    indices.sort_unstable();
    (degree, indices)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_soliton_systematic() {
        let (deg, indices) = get_neighbors_for_seq(1, 10, None);
        assert_eq!(deg, 1);
        assert_eq!(indices, &[0]);

        let (deg2, indices2) = get_neighbors_for_seq(10, 10, None);
        assert_eq!(deg2, 1);
        assert_eq!(indices2, &[9]);
    }
}
