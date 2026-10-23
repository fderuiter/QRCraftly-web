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

use crate::base58::{base58_check_version, base58_decode};
use crate::bech32::check_segwit;
use crate::keccak256::keccak256;

pub const ADDRESS_VALID: i32 = 0;
pub const ADDRESS_INVALID: i32 = 1;
pub const ADDRESS_UNCHECKED: i32 = 2;

fn check_ethereum(value: &str) -> i32 {
    let bytes = value.as_bytes();
    if bytes.len() != 42 || bytes[0] != b'0' || (bytes[1] != b'x' && bytes[1] != b'X') {
        return ADDRESS_INVALID;
    }
    let hex_bytes = &bytes[2..];
    let mut has_lower = false;
    let mut has_upper = false;
    for &b in hex_bytes {
        if !b.is_ascii_hexdigit() {
            return ADDRESS_INVALID;
        }
        if b.is_ascii_lowercase() {
            has_lower = true;
        } else if b.is_ascii_uppercase() {
            has_upper = true;
        }
    }

    if !has_lower || !has_upper {
        return ADDRESS_UNCHECKED;
    }

    let mut hex_lower = [0u8; 40];
    for (i, &b) in hex_bytes.iter().enumerate() {
        hex_lower[i] = b.to_ascii_lowercase();
    }

    let hash = keccak256(&hex_lower);
    for i in 0..40 {
        let nibble = if i % 2 == 0 {
            hash[i / 2] >> 4
        } else {
            hash[i / 2] & 0x0f
        };
        let b = hex_bytes[i];
        if nibble >= 8 {
            if b.is_ascii_alphabetic() && !b.is_ascii_uppercase() {
                return ADDRESS_INVALID;
            }
        } else if b.is_ascii_alphabetic() && !b.is_ascii_lowercase() {
            return ADDRESS_INVALID;
        }
    }

    ADDRESS_VALID
}

/// Validates a cryptocurrency address for a given network name.
/// Returns 0 for valid, 1 for invalid, 2 for unchecked.
pub fn validate_address(network: &str, address: &str) -> i32 {
    let value = address.trim();
    match network {
        "bitcoin" => {
            if let Some(version) = base58_check_version(value) {
                if version == 0x00 || version == 0x05 {
                    ADDRESS_VALID
                } else {
                    ADDRESS_INVALID
                }
            } else if check_segwit(value, "bc") {
                ADDRESS_VALID
            } else {
                ADDRESS_INVALID
            }
        }
        "litecoin" => {
            if let Some(version) = base58_check_version(value) {
                if version == 0x30 || version == 0x32 || version == 0x05 {
                    ADDRESS_VALID
                } else {
                    ADDRESS_INVALID
                }
            } else if check_segwit(value, "ltc") {
                ADDRESS_VALID
            } else {
                ADDRESS_INVALID
            }
        }
        "ethereum" => check_ethereum(value),
        "solana" => {
            if value.len() >= 32 && value.len() <= 44 {
                if let Some(bytes) = base58_decode(value) {
                    if bytes.len() == 32 {
                        ADDRESS_UNCHECKED
                    } else {
                        ADDRESS_INVALID
                    }
                } else {
                    ADDRESS_INVALID
                }
            } else {
                ADDRESS_INVALID
            }
        }
        _ => ADDRESS_UNCHECKED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bitcoin_addresses() {
        assert_eq!(validate_address("bitcoin", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"), ADDRESS_VALID);
        assert_eq!(validate_address("bitcoin", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3"), ADDRESS_INVALID);
        assert_eq!(validate_address("bitcoin", "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"), ADDRESS_VALID);
    }

    #[test]
    fn test_ethereum_addresses() {
        assert_eq!(validate_address("ethereum", "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), ADDRESS_VALID);
        assert_eq!(validate_address("ethereum", "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"), ADDRESS_UNCHECKED);
        assert_eq!(validate_address("ethereum", "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"), ADDRESS_INVALID);
    }
}
