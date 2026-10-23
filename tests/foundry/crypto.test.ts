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
import {
  checkCryptoAddressJS,
  keccak256JS,
} from '@/packages/qr-payload/lib/cryptoAddress';
import {
  keccak256Wasm,
  loadCryptoWasm,
  sha256Wasm,
  validateAddressWasm,
} from '@/utils/cryptoWasm';
import { sha256JS } from '@/utils/sha256';
import { loadCommittedModule, runDifferential, seededBytes } from './differential';

const ADDRESS_TEST_CASES: [string, string][] = [
  // Bitcoin
  ['bitcoin', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
  ['bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
  ['bitcoin', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'],
  ['bitcoin', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3'],
  ['bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb'],
  ['bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
  ['bitcoin', 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4'],
  ['bitcoin', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'],
  ['bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5'],
  ['bitcoin', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj1'],
  ['bitcoin', 'Bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
  ['bitcoin', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'],
  ['bitcoin', 'not an address'],
  ['bitcoin', ''],
  // Litecoin
  ['litecoin', 'LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9'],
  ['litecoin', 'LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH8'],
  ['litecoin', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2'],
  // Ethereum
  ['ethereum', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'],
  ['ethereum', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359'],
  ['ethereum', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB'],
  ['ethereum', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb'],
  ['ethereum', '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'],
  ['ethereum', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'],
  ['ethereum', '0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED'],
  ['ethereum', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe'],
  ['ethereum', '5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'],
  // Solana
  ['solana', '11111111111111111111111111111111'],
  ['solana', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'],
  ['solana', '0WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'],
  ['solana', 'short'],
  ['custom', 'anything'],
];

describe('Foundry crypto differential harness (#1182)', () => {
  it('loads committed crypto.wasm module', async () => {
    const module = await loadCommittedModule('crypto');
    expect(module).toBeDefined();
  });

  it('loads crypto WASM module via loadCryptoWasm', async () => {
    const instance = await loadCryptoWasm();
    expect(instance).toBeDefined();
    expect(typeof instance.fn('crypto_sha256')).toBe('function');
  });

  it('matches WASM SHA-256 against pure JavaScript reference', async () => {
    await loadCryptoWasm();
    const report = runDifferential({
      name: 'sha256',
      inputs: seededBytes(42, 100, 1024),
      candidate: (bytes) => sha256Wasm(bytes),
      reference: (bytes) => sha256JS(bytes),
    });
    expect(report).toMatchObject({ checked: 100, mismatchCount: 0 });
  });

  it('matches WASM Keccak-256 against pure JavaScript reference', async () => {
    await loadCryptoWasm();
    const report = runDifferential({
      name: 'keccak256',
      inputs: seededBytes(123, 100, 1024),
      candidate: (bytes) => keccak256Wasm(bytes),
      reference: (bytes) => keccak256JS(bytes),
    });
    expect(report).toMatchObject({ checked: 100, mismatchCount: 0 });
  });

  it('matches WASM address validation against pure JavaScript reference', async () => {
    await loadCryptoWasm();
    const report = runDifferential({
      name: 'validate_address',
      inputs: ADDRESS_TEST_CASES,
      candidate: ([network, address]) => validateAddressWasm(network, address),
      reference: ([network, address]) => checkCryptoAddressJS(network, address),
    });
    expect(report).toMatchObject({ checked: ADDRESS_TEST_CASES.length, mismatchCount: 0 });
  });
});
