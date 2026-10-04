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

//! Arithmetic in GF(2^8) with the QR code reducing polynomial
//! x^8 + x^4 + x^3 + x^2 + 1 (0x11d) and generator 2.
//!
//! Reed-Solomon for QR codes (#1177) and the transfer codecs (#1176) build on
//! these tables. They are computed at compile time, so there is no start-up cost.

/// The reducing polynomial, including the x^8 term.
pub const POLY: u16 = 0x11d;

const fn build_tables() -> ([u8; 512], [u8; 256]) {
    let mut exp = [0u8; 512];
    let mut log = [0u8; 256];
    let mut x: u16 = 1;
    let mut i = 0;
    while i < 255 {
        exp[i] = x as u8;
        log[x as usize] = i as u8;
        x <<= 1;
        if x & 0x100 != 0 {
            x ^= POLY;
        }
        i += 1;
    }
    // Repeat the cycle so `mul` can index exp[log a + log b] without a modulo.
    while i < 512 {
        exp[i] = exp[i - 255];
        i += 1;
    }
    (exp, log)
}

const TABLES: ([u8; 512], [u8; 256]) = build_tables();

/// exp[i] = 2^i, repeated so indices up to 509 are valid.
pub static EXP: [u8; 512] = TABLES.0;
/// log[x] = i where 2^i = x. `log[0]` is unused (zero has no logarithm).
pub static LOG: [u8; 256] = TABLES.1;

/// Addition and subtraction are both XOR.
#[inline]
pub const fn add(a: u8, b: u8) -> u8 {
    a ^ b
}

#[inline]
pub fn mul(a: u8, b: u8) -> u8 {
    if a == 0 || b == 0 {
        return 0;
    }
    EXP[LOG[a as usize] as usize + LOG[b as usize] as usize]
}

/// Multiplicative inverse, or `None` for zero.
#[inline]
pub fn inv(a: u8) -> Option<u8> {
    if a == 0 {
        return None;
    }
    Some(EXP[255 - LOG[a as usize] as usize])
}

/// a / b, or `None` when b is zero.
#[inline]
pub fn div(a: u8, b: u8) -> Option<u8> {
    if b == 0 {
        return None;
    }
    if a == 0 {
        return Some(0);
    }
    Some(EXP[LOG[a as usize] as usize + 255 - LOG[b as usize] as usize])
}

/// 2^n for any n.
#[inline]
pub fn exp2(n: u32) -> u8 {
    EXP[(n % 255) as usize]
}

/// a^n.
pub fn pow(a: u8, n: u32) -> u8 {
    if n == 0 {
        return 1;
    }
    if a == 0 {
        return 0;
    }
    let e = (LOG[a as usize] as u64 * n as u64) % 255;
    EXP[e as usize]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shift-and-add multiplication, as an independent oracle for the tables.
    fn slow_mul(mut a: u8, mut b: u8) -> u8 {
        let mut product = 0u8;
        while b != 0 {
            if b & 1 != 0 {
                product ^= a;
            }
            let carry = a & 0x80 != 0;
            a <<= 1;
            if carry {
                a ^= (POLY & 0xff) as u8;
            }
            b >>= 1;
        }
        product
    }

    #[test]
    fn tables_match_shift_and_add_for_every_pair() {
        for a in 0..=255u8 {
            for b in 0..=255u8 {
                assert_eq!(mul(a, b), slow_mul(a, b), "{a} * {b}");
            }
        }
    }

    #[test]
    fn generator_has_order_255() {
        let mut seen = [false; 256];
        for i in 0..255 {
            let v = exp2(i);
            assert!(!seen[v as usize], "2^{i} repeats");
            seen[v as usize] = true;
        }
        assert!(!seen[0]);
        assert_eq!(exp2(255), 1);
    }

    #[test]
    fn inverse_and_division_round_trip() {
        assert_eq!(inv(0), None);
        assert_eq!(div(7, 0), None);
        for a in 1..=255u8 {
            let ia = inv(a).unwrap();
            assert_eq!(mul(a, ia), 1);
            for b in 1..=255u8 {
                assert_eq!(mul(div(a, b).unwrap(), b), a);
            }
        }
    }

    #[test]
    fn known_values() {
        // Values from the QR code specification's GF(256) tables.
        assert_eq!(exp2(8), 0x1d);
        assert_eq!(exp2(25), 0x03);
        assert_eq!(LOG[0x03], 25);
        assert_eq!(pow(2, 8), 0x1d);
        assert_eq!(pow(0, 0), 1);
        assert_eq!(pow(0, 5), 0);
        assert_eq!(pow(3, 255), 1);
    }
}
