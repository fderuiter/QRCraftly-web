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

//! Arbitrary-precision unsigned integer arithmetic (`no_std`) with automatic zeroization on drop.

use crate::zeroize::zeroize_u32s;
use alloc::vec::Vec;
use core::cmp::Ordering;

#[derive(Clone)]
pub struct BigUint {
    /// Little-endian u32 limbs: `limbs[0]` is the least significant word.
    pub limbs: Vec<u32>,
}

impl BigUint {
    pub fn zero() -> Self {
        Self { limbs: Vec::new() }
    }

    pub fn from_u32(val: u32) -> Self {
        if val == 0 {
            Self::zero()
        } else {
            Self { limbs: alloc::vec![val] }
        }
    }

    pub fn from_bytes_be(bytes: &[u8]) -> Self {
        let mut start = 0;
        while start < bytes.length_or_zero(bytes.len()) && bytes[start] == 0 {
            start += 1;
        }
        let clean = &bytes[start..];
        if clean.is_empty() {
            return Self::zero();
        }

        let num_limbs = (clean.len() + 3) / 4;
        let mut limbs = Vec::with_capacity(num_limbs);

        for chunk in clean.rchunks(4) {
            let mut word = 0u32;
            for &byte in chunk {
                word = (word << 8) | (byte as u32);
            }
            limbs.push(word);
        }

        let mut res = Self { limbs };
        res.trim();
        res
    }

    pub fn to_bytes_be(&self) -> Vec<u8> {
        if self.is_zero() {
            return alloc::vec![0];
        }
        let mut bytes = Vec::new();
        let top = self.limbs.last().copied().unwrap_or(0);
        let top_bytes = [
            (top >> 24) as u8,
            (top >> 16) as u8,
            (top >> 8) as u8,
            top as u8,
        ];
        let mut start = 0;
        while start < 3 && top_bytes[start] == 0 {
            start += 1;
        }
        bytes.extend_from_slice(&top_bytes[start..]);

        for &word in self.limbs.iter().rev().skip(1) {
            bytes.push((word >> 24) as u8);
            bytes.push((word >> 16) as u8);
            bytes.push((word >> 8) as u8);
            bytes.push(word as u8);
        }

        bytes
    }

    pub fn to_bytes_be_pad(&self, len: usize) -> Vec<u8> {
        let raw = self.to_bytes_be();
        if raw.len() >= len {
            raw
        } else {
            let mut padded = Vec::with_capacity(len);
            padded.resize(len - raw.len(), 0);
            padded.extend_from_slice(&raw);
            padded
        }
    }

    pub fn is_zero(&self) -> bool {
        self.limbs.is_empty() || self.limbs.iter().all(|&x| x == 0)
    }

    pub fn bit_len(&self) -> usize {
        if self.is_zero() {
            return 0;
        }
        let top = *self.limbs.last().unwrap();
        (self.limbs.len() - 1) * 32 + (32 - top.leading_zeros() as usize)
    }

    fn trim(&mut self) {
        while let Some(&0) = self.limbs.last() {
            self.limbs.pop();
        }
    }

    pub fn cmp(&self, other: &Self) -> Ordering {
        let l1 = self.limbs.len();
        let l2 = other.limbs.len();
        if l1 != l2 {
            return l1.cmp(&l2);
        }
        for (a, b) in self.limbs.iter().rev().zip(other.limbs.iter().rev()) {
            if a != b {
                return a.cmp(b);
            }
        }
        Ordering::Equal
    }

    pub fn add(&self, other: &Self) -> Self {
        let len = core::cmp::max(self.limbs.len(), other.limbs.len());
        let mut limbs = Vec::with_capacity(len + 1);
        let mut carry = 0u64;

        for i in 0..len {
            let a = self.limbs.get(i).copied().unwrap_or(0) as u64;
            let b = other.limbs.get(i).copied().unwrap_or(0) as u64;
            let sum = a + b + carry;
            limbs.push(sum as u32);
            carry = sum >> 32;
        }
        if carry > 0 {
            limbs.push(carry as u32);
        }
        let mut res = Self { limbs };
        res.trim();
        res
    }

    pub fn sub(&self, other: &Self) -> Self {
        assert!(self.cmp(other) != Ordering::Less, "underflow in BigUint::sub");
        let mut limbs = Vec::with_capacity(self.limbs.len());
        let mut borrow = 0i64;

        for i in 0..self.limbs.len() {
            let a = self.limbs[i] as i64;
            let b = other.limbs.get(i).copied().unwrap_or(0) as i64;
            let diff = a - b - borrow;
            if diff < 0 {
                limbs.push((diff + 0x1_0000_0000) as u32);
                borrow = 1;
            } else {
                limbs.push(diff as u32);
                borrow = 0;
            }
        }
        let mut res = Self { limbs };
        res.trim();
        res
    }

