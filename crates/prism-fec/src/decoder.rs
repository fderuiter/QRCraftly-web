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

//! The decoder: plain Gaussian elimination over GF(2), done as symbols arrive.
//!
//! The decoder keeps a row echelon basis of everything it has seen: the S
//! precode checks (each XORs to zero) and every received symbol. A new symbol
//! is reduced against the stored rows, lowest column first, and its payload
//! with it. If anything is left, it is stored with its lowest column as its
//! pivot; if nothing is, the symbol added nothing (a duplicate, or a
//! combination of earlier symbols). Once all L columns have a pivot,
//! back-substitution from the highest column down yields every intermediate
//! symbol, and the first K are the source.
//!
//! All memory is reserved up front (L rows of L bits and L payloads), so adding
//! a symbol never allocates.

use alloc::vec;
use alloc::vec::Vec;

use crate::code::Code;
use crate::encoder::valid_symbol_size;
use crate::symbol::{load, store, xor_into};

/// What adding a symbol did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Added {
    /// The symbol was a combination of earlier ones (or a duplicate).
    Redundant = 0,
    /// The symbol raised the rank.
    Innovative = 1,
    /// The block can now be solved.
    Complete = 2,
}

const NONE: u32 = u32::MAX;

/// Decodes one source block.
pub struct Decoder {
    code: Code,
    t: usize,
    /// Matrix row length in 64-bit words, ceil(L / 64).
    row_words: usize,
    /// Payload length in 64-bit words, T / 8.
    pay_words: usize,
    /// Stored rows, `row_words` each, in the order they were stored.
    rows: Vec<u64>,
    /// Their payloads, `pay_words` each. After solving, a row's payload is the
    /// value of its pivot column.
    pays: Vec<u64>,
    /// For each column, the stored row whose pivot it is, or `NONE`.
    pivot_row: Vec<u32>,
    rank: usize,
    row: Vec<u64>,
    pay: Vec<u64>,
    /// Where the caller writes the next symbol's payload.
    inbox: Vec<u8>,
    /// The solved source block, K × T bytes.
    out: Vec<u8>,
    solved: bool,
}

impl Decoder {
    /// A decoder for `k` source symbols of `t` bytes, or `None` when either is out of range.
    pub fn new(k: usize, t: usize, seed: u32) -> Option<Self> {
        let code = Code::new(k, seed)?;
        if !valid_symbol_size(t) {
            return None;
        }
        let l = code.l;
        let row_words = l.div_ceil(64);
        let pay_words = t / 8;
        let mut decoder = Decoder {
            t,
            row_words,
            pay_words,
            rows: vec![0; l * row_words],
            pays: vec![0; l * pay_words],
            pivot_row: vec![NONE; l],
            rank: 0,
            row: vec![0; row_words],
            pay: vec![0; pay_words],
            inbox: vec![0; t],
            out: vec![0; k * t],
            solved: false,
            code,
        };
        // The precode checks: check c is parity column K + c XOR its sources.
        let (k, s) = (decoder.code.k, decoder.code.s);
        let mut checks = vec![0u64; s * row_words];
        for c in 0..s {
            set(&mut checks[c * row_words..(c + 1) * row_words], k + c);
        }
        decoder.code.clone().for_each_check(|source, c| {
            set(&mut checks[c * row_words..(c + 1) * row_words], source);
        });
        for c in 0..s {
            decoder
                .row
                .copy_from_slice(&checks[c * row_words..(c + 1) * row_words]);
            decoder.pay.fill(0);
            decoder.reduce_and_store();
        }
        Some(decoder)
    }

    pub fn code(&self) -> &Code {
        &self.code
    }

    /// Independent equations so far; the block solves at L.
    pub fn rank(&self) -> usize {
        self.rank
    }

    /// The buffer for the next symbol's payload, T bytes.
    pub fn inbox(&mut self) -> &mut [u8] {
        &mut self.inbox
    }

    /// Adds encoding symbol `esi`, whose payload is in [`Decoder::inbox`].
    pub fn add_inbox(&mut self, esi: u32) -> Added {
        if self.rank == self.code.l {
            return Added::Complete;
        }
        self.row.fill(0);
        let row = &mut self.row;
        self.code.for_each_column(esi, |c| set(row, c));
        load(&self.inbox, &mut self.pay);
        self.reduce_and_store()
    }

    /// Adds encoding symbol `esi` with payload `symbol` (T bytes).
    pub fn add(&mut self, esi: u32, symbol: &[u8]) -> Added {
        let t = self.t.min(symbol.len());
        self.inbox[..t].copy_from_slice(&symbol[..t]);
        self.add_inbox(esi)
    }

    /// Reduces `self.row` and `self.pay` against the stored rows and stores
    /// what is left.
    fn reduce_and_store(&mut self) -> Added {
        let (rw, pw) = (self.row_words, self.pay_words);
        let mut i = 0;
        while i < rw {
            let word = self.row[i];
            if word == 0 {
                i += 1;
                continue;
            }
            let column = i * 64 + word.trailing_zeros() as usize;
            let r = self.pivot_row[column];
            if r == NONE {
                let at = self.rank;
                self.rows[at * rw..(at + 1) * rw].copy_from_slice(&self.row);
                self.pays[at * pw..(at + 1) * pw].copy_from_slice(&self.pay);
                self.pivot_row[column] = at as u32;
                self.rank += 1;
                return if self.rank == self.code.l {
                    Added::Complete
                } else {
                    Added::Innovative
                };
            }
            let r = r as usize;
            // A stored row has nothing below its pivot, so words before `i` are zero.
            xor_into(&mut self.row[i..], &self.rows[r * rw + i..(r + 1) * rw]);
            xor_into(&mut self.pay, &self.pays[r * pw..(r + 1) * pw]);
        }
        Added::Redundant
    }

    /// Solves the block once it is complete and returns the K × T source bytes.
    pub fn solve(&mut self) -> Option<&[u8]> {
        if self.rank < self.code.l {
            return None;
        }
        if !self.solved {
            let (rw, pw) = (self.row_words, self.pay_words);
            for column in (0..self.code.l).rev() {
                let r = self.pivot_row[column] as usize;
                self.pay.copy_from_slice(&self.pays[r * pw..(r + 1) * pw]);
                let row = &self.rows[r * rw..(r + 1) * rw];
                // Every column above this one is already solved.
                let first = column / 64;
                for (i, &word) in row.iter().enumerate().skip(first) {
                    let mut bits = if i == first {
                        word & !(u64::MAX >> (63 - column % 64))
                    } else {
                        word
                    };
                    while bits != 0 {
                        let other = i * 64 + bits.trailing_zeros() as usize;
                        bits &= bits - 1;
                        let o = self.pivot_row[other] as usize;
                        xor_into(&mut self.pay, &self.pays[o * pw..(o + 1) * pw]);
                    }
                }
                self.pays[r * pw..(r + 1) * pw].copy_from_slice(&self.pay);
            }
            let t = self.t;
            for j in 0..self.code.k {
                let r = self.pivot_row[j] as usize;
                store(
                    &self.pays[r * pw..(r + 1) * pw],
                    &mut self.out[j * t..(j + 1) * t],
                );
            }
            self.solved = true;
        }
        Some(&self.out)
    }
}

#[inline]
fn set(row: &mut [u64], column: usize) {
    row[column / 64] ^= 1 << (column % 64);
}
