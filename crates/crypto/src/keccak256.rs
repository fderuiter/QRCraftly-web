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

use alloc::vec::Vec;

const KECCAK_ROUNDS: [u64; 24] = [
    0x0000000000000001, 0x0000000000008082, 0x800000000000808a, 0x8000000080008000,
    0x000000000000808b, 0x0000000080000001, 0x8000000080008081, 0x8000000000008009,
    0x000000000000008a, 0x0000000000000088, 0x0000000080008009, 0x000000008000000a,
    0x000000008000808b, 0x800000000000008b, 0x8000000000008089, 0x8000000000008003,
    0x8000000000008002, 0x8000000000000080, 0x000000000000800a, 0x800000008000000a,
    0x8000000080008081, 0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
];

const KECCAK_ROTATIONS: [u32; 24] = [
    1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const KECCAK_LANES: [usize; 24] = [
    10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

#[inline]
fn rotl64(x: u64, n: u32) -> u64 {
    x.rotate_left(n)
}

fn keccak_f(lanes: &mut [u64; 25]) {
    for &rc in &KECCAK_ROUNDS {
        let mut parity = [0u64; 5];
        for x in 0..5 {
            parity[x] = lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20];
        }

        for x in 0..5 {
            let delta = parity[(x + 4) % 5] ^ rotl64(parity[(x + 1) % 5], 1);
            for y in (0..25).step_by(5) {
                lanes[y + x] ^= delta;
            }
        }

        let mut carry = lanes[1];
        for i in 0..24 {
            let lane = KECCAK_LANES[i];
            let next = lanes[lane];
            lanes[lane] = rotl64(carry, KECCAK_ROTATIONS[i]);
            carry = next;
        }

        for y in (0..25).step_by(5) {
            let row = [
                lanes[y],
                lanes[y + 1],
                lanes[y + 2],
                lanes[y + 3],
                lanes[y + 4],
            ];
            for x in 0..5 {
                lanes[y + x] = row[x] ^ ((!row[(x + 1) % 5]) & row[(x + 2) % 5]);
            }
        }

        lanes[0] ^= rc;
    }
}

/// Computes the 32-byte Ethereum Keccak-256 digest of `message`.
pub fn keccak256(message: &[u8]) -> [u8; 32] {
    const RATE: usize = 136;
    let mut padded = Vec::with_capacity(((message.len() + 1 + RATE - 1) / RATE) * RATE);
    padded.extend_from_slice(message);
    padded.push(0x01);
    while padded.len() % RATE != 0 {
        padded.push(0x00);
    }
    let last = padded.len() - 1;
    padded[last] |= 0x80;

    let mut lanes = [0u64; 25];
    for chunk in padded.chunks_exact(RATE) {
        for i in 0..(RATE / 8) {
            let word = u64::from_le_bytes([
                chunk[i * 8],
                chunk[i * 8 + 1],
                chunk[i * 8 + 2],
                chunk[i * 8 + 3],
                chunk[i * 8 + 4],
                chunk[i * 8 + 5],
                chunk[i * 8 + 6],
                chunk[i * 8 + 7],
            ]);
            lanes[i] ^= word;
        }
        keccak_f(&mut lanes);
    }

    let mut out = [0u8; 32];
    for i in 0..4 {
        out[i * 8..(i + 1) * 8].copy_from_slice(&lanes[i].to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::string::String;

    fn to_hex(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for &b in bytes {
            use core::fmt::Write;
            write!(s, "{:02x}", b).unwrap();
        }
        s
    }

    #[test]
    fn test_keccak256_empty() {
        let digest = keccak256(b"");
        assert_eq!(
            to_hex(&digest),
            "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"
        );
    }

    #[test]
    fn test_keccak256_testing() {
        let digest = keccak256(b"testing");
        assert_eq!(
            to_hex(&digest),
            "5f16f4c7f149ac4f9510d9cf8cf384038ad348b3bcdc01915f95de12df9d1b02"
        );
    }
}
