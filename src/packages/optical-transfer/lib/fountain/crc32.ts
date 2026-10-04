/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

/**
 * CRC-32 (ISO-HDLC / IEEE 802.3, reflected polynomial 0xEDB88320) as used by
 * BC-UR (BCR-2020-005) for message checksums and by Bytewords (BCR-2020-012)
 * for the trailing 4-byte integrity check; and CRC-32C (Castagnoli) for Prism frames. Both are
 * table-driven and share one loop.
 */
function buildTable(polynomial: number): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? polynomial ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

function checksum(table: Uint32Array, bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = buildTable(0xedb88320);
const CRC32C_TABLE = buildTable(0x82f63b78);

/**
 * Computes the CRC-32 of a byte array as an unsigned 32-bit integer.
 * @param bytes Input bytes.
 * @returns The unsigned CRC-32 value.
 */
export function crc32(bytes: Uint8Array): number {
  return checksum(CRC32_TABLE, bytes);
}

/**
 * Computes the CRC-32C (Castagnoli, reflected polynomial 0x82F63B78) of a byte array, the checksum
 * that closes every Prism frame. Its error detection is stronger than CRC-32's for short messages.
 * @param bytes Input bytes.
 * @returns The unsigned CRC-32C value.
 */
export function crc32c(bytes: Uint8Array): number {
  return checksum(CRC32C_TABLE, bytes);
}

/**
 * Computes the CRC-32 of a byte array as an 8-character lowercase hex string.
 * @param bytes Input bytes.
 * @returns The zero-padded hex checksum.
 */
export function crc32Hex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(8, '0');
}
