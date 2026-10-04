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

//! CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320), the same checksum
//! zip, PNG and the transfer frames use.

const fn build_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut n = 0;
    while n < 256 {
        let mut c = n as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 {
                0xEDB8_8320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        table[n] = c;
        n += 1;
    }
    table
}

static TABLE: [u32; 256] = build_table();

/// Continues a running CRC. Start with 0; pass the previous result to continue.
pub fn update(crc: u32, bytes: &[u8]) -> u32 {
    let mut c = !crc;
    for &byte in bytes {
        c = TABLE[((c ^ byte as u32) & 0xff) as usize] ^ (c >> 8);
    }
    !c
}

/// CRC-32 of `bytes`.
pub fn checksum(bytes: &[u8]) -> u32 {
    update(0, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_value() {
        // The standard CRC-32 check value.
        assert_eq!(checksum(b"123456789"), 0xCBF4_3926);
        assert_eq!(checksum(b""), 0);
    }

    #[test]
    fn update_continues_across_chunks() {
        let whole = checksum(b"The quick brown fox jumps over the lazy dog");
        assert_eq!(whole, 0x414F_A339);
        let split = update(
            checksum(b"The quick brown "),
            b"fox jumps over the lazy dog",
        );
        assert_eq!(split, whole);
    }
}
