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

use crate::sha256::sha256;
use alloc::vec::Vec;

const BASE58_ALPHABET: &[u8; 58] = b"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/// Decodes Base58 to bytes, or `None` if a character is outside the alphabet or overflows.
pub fn base58_decode(text: &str) -> Option<Vec<u8>> {
    let bytes_input = text.as_bytes();
    let mut leading_ones = 0;
    while leading_ones < bytes_input.len() && bytes_input[leading_ones] == b'1' {
        leading_ones += 1;
    }

    let mut buf = [0u8; 64];
    let mut buf_len = 0;

    for &b in &bytes_input[leading_ones..] {
        let digit = BASE58_ALPHABET.iter().position(|&c| c == b)?;
        let mut carry = digit as u32;
        for i in 0..buf_len {
            let val = (buf[64 - 1 - i] as u32) * 58 + carry;
            buf[64 - 1 - i] = (val & 0xff) as u8;
            carry = val >> 8;
        }
        while carry > 0 {
            if buf_len >= 64 {
                return None;
            }
            buf[64 - 1 - buf_len] = (carry & 0xff) as u8;
            carry >>= 8;
            buf_len += 1;
        }
    }

    let mut out = Vec::with_capacity(leading_ones + buf_len);
    out.resize(leading_ones, 0u8);
    out.extend_from_slice(&buf[64 - buf_len..64]);
    Some(out)
}

/// Version byte of a valid 25-byte Base58Check string, or `None` if length or checksum fails.
pub fn base58_check_version(text: &str) -> Option<u8> {
    let bytes = base58_decode(text)?;
    if bytes.len() != 25 {
        return None;
    }
    let payload = &bytes[0..21];
    let expected_checksum = &bytes[21..25];
    let hash1 = sha256(payload);
    let hash2 = sha256(&hash1);
    if &hash2[0..4] == expected_checksum {
        Some(bytes[0])
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base58_decode_genesis() {
        let text = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
        let ver = base58_check_version(text);
        assert_eq!(ver, Some(0x00));
    }

    #[test]
    fn test_base58_decode_invalid_checksum() {
        let text = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb";
        let ver = base58_check_version(text);
        assert_eq!(ver, None);
    }
}
