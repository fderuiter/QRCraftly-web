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

//! The constellations: black and white, or 4, 8 or 16 colours whose smallest
//! mutual distance is as large as the search finds, in RGB or in OKLab.
//!
//! An id is one byte: bits 0 to 2 are log2 of the symbol count, bit 3 is set
//! for the OKLab design.

use crate::colour::{lab_distance, rgb_to_oklab};
use crate::fmath::{js_round, sqrt};

const OKLAB_FLAG: u32 = 8;

/// Most symbols a constellation has.
pub const MAX_SYMBOLS: usize = 16;

/// Bits per cell of a valid id, or `None`.
pub fn bits_of(id: u32) -> Option<u32> {
    let bits = id & 7;
    if !(1..=4).contains(&bits) || id >> 4 != 0 {
        return None;
    }
    Some(bits)
}

const CUBE_CORNERS: [[u8; 3]; 8] = [
    [0, 0, 0],
    [0, 0, 255],
    [0, 255, 0],
    [0, 255, 255],
    [255, 0, 0],
    [255, 0, 255],
    [255, 255, 0],
    [255, 255, 255],
];

/// The largest lattice: 7 levels per channel.
const MAX_POOL: usize = 343;

struct Pool {
    colours: [[u8; 3]; MAX_POOL],
    labs: [[f64; 3]; MAX_POOL],
    len: usize,
    oklab: bool,
}

impl Pool {
    fn lattice(levels: usize, oklab: bool) -> Pool {
        let mut steps = [0u8; 7];
        for (i, step) in steps.iter_mut().enumerate().take(levels) {
            *step = js_round((255 * i) as f64 / (levels - 1) as f64) as u8;
        }
        let mut pool = Pool {
            colours: [[0; 3]; MAX_POOL],
            labs: [[0.0; 3]; MAX_POOL],
            len: 0,
            oklab,
        };
        for &r in &steps[..levels] {
            for &g in &steps[..levels] {
                for &b in &steps[..levels] {
                    pool.colours[pool.len] = [r, g, b];
                    if oklab {
                        pool.labs[pool.len] = rgb_to_oklab(r as f64, g as f64, b as f64);
                    }
                    pool.len += 1;
                }
            }
        }
        pool
    }

    fn gap(&self, i: usize, j: usize) -> f64 {
        if self.oklab {
            return lab_distance(&self.labs[i], &self.labs[j]);
        }
        let (a, b) = (self.colours[i], self.colours[j]);
        let dr = a[0] as f64 - b[0] as f64;
        let dg = a[1] as f64 - b[1] as f64;
        let db = a[2] as f64 - b[2] as f64;
        sqrt(dr * dr + dg * dg + db * db)
    }
}

/// Picks `size` colours from a lattice with the largest smallest-gap:
/// farthest-point sampling, then single swaps while they widen the smallest
/// gap. Ties go to the lowest lattice index. Returns lattice indexes, sorted.
fn design(size: usize, pool: &Pool) -> [usize; MAX_SYMBOLS] {
    let mut chosen = [0usize; MAX_SYMBOLS];
    let mut count = 1;
    while count < size {
        let mut best = usize::MAX;
        let mut best_gap = -1.0;
        for i in 0..pool.len {
            if chosen[..count].contains(&i) {
                continue;
            }
            let mut nearest = f64::INFINITY;
            for &c in &chosen[..count] {
                nearest = nearest.min(pool.gap(i, c));
            }
            if nearest > best_gap {
                best_gap = nearest;
                best = i;
            }
        }
        chosen[count] = best;
        count += 1;
    }
    let set = &mut chosen[..size];
    let mut current = f64::INFINITY;
    for a in 0..size {
        for b in a + 1..size {
            current = current.min(pool.gap(set[a], set[b]));
        }
    }
    for _ in 0..40 {
        let mut improved = false;
        for slot in 0..size {
            // The smallest gap of a trial is the smaller of the gaps between the other slots,
            // which this slot's loop never changes, and the candidate's gaps to them. A minimum
            // is exact, so this is the same number as measuring every pair of the trial.
            let mut rest = f64::INFINITY;
            for a in 0..size {
                for b in a + 1..size {
                    if a != slot && b != slot {
                        rest = rest.min(pool.gap(set[a], set[b]));
                    }
                }
            }
            for candidate in 0..pool.len {
                if set.contains(&candidate) {
                    continue;
                }
                let mut score = rest;
                for (other, &member) in set.iter().enumerate() {
                    if other != slot {
                        score = score.min(pool.gap(candidate, member));
                    }
                }
                if score > current + 1e-9 {
                    set[slot] = candidate;
                    current = score;
                    improved = true;
                }
            }
        }
        if !improved {
            break;
        }
    }
    set.sort_unstable();
    chosen
}

/// The colours of constellation `id` and the smallest OKLab distance between
/// two of them, or `None` for an unknown id.
pub fn constellation(id: u32) -> Option<([[u8; 3]; MAX_SYMBOLS], usize, f64)> {
    let bits = bits_of(id)?;
    let size = 1usize << bits;
    let oklab = id & OKLAB_FLAG != 0;
    let mut symbols = [[0u8; 3]; MAX_SYMBOLS];
    if size == 2 {
        symbols[0] = CUBE_CORNERS[0];
        symbols[1] = CUBE_CORNERS[7];
    } else if !oklab && size == 8 {
        symbols[..8].copy_from_slice(&CUBE_CORNERS);
    } else if !oklab && size == 4 {
        for (slot, corner) in [0, 3, 5, 6].into_iter().enumerate() {
            symbols[slot] = CUBE_CORNERS[corner];
        }
    } else {
        let pool = Pool::lattice(if oklab { 7 } else { 5 }, oklab);
        let chosen = design(size, &pool);
        for (slot, &index) in chosen[..size].iter().enumerate() {
            symbols[slot] = pool.colours[index];
        }
    }
    let mut labs = [[0.0f64; 3]; MAX_SYMBOLS];
    for (lab, rgb) in labs.iter_mut().zip(&symbols[..size]) {
        *lab = rgb_to_oklab(rgb[0] as f64, rgb[1] as f64, rgb[2] as f64);
    }
    let mut min_distance = f64::INFINITY;
    for a in 0..size {
        for b in a + 1..size {
            min_distance = min_distance.min(lab_distance(&labs[a], &labs[b]));
        }
    }
    Some((symbols, size, min_distance))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_unknown_ids() {
        assert!(constellation(0).is_none());
        assert!(constellation(5).is_none());
        assert!(constellation(16 | 2).is_none());
        assert_eq!(bits_of(8 | 4), Some(4));
    }

    #[test]
    fn fixed_constellations_are_the_cube_corners() {
        let (symbols, size, _) = constellation(1).unwrap();
        assert_eq!(size, 2);
        assert_eq!(symbols[..2], [[0, 0, 0], [255, 255, 255]]);
        let (symbols, size, _) = constellation(3).unwrap();
        assert_eq!(size, 8);
        assert_eq!(symbols[..8], CUBE_CORNERS);
    }

    #[test]
    fn designs_spread_the_symbols() {
        for id in [2 | 8, 3 | 8, 4 | 8, 4] {
            let (symbols, size, min_distance) = constellation(id).unwrap();
            assert!(min_distance > 0.05, "id {id}");
            for a in 0..size {
                for b in a + 1..size {
                    assert_ne!(symbols[a], symbols[b]);
                }
            }
        }
    }
}