    pub fn mul(&self, other: &Self) -> Self {
        if self.is_zero() || other.is_zero() {
            return Self::zero();
        }
        let mut limbs = alloc::vec![0u32; self.limbs.len() + other.limbs.len()];

        for (i, &a) in self.limbs.iter().enumerate() {
            let mut carry = 0u64;
            for (j, &b) in other.limbs.iter().enumerate() {
                let cur = limbs[i + j] as u64 + (a as u64) * (b as u64) + carry;
                limbs[i + j] = cur as u32;
                carry = cur >> 32;
            }
            limbs[i + other.limbs.len()] += carry as u32;
        }

        let mut res = Self { limbs };
        res.trim();
        res
    }

    /// Multiplies by a single `u32` word.
    pub fn mul_u32(&self, val: u32) -> Self {
        if val == 0 || self.is_zero() {
            return Self::zero();
        }
        let mut limbs = Vec::with_capacity(self.limbs.len() + 1);
        let mut carry = 0u64;
        let v = val as u64;

        for &a in &self.limbs {
            let prod = (a as u64) * v + carry;
            limbs.push(prod as u32);
            carry = prod >> 32;
        }
        if carry > 0 {
            limbs.push(carry as u32);
        }
        let mut res = Self { limbs };
        res.trim();
        res
    }

    /// Divides `self` by `divisor` returning `(quotient, remainder)`.
    pub fn div_rem(&self, divisor: &Self) -> (Self, Self) {
        assert!(!divisor.is_zero(), "division by zero");
        match self.cmp(divisor) {
            Ordering::Less => (Self::zero(), self.clone()),
            Ordering::Equal => (Self::from_u32(1), Self::zero()),
            Ordering::Greater => {
                if divisor.limbs.len() == 1 {
                    let d = divisor.limbs[0] as u64;
                    let mut q_limbs = alloc::vec![0u32; self.limbs.len()];
                    let mut rem = 0u64;
                    for i in (0..self.limbs.len()).rev() {
                        let cur = (rem << 32) | (self.limbs[i] as u64);
                        q_limbs[i] = (cur / d) as u32;
                        rem = cur % d;
                    }
                    let mut q = Self { limbs: q_limbs };
                    q.trim();
                    let mut r = Self::from_u32(rem as u32);
                    r.trim();
                    return (q, r);
                }

                // Knuth TAOCP Vol 2 Algorithm D for multi-word division
                self.div_rem_knuth(divisor)
            }
        }
    }

    fn div_rem_knuth(&self, v: &Self) -> (Self, Self) {
        let n = v.limbs.len();
        let m = self.limbs.len() - n;

        // D1. Normalize: multiply u and v by d = 2^(shift) so top bit of v is 1
        let shift = v.limbs.last().unwrap().leading_zeros() as usize;
        let mut u_norm = self.shl_bits(shift);
        let v_norm = v.shl_bits(shift);

        let mut u_limbs = core::mem::take(&mut u_norm.limbs);
        if u_limbs.len() < self.limbs.len() + 1 {
            u_limbs.push(0);
        }

        let v_top = v_norm.limbs[n - 1] as u64;
        let v_next = v_norm.limbs[n - 2] as u64;

        let mut q_limbs = alloc::vec![0u32; m + 1];

        for j in (0..=m).rev() {
            // D3. Calculate q_hat
            let u_jn = u_limbs[j + n] as u64;
            let u_jn1 = u_limbs[j + n - 1] as u64;
            let u_jn2 = u_limbs[j + n - 2] as u64;

            let num = (u_jn << 32) | u_jn1;
            let mut q_hat = num / v_top;
            let mut r_hat = num % v_top;

            while q_hat >= (1u64 << 32) || (q_hat * v_next > ((r_hat << 32) | u_jn2)) {
                q_hat -= 1;
                r_hat += v_top;
                if r_hat >= (1u64 << 32) {
                    break;
                }
            }

            // D4. Multiply and subtract: u = u - q_hat * v shifted by j
            let mut borrow = 0u64;
            for i in 0..n {
                let prod = (q_hat as u128) * (v_norm.limbs[i] as u128) + (borrow as u128);
                let prod_digit = (prod & 0xffff_ffff) as u64;
                let next_borrow = (prod >> 32) as u64;

                let u_val = u_limbs[j + i] as u64;
                if u_val < prod_digit {
                    u_limbs[j + i] = ((u_val + 0x1_0000_0000) - prod_digit) as u32;
                    borrow = next_borrow + 1;
                } else {
                    u_limbs[j + i] = (u_val - prod_digit) as u32;
                    borrow = next_borrow;
                }
            }

            let u_top = u_limbs[j + n] as u64;
            let negative = if u_top < borrow {
                u_limbs[j + n] = ((u_top + 0x1_0000_0000) - borrow) as u32;
                true
            } else {
                u_limbs[j + n] = (u_top - borrow) as u32;
                false
            };

            // D6. Add back if negative
            if negative {
                q_hat -= 1;
                let mut carry = 0u64;
                for i in 0..n {
                    let sum = (u_limbs[j + i] as u64) + (v_norm.limbs[i] as u64) + carry;
                    u_limbs[j + i] = sum as u32;
                    carry = sum >> 32;
                }
                u_limbs[j + n] = u_limbs[j + n].wrapping_add(carry as u32);
            }

            q_limbs[j] = q_hat as u32;
        }

        let mut q = Self { limbs: q_limbs };
        q.trim();

        // Remainder is in u_limbs[0..n], shifted right by `shift`
        let mut r_untrimmed = Self { limbs: u_limbs[..n].to_vec() };
        r_untrimmed.trim();
        let r = r_untrimmed.shr_bits(shift);

        (q, r)
    }

