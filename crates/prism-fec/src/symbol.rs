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

//! Symbols as little-endian 64-bit words, so XORs work a word at a time.

/// XORs `src` into `dst`, word by word.
#[inline]
pub fn xor_into(dst: &mut [u64], src: &[u64]) {
    for (d, s) in dst.iter_mut().zip(src) {
        *d ^= *s;
    }
}

/// Reads bytes into words, 8 bytes per word, little-endian.
pub fn load(bytes: &[u8], words: &mut [u64]) {
    for (w, chunk) in words.iter_mut().zip(bytes.chunks_exact(8)) {
        let mut b = [0u8; 8];
        b.copy_from_slice(chunk);
        *w = u64::from_le_bytes(b);
    }
}

/// Writes words out as bytes, little-endian.
pub fn store(words: &[u64], bytes: &mut [u8]) {
    for (w, chunk) in words.iter().zip(bytes.chunks_exact_mut(8)) {
        chunk.copy_from_slice(&w.to_le_bytes());
    }
}
