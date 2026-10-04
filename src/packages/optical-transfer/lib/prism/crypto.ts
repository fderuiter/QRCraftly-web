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


import { sha256 } from '@/utils/sha256';
import { SESSION_ID_BYTES } from './frame';
import { KEY_SECRET_BYTES } from './words';

/** Manifest `encryption` value of a private transfer: AES-256-GCM under a key derived from the key code. */
export const ENCRYPTION_AES_GCM = 1;
/** Bytes of random salt a private manifest carries. */
export const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HASH_BLOCK_BYTES = 64;
const encoder = new TextEncoder();

/**
 * The two keys a key code expands to: one encrypts the message, one signs the session ID. They stay
 * in the memory of the page or worker that derived them.
 */
export interface PrivateKeys {
  encryptKey: Uint8Array;
  macKey: Uint8Array;
}

/**
 * Draws a new random key code secret.
 * @returns random bytes.
 */
export function generateSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_SECRET_BYTES));
}

/**
 * Draws a new random salt for a private manifest.
 * @returns random bytes.
 */
export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * HMAC-SHA-256 (RFC 2104). Written over the synchronous SHA-256 so a receiver can check a session
 * ID inside its synchronous frame parser; the tests compare it with Web Crypto.
 * @param key - The key.
 * @param message - The message.
 * @returns The 32-byte tag.
 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(HASH_BLOCK_BYTES);
  block.set(key.length > HASH_BLOCK_BYTES ? sha256(key) : key);
  const inner = block.map((byte) => byte ^ 0x36);
  const outer = block.map((byte) => byte ^ 0x5c);
  return sha256(concat(outer, sha256(concat(inner, message))));
}

/**
 * HKDF-SHA-256 (RFC 5869) for output up to one hash length.
 * @param secret - Input key material.
 * @param salt - Salt.
 * @param info - Context label.
 * @returns 32 bytes.
 */
export function hkdfSha256(secret: Uint8Array, salt: Uint8Array, info: Uint8Array): Uint8Array {
  const pseudoRandomKey = hmacSha256(salt, secret);
  return hmacSha256(pseudoRandomKey, concat(info, new Uint8Array([1])));
}

/**
 * Expands a key code secret and the manifest's salt into the transfer's keys.
 * @param secret - The bytes the key code stands for.
 * @param salt - The salt from the manifest.
 * @returns The encryption key and the session-ID key.
 */
export function deriveKeys(secret: Uint8Array, salt: Uint8Array): PrivateKeys {
  return {
    encryptKey: hkdfSha256(secret, salt, encoder.encode('qrcraftly prism v1 aes-256-gcm')),
    macKey: hkdfSha256(secret, salt, encoder.encode('qrcraftly prism v1 session-id')),
  };
}

/**
 * The session ID of a private transfer: the first bytes of an HMAC-SHA-256 of the manifest. Only
 * someone with the key can compute it, so frames from anyone else fail at the header.
 * @param keys - The transfer's keys.
 * @param manifestBytes - The encoded manifest.
 * @returns The session ID bytes.
 */
export function privateSessionId(keys: PrivateKeys, manifestBytes: Uint8Array): Uint8Array {
  return hmacSha256(keys.macKey, manifestBytes).subarray(0, SESSION_ID_BYTES);
}

/** The nonce of a block: its number, big endian. Each transfer has its own key, so a nonce is never reused. */
function nonceOf(blockNumber: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  new DataView(nonce.buffer).setUint32(NONCE_BYTES - 4, blockNumber);
  return nonce;
}

const ASSOCIATED_DATA = encoder.encode('qrcraftly prism v1');

function importAesKey(keys: PrivateKeys, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', keys.encryptKey, 'AES-GCM', false, [usage]);
}

/**
 * Encrypts a message and authenticates it.
 * @param keys - The transfer's keys.
 * @param plaintext - The message.
 * @param blockNumber - Which block of the transfer this is.
 * @returns The ciphertext followed by its 16-byte tag.
 */
export async function encryptBlock(keys: PrivateKeys, plaintext: Uint8Array, blockNumber = 0): Promise<Uint8Array> {
  const key = await importAesKey(keys, 'encrypt');
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceOf(blockNumber), additionalData: ASSOCIATED_DATA }, key, plaintext);
  return new Uint8Array(sealed);
}

/**
 * Decrypts and verifies a message.
 * @param keys - The transfer's keys.
 * @param sealed - The ciphertext with its tag.
 * @param blockNumber - Which block of the transfer this is.
 * @returns The message.
 * @throws Error when the key is wrong or the message was changed.
 */
export async function decryptBlock(keys: PrivateKeys, sealed: Uint8Array, blockNumber = 0): Promise<Uint8Array> {
  if (sealed.length < TAG_BYTES) throw new Error('This private transfer is damaged.');
  try {
    const key = await importAesKey(keys, 'decrypt');
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonceOf(blockNumber), additionalData: ASSOCIATED_DATA }, key, sealed);
    return new Uint8Array(opened);
  } catch {
    throw new Error('This private transfer did not open: the key code is wrong or the transfer was changed.');
  }
}

/** Bytes a sealed block adds to its message. */
export const ENCRYPTION_OVERHEAD = TAG_BYTES;
