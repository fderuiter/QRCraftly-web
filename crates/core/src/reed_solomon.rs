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
//! The QR encoder (#1177) uses it for its error correction blocks and the QR
//! decoder (#1178) corrects blocks with [`decode`]; the transfer codecs build on
//! the same field. Everything works on caller-supplied slices or fixed arrays,
//! so nothing here allocates.

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

/// The largest block [`decode`] accepts: every power of the generator's root
/// must name a different position.
pub const MAX_BLOCK: usize = 255;

/// Polynomial with its lowest-degree coefficient first, on the stack.
#[derive(Clone, Copy)]
struct Poly {
    c: [u8; MAX_BLOCK + 1],
    len: usize,
}

impl Poly {
    fn one() -> Poly {
        let mut c = [0u8; MAX_BLOCK + 1];
        c[0] = 1;
        Poly { c, len: 1 }
    }

    /// Value at `x`, term by term in the log domain: the terms do not depend
    /// on each other, unlike the steps of Horner's rule.
    fn eval(&self, x: u8) -> u8 {
        if x == 0 {
            return self.c[0];
        }
        let step = gf256::LOG[x as usize] as usize;
        let mut power = 0usize;
        let mut sum = 0u8;
        for &c in &self.c[..self.len] {
            if c != 0 {
                sum ^= gf256::EXP[gf256::LOG[c as usize] as usize + power];
            }
            power += step;
            if power >= 255 {
                power -= 255;
            }
        }
        sum
    }

    /// Value of the formal derivative at `x` (only odd powers survive in GF(2^8)).
    fn eval_derivative(&self, x: u8) -> u8 {
        if x == 0 {
            return if self.len > 1 { self.c[1] } else { 0 };
        }
        // c_i x^(i - 1) for odd i, the power stepping by x^2.
        let step = (2 * gf256::LOG[x as usize] as usize) % 255;
        let mut power = 0usize;
        let mut sum = 0u8;
        let mut i = 1;
        while i < self.len {
            let c = self.c[i];
            if c != 0 {
                sum ^= gf256::EXP[gf256::LOG[c as usize] as usize + power];
            }
            power += step;
            if power >= 255 {
                power -= 255;
            }
            i += 2;
        }
        sum
    }

    /// Multiplies by `1 + root x` in place, growing by one coefficient.
    fn mul_linear(&mut self, root: u8) {
        self.c[self.len] = 0;
        for i in (1..=self.len).rev() {
            self.c[i] ^= gf256::mul(self.c[i - 1], root);
        }
        self.len += 1;
    }

    /// `self * other`, keeping at most `limit` coefficients.
    fn mul_trunc(&self, other: &Poly, limit: usize) -> Poly {
        let mut out = Poly {
            c: [0u8; MAX_BLOCK + 1],
            len: (self.len + other.len - 1).min(limit),
        };
        for (i, &a) in self.c[..self.len].iter().enumerate() {
            if a == 0 {
                continue;
            }
            let log_a = gf256::LOG[a as usize] as usize;
            let reach = other.len.min(out.len.saturating_sub(i));
            for (j, &b) in other.c[..reach].iter().enumerate() {
                if b != 0 {
                    out.c[i + j] ^= gf256::EXP[log_a + gf256::LOG[b as usize] as usize];
                }
            }
        }
        out
    }

    fn degree(&self) -> usize {
        self.c[..self.len]
            .iter()
            .rposition(|&c| c != 0)
            .unwrap_or(0)
    }
}

