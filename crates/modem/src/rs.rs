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

//! The modem's inner code: Reed-Solomon over GF(256) (polynomial 0x11d,
//! first root 1) with errors and erasures, from `qrcraftly_core`. A decoder
//! that is told which bytes are unreliable spends one check byte on each,
//! where a byte it has to find costs two.

use qrcraftly_core::reed_solomon;

/// Writes the codeword of `message` with `parity` check bytes: the message,
/// then the check bytes. `out` must hold `message.len() + parity` bytes and
/// the codeword at most 255. Returns `false` when it does not fit.
pub fn encode(message: &[u8], parity: usize, out: &mut [u8]) -> bool {
    let n = message.len() + parity;
    if n > reed_solomon::MAX_BLOCK || out.len() < n {
        return false;
    }
    out[..message.len()].copy_from_slice(message);
    if parity == 0 {
        return true;
    }
    let mut generator = [0u8; reed_solomon::MAX_DEGREE + 1];
    reed_solomon::generator(parity, &mut generator)
        && reed_solomon::encode(message, &generator[..=parity], &mut out[message.len()..n])
}

/// Decodes a codeword in place, repairing the erasures (positions from the
/// start of the codeword) and unknown errors. Returns how many positions it
/// repaired (every erasure plus every error found), or `None` when the damage
/// is beyond the code. Erased bytes are zeroed first, so a word that is a
/// codeword with them zeroed counts as clean.
pub fn decode(word: &mut [u8], parity: usize, erasures: &[usize]) -> Option<usize> {
    if erasures.len() > parity || erasures.iter().any(|&e| e >= word.len()) {
        return None;
    }
    for &e in erasures {
        word[e] = 0;
    }
    if parity == 0 {
        return Some(0);
    }
    reed_solomon::decode_errata(word, parity, erasures).map(|errata| errata.located)
}

/// [`decode`] for a caller that holds the syndromes of the received word as
/// it was before the erasures are zeroed (from [`syndromes`]): it updates a
/// copy for the zeroed bytes instead of recomputing them over the whole word.
pub fn decode_from_syndromes(
    word: &mut [u8],
    parity: usize,
    erasures: &[usize],
    received: &[u8],
) -> Option<usize> {
    if erasures.len() > parity || erasures.iter().any(|&e| e >= word.len()) {
        return None;
    }
    if parity == 0 {
        for &e in erasures {
            word[e] = 0;
        }
        return Some(0);
    }
    if received.len() != parity {
        return None;
    }
    let mut current = [0u8; reed_solomon::MAX_DEGREE];
    current[..parity].copy_from_slice(received);
    for &e in erasures {
        if word[e] != 0 {
            reed_solomon::add_to_syndromes(&mut current[..parity], word.len(), e, word[e]);
            word[e] = 0;
        }
    }
    reed_solomon::decode_errata_with_syndromes(word, parity, erasures, &current[..parity])
        .map(|errata| errata.located)
}

/// The `parity` syndromes of `word` into `out`; `false` when they do not fit.
pub fn syndromes(word: &[u8], parity: usize, out: &mut [u8]) -> bool {
    reed_solomon::syndromes(word, parity, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_with_errors_and_erasures() {
        let message: [u8; 20] = core::array::from_fn(|i| (i * 37 + 5) as u8);
        let mut word = [0u8; 30];
        assert!(encode(&message, 10, &mut word));
        assert_eq!(word[..20], message);
        let mut damaged = word;
        damaged[2] ^= 0xff;
        damaged[25] ^= 1;
        damaged[7] ^= 9;
        assert_eq!(decode(&mut damaged, 10, &[7, 11]), Some(4));
        assert_eq!(damaged, word);
        let mut clean = word;
        assert_eq!(decode(&mut clean, 10, &[]), Some(0));
        let mut ruined = word;
        for byte in ruined.iter_mut().take(12) {
            *byte ^= 0x5a;
        }
        assert_eq!(decode(&mut ruined, 10, &[]), None);
        let mut no_check = [1u8, 2, 3];
        assert!(encode(&[1, 2, 3], 0, &mut no_check));
        assert_eq!(decode(&mut no_check, 0, &[]), Some(0));
        assert!(!encode(&[0; 250], 10, &mut [0; 260]));
    }
}
