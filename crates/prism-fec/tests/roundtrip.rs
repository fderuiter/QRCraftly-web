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

//! Encode and decode whole blocks through seeded erasure channels: random
//! loss, a mid-stream join, duplicates and reordering. What decodes must be the
//! source, and it must take few symbols beyond K.

use prism_fec::rng::Rng;
use prism_fec::{Added, Decoder, Encoder, MAX_SOURCE_SYMBOLS};

fn source(k: usize, t: usize, seed: u64) -> Vec<u8> {
    let mut rng = Rng::new(seed, 99);
    (0..k * t).map(|_| rng.next_u64() as u8).collect()
}

/// Feeds symbols from `esis` until the block completes; returns how many were
/// received and checks the solved block.
fn transfer(k: usize, t: usize, seed: u32, esis: impl Iterator<Item = u32>) -> usize {
    let data = source(k, t, u64::from(seed));
    let mut encoder = Encoder::new(k, t, seed, &data).unwrap();
    let mut decoder = Decoder::new(k, t, seed).unwrap();
    let mut received = 0;
    for esi in esis {
        received += 1;
        let symbol = encoder.symbol(esi).to_vec();
        if decoder.add(esi, &symbol) == Added::Complete {
            assert_eq!(decoder.solve().unwrap(), &data[..], "k {k} seed {seed}");
            return received;
        }
        assert!(decoder.solve().is_none());
        assert!(received < 3 * k + 100, "k {k} seed {seed}: no decode");
    }
    panic!("ran out of symbols");
}

#[test]
fn every_size_round_trips_from_symbol_zero() {
    for k in [1, 2, 3, 10, 63, 64, 65, 66, 100, 257, 1_000] {
        for t in [8, 64] {
            let n = transfer(k, t, k as u32, 0..);
            assert!(n >= k);
        }
    }
}

#[test]
fn round_trips_after_a_join_with_loss_duplicates_and_reordering() {
    let mut rng = Rng::new(1, 2);
    for trial in 0..60u32 {
        let k = [5, 40, 64, 70, 300, 900][trial as usize % 6];
        let start = rng.next_u64() as u32;
        let mut esis: Vec<u32> = (0..3 * k as u32 + 100)
            .map(|i| start.wrapping_add(i))
            .filter(|_| rng.below(100) >= 30)
            .collect();
        // Duplicate some and shuffle neighbours.
        for i in 0..esis.len() / 10 {
            let at = rng.below(esis.len());
            esis.insert(at, esis[i]);
        }
        for i in 1..esis.len() {
            if rng.below(4) == 0 {
                esis.swap(i - 1, i);
            }
        }
        transfer(k, 16, trial, esis.into_iter());
    }
}

#[test]
fn redundant_symbols_are_reported() {
    let data = source(200, 8, 3);
    let mut encoder = Encoder::new(200, 8, 3, &data).unwrap();
    let mut decoder = Decoder::new(200, 8, 3).unwrap();
    let symbol = encoder.symbol(5).to_vec();
    assert_eq!(decoder.add(5, &symbol), Added::Innovative);
    assert_eq!(decoder.add(5, &symbol), Added::Redundant);
}

#[test]
fn rejects_sizes_out_of_range() {
    assert!(Decoder::new(0, 64, 1).is_none());
    assert!(Decoder::new(MAX_SOURCE_SYMBOLS + 1, 64, 1).is_none());
    assert!(Decoder::new(10, 0, 1).is_none());
    assert!(Decoder::new(10, 12, 1).is_none());
    assert!(Decoder::new(10, 1_032, 1).is_none());
    assert!(Encoder::new(10, 8, 1, &[0; 79]).is_none());
    assert!(Encoder::new(10, 8, 1, &[0; 80]).is_some());
}

#[test]
fn different_seeds_give_different_streams() {
    let data = source(100, 8, 1);
    let mut a = Encoder::new(100, 8, 1, &data).unwrap();
    let mut b = Encoder::new(100, 8, 2, &data).unwrap();
    let differ = (0..32)
        .filter(|&e| a.symbol(e).to_vec() != b.symbol(e))
        .count();
    assert!(differ > 28);
}

/// Overhead quantiles over seeded trials, half from symbol 0 and half after a
/// random join, a third with 30% loss.
fn overheads(k: usize, trials: u32) -> Vec<usize> {
    let mut rng = Rng::new(k as u64, 7);
    let mut out: Vec<usize> = (0..trials)
        .map(|trial| {
            let start = if trial % 2 == 0 {
                0
            } else {
                rng.next_u64() as u32
            };
            let lossy = trial % 3 == 0;
            let mut channel = Rng::new(u64::from(trial), 11);
            let esis = (0..)
                .map(move |i: u32| start.wrapping_add(i))
                .filter(move |_| !lossy || channel.below(100) >= 30);
            transfer(k, 8, 1_000 + trial, esis) - k
        })
        .collect();
    out.sort_unstable();
    out
}

#[test]
fn overhead_is_near_k() {
    for (k, trials) in [(10, 600), (100, 400), (1_000, 100)] {
        let o = overheads(k, trials);
        let median = o[o.len() / 2];
        let p90 = o[o.len() * 9 / 10];
        // A random binary matrix needs 1 extra in the median and 4 at the 90th
        // percentile; \`pnpm run bench:outer-code\` reports the p99.
        assert!(
            median <= 2 && p90 <= 5,
            "k {k}: median {median}, p90 {p90}, max {}",
            o[o.len() - 1]
        );
    }
}
