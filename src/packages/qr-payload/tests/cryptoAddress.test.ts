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
import { checkCryptoAddress } from '../index';

describe('checkCryptoAddress', () => {
  it.each([
    // Base58Check (BIP13 and the well-known genesis address)
    ['bitcoin', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'valid'],
    ['bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'valid'],
    ['bitcoin', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'valid'],
    ['bitcoin', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3', 'invalid'],
    ['bitcoin', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb', 'invalid'],
    // bech32 and bech32m (BIP173, BIP350)
    ['bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'valid'],
    ['bitcoin', 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4', 'valid'],
    ['bitcoin', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'valid'],
    ['bitcoin', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5', 'invalid'],
    ['bitcoin', 'bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj1', 'invalid'],
    ['bitcoin', 'Bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'invalid'],
    ['bitcoin', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx', 'invalid'],
    ['bitcoin', 'not an address', 'invalid'],
    ['bitcoin', '', 'invalid'],
    // Litecoin
    ['litecoin', 'LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH9', 'valid'],
    ['litecoin', 'LVg2kJoFNg45Nbpy53h7Fe1wKyeXVRhMH8', 'invalid'],
    ['litecoin', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'invalid'],
    // EIP-55 vectors
    ['ethereum', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'valid'],
    ['ethereum', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', 'valid'],
    ['ethereum', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', 'valid'],
    ['ethereum', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb', 'valid'],
    ['ethereum', '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'invalid'],
    ['ethereum', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', 'unchecked'],
    ['ethereum', '0x5AAEB6053F3E94C9B9A09F33669435E7EF1BEAED', 'unchecked'],
    ['ethereum', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAe', 'invalid'],
    ['ethereum', '5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'invalid'],
    // Solana has no checksum: only the shape can be checked
    ['solana', '11111111111111111111111111111111', 'unchecked'],
    ['solana', '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'unchecked'],
    ['solana', '0WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'invalid'],
    ['solana', 'short', 'invalid'],
    ['custom', 'anything', 'unchecked'],
  ])('%s %s -> %s', (network, address, expected) => {
    expect(checkCryptoAddress(network, address)).toBe(expected);
  });
});
