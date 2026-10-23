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

const BECH32_ALPHABET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST: u32 = 1;
const BECH32M_CONST: u32 = 0x2bc830a3;

fn bech32_polymod(values: &[u8]) -> u32 {
    let generators: [u32; 5] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
    let mut check: u32 = 1;
    for &v in values {
        let top = check >> 25;
        check = ((check & 0x01ff_ffff) << 5) ^ (v as u32);
        for (i, &gen) in generators.iter().enumerate() {
            if ((top >> i) & 1) != 0 {
                check ^= gen;
            }
        }
    }
    check
}

/// Checks a SegWit address: Bech32 for witness version 0, Bech32m for later versions.
pub fn check_segwit(address: &str, hrp: &str) -> bool {
    let bytes = address.as_bytes();
    let mut has_lower = false;
    let mut has_upper = false;
    for &b in bytes {
        if b.is_ascii_lowercase() {
            has_lower = true;
        } else if b.is_ascii_uppercase() {
            has_upper = true;
        }
    }
    if has_lower && has_upper {
        return false;
    }

    let mut separator = None;
    for (i, &b) in bytes.iter().enumerate().rev() {
        if b == b'1' {
            separator = Some(i);
            break;
        }
    }

    let sep = match separator {
        Some(s) if s >= 1 => s,
        _ => return false,
    };

    if address.len() > 90 || address.len() - sep - 1 < 7 {
        return false;
    }

    let addr_hrp = &address[..sep];
    if !addr_hrp.eq_ignore_ascii_case(hrp) {
        return false;
    }

    let data_str = &address[sep + 1..];
    let mut data = Vec::with_capacity(data_str.len());
    for &b in data_str.as_bytes() {
        let lower = b.to_ascii_lowercase();
        let val = match BECH32_ALPHABET.iter().position(|&c| c == lower) {
            Some(idx) => idx as u8,
            None => return false,
        };
        data.push(val);
    }

    let mut combined = Vec::with_capacity(hrp.len() * 2 + 1 + data.len());
    for &b in hrp.as_bytes() {
        combined.push(b.to_ascii_lowercase() >> 5);
    }
    combined.push(0);
    for &b in hrp.as_bytes() {
        combined.push(b.to_ascii_lowercase() & 31);
    }
    combined.extend_from_slice(&data);

    let polymod = bech32_polymod(&combined);
    let version = data[0];
    let expected = if version == 0 {
        BECH32_CONST
    } else {
        BECH32M_CONST
    };
    polymod == expected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_check_segwit_valid() {
        assert!(check_segwit(
            "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
            "bc"
        ));
        assert!(check_segwit(
            "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
            "bc"
        ));
        assert!(check_segwit(
            "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
            "bc"
        ));
    }

    #[test]
    fn test_check_segwit_invalid() {
        assert!(!check_segwit(
            "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5",
            "bc"
        ));
        assert!(!check_segwit(
            "Bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
            "bc"
        ));
    }
}