/// Berlekamp-Massey: the shortest connection polynomial for `syndromes`, or
/// `None` when more errors are present than the syndromes can locate.
fn berlekamp_massey(syndromes: &[u8]) -> Option<Poly> {
    let mut c = Poly::one();
    let mut b = Poly::one();
    let mut l = 0usize;
    let mut m = 1usize;
    let mut last = 1u8;
    for n in 0..syndromes.len() {
        let mut d = syndromes[n];
        for (&ci, &si) in c.c[1..=l].iter().zip(syndromes[..n].iter().rev()) {
            if ci != 0 && si != 0 {
                d ^=
                    gf256::EXP[gf256::LOG[ci as usize] as usize + gf256::LOG[si as usize] as usize];
            }
        }
        if d == 0 {
            m += 1;
            continue;
        }
        let scale = gf256::div(d, last)?;
        let previous = c;
        let len = (b.len + m).max(c.len);
        if len > MAX_BLOCK {
            return None;
        }
        let log_scale = gf256::LOG[scale as usize] as usize;
        for (target, &bi) in c.c[m..m + b.len].iter_mut().zip(&b.c[..b.len]) {
            if bi != 0 {
                *target ^= gf256::EXP[log_scale + gf256::LOG[bi as usize] as usize];
            }
        }
        c.len = len;
        if 2 * l <= n {
            l = n + 1 - l;
            b = previous;
            last = d;
            m = 1;
        } else {
            m += 1;
        }
    }
    if 2 * l > syndromes.len() || c.degree() != l {
        return None;
    }
    c.len = l + 1;
    Some(c)
}

/// Corrects `block` in place: data followed by `check` check symbols, as
/// [`encode`] produces them, highest power first. `erasures` are indexes into
/// `block` known to be unreliable; each costs one check symbol where an
/// unknown error costs two.
///
/// Returns how many symbols were changed, or `None` when the block cannot be
/// corrected (it is then left as it was). A result is only returned when every
/// syndrome of the corrected block is zero.
pub fn decode(block: &mut [u8], check: usize, erasures: &[usize]) -> Option<usize> {
    decode_errata(block, check, erasures).map(|errata| errata.changed)
}

/// What [`decode_errata`] repaired.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Errata {
    /// Symbols whose value changed.
    pub changed: usize,
    /// Positions the decoder located: every erasure plus every error it found,
    /// erasures that held the right value included. 0 for a block that was
    /// already clean.
    pub located: usize,
}

/// Writes the first `check` syndromes of `block` (its values at 2^0 .. 2^(check - 1),
/// index 0 the highest power) into `out[..check]`. Returns `false`, writing
/// nothing, when `out` is too short or the block too long.
pub fn syndromes(block: &[u8], check: usize, out: &mut [u8]) -> bool {
    if block.len() > MAX_BLOCK || check > MAX_DEGREE || out.len() < check {
        return false;
    }
    // Summed position by position: each symbol's share of the `check`
    // syndromes is independent of the others', which keeps the work out of one
    // long chain of dependent table lookups.
    let out = &mut out[..check];
    out.fill(0);
    for (index, &value) in block.iter().enumerate() {
        add_to_syndromes(out, block.len(), index, value);
    }
    true
}

/// Adds `value` at `index` of an `n`-symbol block to its syndromes: the change
/// to every syndrome when that symbol is XORed with `value`. Syndromes are
/// linear, so a caller that edits a few symbols of a long block can update
/// them instead of recomputing [`syndromes`].
pub fn add_to_syndromes(syndromes: &mut [u8], n: usize, index: usize, value: u8) {
    if value == 0 || index >= n || n > MAX_BLOCK {
        return;
    }
    // value * (2^j)^(n - 1 - index), stepping the logarithm by n - 1 - index.
    let step = (n - 1 - index) % 255;
    let mut log = gf256::LOG[value as usize] as usize;
    for s in syndromes.iter_mut() {
        *s ^= gf256::EXP[log];
        log += step;
        if log >= 255 {
            log -= 255;
        }
    }
}

/// [`decode`], also reporting how many positions were located. The optical
/// modem's inner code (#1198) counts its repairs that way.
pub fn decode_errata(block: &mut [u8], check: usize, erasures: &[usize]) -> Option<Errata> {
    let mut computed = [0u8; MAX_DEGREE];
    if !syndromes(block, check, &mut computed) {
        return None;
    }
    decode_errata_with_syndromes(block, check, erasures, &computed[..check])
}

