/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

//! Systematic Reed-Solomon encoding over GF(256) with the generator
//! polynomial (x - 2^0)(x - 2^1)...(x - 2^(n-1)), as QR codes use it.
//!
//! The QR encoder (#1177) uses it for its error correction blocks; the decoder
//! (#1178) and the transfer codecs build on the same field. Everything works on
//! caller-supplied slices, so nothing here allocates.

use crate::gf256;

/// The largest number of check symbols one block can have.
pub const MAX_DEGREE: usize = 254;

/// Writes the monic generator polynomial of `degree` into `out[..=degree]`,
/// highest power first (`out[0]` is always 1).
///
/// Returns `false` when `degree` is 0, above [`MAX_DEGREE`] or `out` is shorter than `degree + 1`.
pub fn generator(degree: usize, out: &mut [u8]) -> bool {
    if degree == 0 || degree > MAX_DEGREE || out.len() <= degree {
        return false;
    }
    let poly = &mut out[..=degree];
    poly.fill(0);
    poly[0] = 1;
    // Multiply by (x + 2^i) one root at a time; the polynomial has i + 1 terms before step i.
    for i in 0..degree {
        let root = gf256::exp2(i as u32);
        let mut j = i + 1;
        while j > 0 {
            poly[j] ^= gf256::mul(poly[j - 1], root);
            j -= 1;
        }
    }
    true
}

/// Computes the check symbols of `data` for the generator `generator`
/// (as written by [`generator`], `degree + 1` terms) into `out[..degree]`.
///
/// Returns `false` when `out` is shorter than the generator's degree or the generator is empty.
pub fn encode(data: &[u8], generator: &[u8], out: &mut [u8]) -> bool {
    let Some(degree) = generator.len().checked_sub(1) else {
        return false;
    };
    if degree == 0 || out.len() < degree {
        return false;
    }
    let rem = &mut out[..degree];
    rem.fill(0);
    for &byte in data {
        let factor = byte ^ rem[0];
        rem.copy_within(1.., 0);
        rem[degree - 1] = 0;
        if factor != 0 {
            for (r, &g) in rem.iter_mut().zip(&generator[1..]) {
                *r ^= gf256::mul(g, factor);
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Evaluates a polynomial (highest power first) at `x`.
    fn eval(poly: &[u8], x: u8) -> u8 {
        poly.iter().fold(0, |acc, &c| gf256::mul(acc, x) ^ c)
    }

    #[test]
    fn generator_has_the_expected_roots() {
        let mut gen = [0u8; 31];
        for degree in 1..=30 {
            assert!(generator(degree, &mut gen));
            assert_eq!(gen[0], 1);
            for i in 0..degree {
                assert_eq!(
                    eval(&gen[..=degree], gf256::exp2(i as u32)),
                    0,
                    "degree {degree} root {i}"
                );
            }
        }
    }

    #[test]
    fn generator_matches_the_specification() {
        // ISO/IEC 18004 Annex A, degree 7: exponents 0, 87, 229, 146, 149, 238, 102, 21.
        let mut gen = [0u8; 8];
        assert!(generator(7, &mut gen));
        let exps = [0u32, 87, 229, 146, 149, 238, 102, 21];
        for (c, e) in gen.iter().zip(exps) {
            assert_eq!(*c, gf256::exp2(e));
        }
    }

    #[test]
    fn codeword_is_divisible_by_the_generator() {
        let mut gen = [0u8; 11];
        assert!(generator(10, &mut gen));
        let data: [u8; 16] = [
            0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
            0xec, 0x11,
        ];
        let mut ecc = [0u8; 10];
        assert!(encode(&data, &gen, &mut ecc));
        // The worked example in ISO/IEC 18004 (1-M "01234567").
        assert_eq!(
            ecc,
            [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]
        );
        let mut codeword = [0u8; 26];
        codeword[..16].copy_from_slice(&data);
        codeword[16..].copy_from_slice(&ecc);
        for i in 0..10 {
            assert_eq!(eval(&codeword, gf256::exp2(i)), 0);
        }
    }

    #[test]
    fn rejects_bad_arguments() {
        let mut gen = [0u8; 4];
        assert!(!generator(0, &mut gen));
        assert!(!generator(4, &mut gen));
        assert!(!generator(MAX_DEGREE + 1, &mut [0u8; 300]));
        let mut out = [0u8; 2];
        assert!(!encode(&[1, 2], &[1, 2, 3, 4], &mut out));
        assert!(!encode(&[1, 2], &[], &mut out));
        assert!(!encode(&[1, 2], &[1], &mut out));
    }
}