    pub fn shl_bits(&self, bits: usize) -> Self {
        if bits == 0 || self.is_zero() {
            return self.clone();
        }
        let word_shift = bits / 32;
        let bit_shift = bits % 32;

        let mut limbs = alloc::vec![0u32; word_shift];
        limbs.reserve(self.limbs.len() + 1);

        if bit_shift == 0 {
            limbs.extend_from_slice(&self.limbs);
        } else {
            let mut carry = 0u32;
            for &w in &self.limbs {
                limbs.push((w << bit_shift) | carry);
                carry = w >> (32 - bit_shift);
            }
            if carry > 0 {
                limbs.push(carry);
            }
        }
        let mut res = Self { limbs };
        res.trim();
        res
    }

    pub fn shr_bits(&self, bits: usize) -> Self {
        if bits == 0 || self.is_zero() {
            return self.clone();
        }
        let word_shift = bits / 32;
        let bit_shift = bits % 32;

        if word_shift >= self.limbs.len() {
            return Self::zero();
        }

        let src = &self.limbs[word_shift..];
        let mut limbs = Vec::with_capacity(src.len());

        if bit_shift == 0 {
            limbs.extend_from_slice(src);
        } else {
            for i in 0..src.len() {
                let low = src[i] >> bit_shift;
                let high = if i + 1 < src.len() {
                    src[i + 1] << (32 - bit_shift)
                } else {
                    0
                };
                limbs.push(low | high);
            }
        }
        let mut res = Self { limbs };
        res.trim();
        res
    }

    /// Computes `(self ^ exp) % modulus` using left-to-right binary exponentiation.
    pub fn mod_pow(&self, exp: &Self, modulus: &Self) -> Self {
        assert!(!modulus.is_zero(), "modular exponentiation with zero modulus");
        if exp.is_zero() {
            return Self::from_u32(1).div_rem(modulus).1;
        }

        let mut acc = Self::from_u32(1);
        let base = self.div_rem(modulus).1;

        let exp_bits = exp.bit_len();
        for i in (0..exp_bits).rev() {
            acc = acc.mul(&acc).div_rem(modulus).1;

            let word_idx = i / 32;
            let bit_idx = i % 32;
            let bit = (exp.limbs[word_idx] >> bit_idx) & 1;
            if bit == 1 {
                acc = acc.mul(&base).div_rem(modulus).1;
            }
        }
        acc
    }
}

trait LengthOrZero {
    fn length_or_zero(&self, len: usize) -> usize;
}
impl LengthOrZero for [u8] {
    fn length_or_zero(&self, len: usize) -> usize {
        len
    }
}

impl Drop for BigUint {
    fn drop(&mut self) {
        zeroize_u32s(&mut self.limbs);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_biguint_add_sub() {
        let a = BigUint::from_u32(123456789);
        let b = BigUint::from_u32(987654321);
        let c = a.add(&b);
        assert_eq!(c.to_bytes_be(), (123456789u64 + 987654321u64).to_be_bytes()[0..8].iter().copied().skip_while(|&x| x == 0).collect::<Vec<_>>());

        let d = c.sub(&a);
        assert_eq!(d.cmp(&b), Ordering::Equal);
    }

    #[test]
    fn test_biguint_mul_div() {
        let a = BigUint::from_bytes_be(&[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]);
        let b = BigUint::from_bytes_be(&[0xfe, 0xdc, 0xba, 0x98, 0x76]);
        let prod = a.mul(&b);

        let (q, r) = prod.div_rem(&b);
        assert_eq!(q.cmp(&a), Ordering::Equal);
        assert!(r.is_zero());
    }

    #[test]
    fn test_biguint_mod_pow() {
        let base = BigUint::from_u32(7);
        let exp = BigUint::from_u32(13);
        let modulus = BigUint::from_u32(100);

        // 7^13 mod 100 = 7^13 = 96889010407 => mod 100 = 7
        let res = base.mod_pow(&exp, &modulus);
        assert_eq!(res.to_bytes_be(), alloc::vec![7]);
    }
}