/// [`decode_errata`] for a caller that already holds the block's syndromes
/// (see [`syndromes`] and [`add_to_syndromes`]). `syndromes` must be exactly
/// those of `block`; the result is then the same as [`decode_errata`]'s.
pub fn decode_errata_with_syndromes(
    block: &mut [u8],
    check: usize,
    erasures: &[usize],
    syndromes: &[u8],
) -> Option<Errata> {
    let n = block.len();
    if check == 0
        || check > MAX_DEGREE
        || n > MAX_BLOCK
        || check >= n
        || erasures.len() > check
        || syndromes.len() != check
    {
        return None;
    }
    for (k, &index) in erasures.iter().enumerate() {
        if index >= n || erasures[..k].contains(&index) {
            return None;
        }
    }
    // Index i holds the coefficient of x^(n - 1 - i).
    let locator_of = |index: usize| gf256::exp2((n - 1 - index) as u32);

    let mut given = Poly {
        c: [0u8; MAX_BLOCK + 1],
        len: check,
    };
    given.c[..check].copy_from_slice(syndromes);
    let syndromes = given;
    if syndromes.c[..check].iter().all(|&s| s == 0) {
        return Some(Errata {
            changed: 0,
            located: 0,
        });
    }

    // Erasure locator: the product of (1 + X x) over the erased positions.
    // At most `check` < 255 factors, so the product fits.
    let mut erased = Poly::one();
    for &index in erasures {
        erased.mul_linear(locator_of(index));
    }

    // Forney syndromes remove the erasures; what is left locates the unknown errors.
    let forney = syndromes.mul_trunc(&erased, check);
    let errors = berlekamp_massey(&forney.c[erasures.len()..check])?;
    if 2 * errors.degree() + erasures.len() > check {
        return None;
    }
    // The full locator is errors x erased. Its roots among the positions are
    // the erasures, which are roots of `erased` by construction, and the
    // roots of `errors`, so only `errors` needs a Chien search. The full
    // locator has as many distinct roots as its degree exactly when `errors`
    // has as many as its own and none of them is an erasure (that would be a
    // repeated root); otherwise the block cannot be decoded.
    let wanted = errors.degree();
    let mut roots = [0usize; MAX_BLOCK];
    let mut found = 0;
    // Chien search in the log domain. Position `index` has locator 2^(n - 1 - index), whose
    // inverse is 2^e with e = index - (n - 1) mod 255; each term c_k (2^e)^k is kept as its
    // logarithm and steps by k as the index grows by one.
    let mut terms = [(0usize, 0usize); MAX_BLOCK + 1];
    let mut term_count = 0;
    let start = (255 - (n - 1) % 255) % 255;
    for (k, &c) in errors.c[..errors.len].iter().enumerate() {
        if c != 0 {
            terms[term_count] = (k % 255, (gf256::LOG[c as usize] as usize + k * start) % 255);
            term_count += 1;
        }
    }
    for index in 0..n {
        // A polynomial of degree `wanted` has at most that many roots, and
        // every position is a different point: once all are found, or too few
        // positions are left to find them, the rest of the search cannot
        // change the outcome.
        if found == wanted {
            break;
        }
        if n - index < wanted - found {
            return None;
        }
        let mut value = 0u8;
        for term in &mut terms[..term_count] {
            value ^= gf256::EXP[term.1];
            term.1 += term.0;
            if term.1 >= 255 {
                term.1 -= 255;
            }
        }
        if value == 0 {
            if erasures.contains(&index) {
                return None;
            }
            roots[found] = index;
            found += 1;
        }
    }
    if found != wanted {
        return None;
    }

    let locator = errors.mul_trunc(&erased, MAX_BLOCK + 1);
    let evaluator = syndromes.mul_trunc(&locator, check);
    let mut fixes = [(0usize, 0u8); MAX_BLOCK];
    let positions = erasures.iter().chain(&roots[..found]);
    for (slot, &index) in fixes.iter_mut().zip(positions) {
        let x = locator_of(index);
        let x_inv = gf256::inv(x)?;
        let denominator = locator.eval_derivative(x_inv);
        let magnitude = gf256::div(gf256::mul(x, evaluator.eval(x_inv)), denominator)?;
        *slot = (index, magnitude);
    }
    let found = erasures.len() + found;
    let mut changed = 0;
    for &(index, magnitude) in &fixes[..found] {
        block[index] ^= magnitude;
        changed += usize::from(magnitude != 0);
    }
    // Belt and braces: a decoder failure must never pass as a correction. The
    // corrected block's syndromes are the received ones plus each fix's share.
    let mut after = syndromes;
    for &(index, magnitude) in &fixes[..found] {
        add_to_syndromes(&mut after.c[..check], n, index, magnitude);
    }
    if after.c[..check].iter().any(|&s| s != 0) {
        for &(index, magnitude) in &fixes[..found] {
            block[index] ^= magnitude;
        }
        return None;
    }
    Some(Errata {
        changed,
        located: found,
    })
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

    /// A deterministic generator for the randomised tests (xorshift32).
    struct Rng(u32);

    impl Rng {
        fn next(&mut self) -> u32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 17;
            self.0 ^= self.0 << 5;
            self.0
        }

        fn below(&mut self, n: usize) -> usize {
            self.next() as usize % n
        }
    }

    fn codeword(rng: &mut Rng, data_len: usize, check: usize) -> ([u8; 255], usize) {
        let mut word = [0u8; 255];
        for byte in &mut word[..data_len] {
            *byte = rng.next() as u8;
        }
        let mut gen = [0u8; MAX_DEGREE + 1];
        assert!(generator(check, &mut gen));
        let (data, ecc) = word.split_at_mut(data_len);
        assert!(encode(data, &gen[..=check], ecc));
        (word, data_len + check)
    }

    #[test]
    fn decode_leaves_a_clean_block_alone() {
        let mut rng = Rng(7);
        let (mut word, n) = codeword(&mut rng, 16, 10);
        let copy = word;
        assert_eq!(decode(&mut word[..n], 10, &[]), Some(0));
        assert_eq!(word, copy);
    }

    #[test]
    fn decode_corrects_errors_and_erasures_within_the_bound() {
        let mut rng = Rng(0x1234_5678);
        for round in 0..2000 {
            let check = 2 + rng.below(29);
            let data_len = 1 + rng.below(120);
            let (original, n) = codeword(&mut rng, data_len, check);
            let erasure_count = rng.below(check + 1);
            let error_count = (check - erasure_count) / 2;
            let errors = rng.below(error_count + 1);
            let mut word = original;
            let mut touched = [false; 255];
            let mut erasures = [0usize; 64];
            for slot in erasures.iter_mut().take(erasure_count) {
                let mut i = rng.below(n);
                while touched[i] {
                    i = (i + 1) % n;
                }
                touched[i] = true;
                *slot = i;
                // An erased symbol may or may not actually be wrong.
                word[i] ^= rng.next() as u8;
            }
            for _ in 0..errors {
                let mut i = rng.below(n);
                while touched[i] {
                    i = (i + 1) % n;
                }
                touched[i] = true;
                word[i] ^= 1 + rng.below(255) as u8;
            }
            let fixed = decode(&mut word[..n], check, &erasures[..erasure_count]);
            assert!(
                fixed.is_some(),
                "round {round}: n {n} check {check} erasures {erasure_count} errors {errors}"
            );
            assert_eq!(word[..n], original[..n], "round {round}");
        }
    }

    #[test]
    fn decode_never_returns_a_wrong_block_as_valid() {
        let mut rng = Rng(99);
        for _ in 0..2000 {
            let check = 2 + rng.below(20);
            let data_len = 10 + rng.below(40);
            let (original, n) = codeword(&mut rng, data_len, check);
            let mut word = original;
            for _ in 0..check / 2 + 1 + rng.below(check) {
                let i = rng.below(n);
                word[i] ^= 1 + rng.below(255) as u8;
            }
            let before = word;
            match decode(&mut word[..n], check, &[]) {
                // Beyond the bound a decoder may land on another codeword; it must be one.
                Some(_) => {
                    let mut probe = word;
                    assert_eq!(decode(&mut probe[..n], check, &[]), Some(0));
                }
                None => assert_eq!(word, before),
            }
        }
    }

    #[test]
    fn decode_errata_counts_located_positions() {
        let mut rng = Rng(5);
        let (original, n) = codeword(&mut rng, 20, 10);
        let mut word = original;
        // Two erasures, one of them holding the right value, and one error.
        word[3] ^= 0x55;
        word[9] ^= 0x0f;
        let errata = decode_errata(&mut word[..n], 10, &[3, 7]).unwrap();
        assert_eq!(word[..n], original[..n]);
        assert_eq!(
            errata,
            Errata {
                changed: 2,
                located: 3
            }
        );
        let mut clean = original;
        assert_eq!(
            decode_errata(&mut clean[..n], 10, &[1]),
            Some(Errata {
                changed: 0,
                located: 0
            })
        );
    }

    #[test]
    fn updated_syndromes_match_recomputed_ones() {
        let mut rng = Rng(0x0119_8000);
        for _ in 0..500 {
            let check = 2 + rng.below(40);
            let data_len = 1 + rng.below(200);
            let (original, n) = codeword(&mut rng, data_len.min(254 - check), check);
            let mut word = original;
            let mut tracked = [0u8; MAX_DEGREE];
            assert!(syndromes(&word[..n], check, &mut tracked));
            assert!(tracked[..check].iter().all(|&s| s == 0));
            let mut erasures = [0usize; 8];
            for slot in &mut erasures {
                let i = rng.below(n);
                let value = rng.next() as u8;
                word[i] ^= value;
                add_to_syndromes(&mut tracked[..check], n, i, value);
                *slot = i;
            }
            let mut fresh = [0u8; MAX_DEGREE];
            assert!(syndromes(&word[..n], check, &mut fresh));
            assert_eq!(tracked[..check], fresh[..check]);
            for (j, &s) in fresh[..check].iter().enumerate() {
                let horner = word[..n]
                    .iter()
                    .fold(0u8, |acc, &c| gf256::mul(acc, gf256::exp2(j as u32)) ^ c);
                assert_eq!(s, horner);
            }
            let mut erasures = erasures[..check.min(4)].to_vec();
            erasures.sort_unstable();
            erasures.dedup();
            let mut a = word;
            let mut b = word;
            assert_eq!(
                decode_errata(&mut a[..n], check, &erasures),
                decode_errata_with_syndromes(&mut b[..n], check, &erasures, &fresh[..check])
            );
            assert_eq!(a, b);
        }
        assert!(!syndromes(&[0u8; 256], 4, &mut [0u8; 4]));
        assert!(!syndromes(&[0u8; 10], 4, &mut [0u8; 3]));
        assert_eq!(
            decode_errata_with_syndromes(&mut [0u8; 10], 4, &[], &[0u8; 3]),
            None
        );
    }

    #[test]
    fn decode_rejects_bad_arguments() {
        let mut block = [0u8; 10];
        assert_eq!(decode(&mut block, 0, &[]), None);
        assert_eq!(decode(&mut block, 10, &[]), None);
        assert_eq!(decode(&mut block, 4, &[1, 2, 3, 4, 5]), None);
        assert_eq!(decode(&mut block, 4, &[10]), None);
        assert_eq!(decode(&mut block, 4, &[2, 2]), None);
        assert_eq!(decode(&mut [0u8; 256], 4, &[]), None);
    }
}
