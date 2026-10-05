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

//! The encoder: computes the precode's parity once, then any encoding symbol
//! on demand, so a sender can stream for as long as it likes.

use alloc::vec;
use alloc::vec::Vec;

use crate::code::{Code, MAX_SYMBOL_BYTES};
use crate::symbol::{load, store, xor_into};

/// Encodes one source block.
pub struct Encoder {
    code: Code,
    /// Symbol size in 64-bit words.
    words: usize,
    /// The L intermediate symbols, `words` each.
    intermediate: Vec<u64>,
    /// The last symbol made, as bytes.
    out: Vec<u8>,
}

/// Whether `t` is a usable symbol size: a positive multiple of 8, at most [`MAX_SYMBOL_BYTES`].
pub fn valid_symbol_size(t: usize) -> bool {
    t > 0 && t.is_multiple_of(8) && t <= MAX_SYMBOL_BYTES
}

impl Encoder {
    /// An encoder for `source`, which holds `k` symbols of `t` bytes, or
    /// `None` when the sizes are out of range or do not match.
    pub fn new(k: usize, t: usize, seed: u32, source: &[u8]) -> Option<Self> {
        let code = Code::new(k, seed)?;
        if !valid_symbol_size(t) || source.len() != k * t {
            return None;
        }
        let words = t / 8;
        let mut intermediate = vec![0u64; code.l * words];
        load(source, &mut intermediate[..k * words]);
        let (sources, parity) = intermediate.split_at_mut(k * words);
        code.for_each_check(|s, c| {
            xor_into(
                &mut parity[c * words..(c + 1) * words],
                &sources[s * words..(s + 1) * words],
            );
        });
        Some(Encoder {
            code,
            words,
            intermediate,
            out: vec![0u8; t],
        })
    }

    /// Encoding symbol `esi`, `t` bytes.
    pub fn symbol(&mut self, esi: u32) -> &[u8] {
        let words = self.words;
        let mut acc = [0u64; MAX_SYMBOL_BYTES / 8];
        let acc = &mut acc[..words];
        let intermediate = &self.intermediate;
        self.code.for_each_column(esi, |c| {
            xor_into(acc, &intermediate[c * words..(c + 1) * words]);
        });
        store(acc, &mut self.out);
        &self.out
    }

    pub fn code(&self) -> &Code {
        &self.code
    }
}
