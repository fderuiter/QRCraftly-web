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

import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes, sha256, sha256Digest, sha256Hex } from '../encoding';

const text = (s: string) => new TextEncoder().encode(s);

// FIPS 180-4 test vectors.
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const TWO_BLOCKS = '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1';

describe('sha256 (synchronous)', () => {
  it.each([
    ['', EMPTY],
    ['abc', ABC],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', TWO_BLOCKS],
  ])('hashes %j to the FIPS 180-4 digest', (input, expected) => {
    expect(bytesToHex(sha256(text(input)))).toBe(expected);
  });
});

describe('sha256Hex and sha256Digest (Web Crypto)', () => {
  it('hashes the empty input and "abc"', async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(EMPTY);
    expect(await sha256Hex(text('abc'))).toBe(ABC);
  });

  it('agrees with the synchronous sha256 on a 1 MB buffer', async () => {
    const big = new Uint8Array(1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
    const expected = bytesToHex(sha256(big));
    expect(await sha256Hex(big)).toBe(expected);
    expect(bytesToHex(await sha256Digest(big))).toBe(expected);
  });

  it('hashes only the view, not the whole underlying buffer', async () => {
    const backing = text('xxabcxx');
    expect(await sha256Hex(backing.subarray(2, 5))).toBe(ABC);
  });
});

describe('hex helpers', () => {
  it('round-trips bytes through lowercase hex', () => {
    const bytes = new Uint8Array([0, 1, 0x7f, 0x80, 0xff]);
    expect(bytesToHex(bytes)).toBe('00017f80ff');
    expect(hexToBytes('00017F80ff')).toEqual(bytes);
  });

  it('decodes odd-length or non-hex input to no bytes', () => {
    expect(hexToBytes('abc')).toEqual(new Uint8Array());
    expect(hexToBytes('zz')).toEqual(new Uint8Array());
  });
});
