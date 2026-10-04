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

/**
 * Offline checksum validation of wallet addresses (#1158, #1159). A typo in an address sends
 * money nowhere, so a code that carries one is worth a warning before it is printed or paid.
 * Pure and synchronous: SHA-256 and Keccak-256 are implemented here because the Web Crypto
 * API is asynchronous and has no Keccak.
 */

export type AddressCheck =
  /** The checksum matched. */
  | 'valid'
  /** The address is malformed or its checksum does not match. */
  | 'invalid'
  /** The format has no checksum to check (an all-lower-case Ethereum address, a Solana key). */
  | 'unchecked';

import { sha256 } from '@/utils/sha256';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BECH32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

const MASK64 = (1n << 64n) - 1n;
const KECCAK_ROUNDS: readonly bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const KECCAK_ROTATIONS: readonly number[] = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const KECCAK_LANES: readonly number[] = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const rotl64 = (value: bigint, bits: number): bigint => ((value << BigInt(bits)) | (value >> BigInt(64 - bits))) & MASK64;

function keccakF(lanes: bigint[]): void {
  for (const roundConstant of KECCAK_ROUNDS) {
    const parity = Array.from({ length: 5 }, (_, x) => lanes[x] ^ lanes[x + 5] ^ lanes[x + 10] ^ lanes[x + 15] ^ lanes[x + 20]);
    for (let x = 0; x < 5; x++) {
      const delta = parity[(x + 4) % 5] ^ rotl64(parity[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) lanes[y + x] ^= delta;
    }
    let carry = lanes[1];
    for (let i = 0; i < 24; i++) {
      const lane = KECCAK_LANES[i];
      const next = lanes[lane];
      lanes[lane] = rotl64(carry, KECCAK_ROTATIONS[i]);
      carry = next;
    }
    for (let y = 0; y < 25; y += 5) {
      const row = lanes.slice(y, y + 5);
      for (let x = 0; x < 5; x++) lanes[y + x] = row[x] ^ (~row[(x + 1) % 5] & MASK64 & row[(x + 2) % 5]);
    }
    lanes[0] ^= roundConstant;
  }
}

/**
 * Keccak-256 (the original padding, as Ethereum uses, not NIST SHA3-256).
 * @param message - The bytes to hash.
 * @returns The 32-byte digest.
 */
export function keccak256(message: Uint8Array): Uint8Array {
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((message.length + 1) / rate) * rate);
  padded.set(message);
  padded[message.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  const lanes: bigint[] = new Array<bigint>(25).fill(0n);
  const view = new DataView(padded.buffer);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) lanes[i] ^= view.getBigUint64(offset + i * 8, true);
    keccakF(lanes);
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) outView.setBigUint64(i * 8, lanes[i], true);
  return out;
}

/** Decodes Base58 to bytes, or null when a character is outside the alphabet. */
function base58Decode(text: string): Uint8Array | null {
  let value = 0n;
  for (const char of text) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn));
    value >>= 8n;
  }
  const zeros = text.length - text.replace(/^1+/, '').length;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

/** Version byte of a valid Base58Check string, or null when the length or checksum is wrong. */
function base58CheckVersion(text: string): number | null {
  const bytes = base58Decode(text);
  if (!bytes || bytes.length !== 25) return null;
  const payload = bytes.subarray(0, 21);
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return checksum.every((byte, i) => byte === bytes[21 + i]) ? bytes[0] : null;
}

function bech32Polymod(values: readonly number[]): number {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let check = 1;
  for (const value of values) {
    const top = check >>> 25;
    check = ((check & 0x1ffffff) << 5) ^ value;
    generators.forEach((generator, i) => {
      if ((top >>> i) & 1) check ^= generator;
    });
  }
  return check >>> 0;
}

/** Checks a SegWit address: bech32 for witness version 0, bech32m for later versions. */
function checkSegwit(address: string, hrp: string): boolean {
  if (address !== address.toLowerCase() && address !== address.toUpperCase()) return false;
  const text = address.toLowerCase();
  const separator = text.lastIndexOf('1');
  if (separator < 1 || text.slice(0, separator) !== hrp || text.length - separator - 1 < 7 || text.length > 90) return false;
  const data = [...text.slice(separator + 1)].map((char) => BECH32.indexOf(char));
  if (data.includes(-1)) return false;
  const hrpValues = [...[...hrp].map((char) => char.charCodeAt(0) >> 5), 0, ...[...hrp].map((char) => char.charCodeAt(0) & 31)];
  const polymod = bech32Polymod([...hrpValues, ...data]);
  const version = data[0];
  return polymod === (version === 0 ? BECH32_CONST : BECH32M_CONST);
}

/** EIP-55: mixed-case addresses carry a Keccak-256 checksum in the capitalisation. */
function checkEthereum(address: string): AddressCheck {
  const match = /^0x([0-9a-fA-F]{40})$/.exec(address);
  if (!match) return 'invalid';
  const hex = match[1];
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return 'unchecked';
  const hash = keccak256(new TextEncoder().encode(hex.toLowerCase()));
  const hashHex = [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const matches = [...hex].every((char, i) => (parseInt(hashHex[i], 16) >= 8 ? char === char.toUpperCase() : char === char.toLowerCase()));
  return matches ? 'valid' : 'invalid';
}

/**
 * Checks a wallet address's checksum.
 * @param network - `bitcoin`, `ethereum`, `litecoin` or `solana`; any other network is `unchecked`.
 * @param address - The address as entered or scanned.
 * @returns Whether it is valid, invalid, or has no checksum to check.
 */
export function checkCryptoAddress(network: string, address: string): AddressCheck {
  const value = address.trim();
  switch (network) {
    case 'bitcoin': {
      const version = base58CheckVersion(value);
      if (version !== null) return version === 0x00 || version === 0x05 ? 'valid' : 'invalid';
      return checkSegwit(value, 'bc') ? 'valid' : 'invalid';
    }
    case 'litecoin': {
      const version = base58CheckVersion(value);
      if (version !== null) return version === 0x30 || version === 0x32 || version === 0x05 ? 'valid' : 'invalid';
      return checkSegwit(value, 'ltc') ? 'valid' : 'invalid';
    }
    case 'ethereum':
      return checkEthereum(value);
    case 'solana': {
      const bytes = value.length >= 32 && value.length <= 44 ? base58Decode(value) : null;
      return bytes?.length === 32 ? 'unchecked' : 'invalid';
    }
    default:
      return 'unchecked';
  }
}
