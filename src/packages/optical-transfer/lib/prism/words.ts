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
 * Pronounceable four-letter words (consonant, vowel, consonant, vowel) for things a person reads
 * aloud or compares by eye: the key code of a private transfer and the fingerprint of a session.
 * The list is built, not stored: 4,096 words, so each word is exactly 12 bits.
 */

const CONSONANTS = 'bcdfghjklmnprstvwz';
const VOWELS = 'aeio';
/** CVCV words that read as something unwelcome. They are skipped, and the next candidates fill their places. */
const BLOCKED = new Set(['homo', 'nazi', 'pedo', 'kike', 'paki', 'coon', 'rape', 'puta', 'puto', 'cole', 'cece']);
export const WORD_BITS = 12;
const WORD_COUNT = 1 << WORD_BITS;

const WORDS: readonly string[] = (() => {
  const words: string[] = [];
  for (const c1 of CONSONANTS) {
    for (const v1 of VOWELS) {
      for (const c2 of CONSONANTS) {
        for (const v2 of VOWELS) {
          const word = c1 + v1 + c2 + v2;
          if (!BLOCKED.has(word)) words.push(word);
        }
      }
    }
  }
  return words.slice(0, WORD_COUNT);
})();

const INDEX = new Map(WORDS.map((word, index) => [word, index]));

/** Words of a private transfer's key code. Eight words are 96 bits. */
export const KEY_CODE_WORDS = 8;
/** Bytes of secret a key code carries. */
export const KEY_SECRET_BYTES = (KEY_CODE_WORDS * WORD_BITS) / 8;
/** Words of a session fingerprint. Four words are 48 bits, the whole session ID. */
export const FINGERPRINT_WORDS = 4;

/**
 * Writes bytes as words, 12 bits per word, most significant bits first.
 * @param bytes - The bytes. Their bit length must be a multiple of 12.
 * @returns One word per 12 bits.
 */
export function bytesToWords(bytes: Uint8Array): string[] {
  const count = (bytes.length * 8) / WORD_BITS;
  if (!Number.isInteger(count)) throw new RangeError('The bytes must fill a whole number of words.');
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const bit = i * WORD_BITS;
    const byte = bit >> 3;
    // A word starts on a byte boundary (even index) or a half byte (odd index).
    const value = bit % 8 === 0 ? (bytes[byte] << 4) | (bytes[byte + 1] >> 4) : ((bytes[byte] & 0x0f) << 8) | bytes[byte + 1];
    words.push(WORDS[value]);
  }
  return words;
}

/**
 * Reads words written by {@link bytesToWords}.
 * @param words - The words.
 * @returns The bytes, or null when a word is not on the list or the count is not a whole number of bytes.
 */
export function wordsToBytes(words: readonly string[]): Uint8Array | null {
  if ((words.length * WORD_BITS) % 8 !== 0) return null;
  const bytes = new Uint8Array((words.length * WORD_BITS) / 8);
  for (let i = 0; i < words.length; i++) {
    const value = INDEX.get(words[i]);
    if (value === undefined) return null;
    const bit = i * WORD_BITS;
    const byte = bit >> 3;
    if (bit % 8 === 0) {
      bytes[byte] = value >> 4;
      bytes[byte + 1] |= (value & 0x0f) << 4;
    } else {
      bytes[byte] |= value >> 8;
      bytes[byte + 1] = value & 0xff;
    }
  }
  return bytes;
}

/**
 * The four words a sender and a receiver compare to see they are on the same transfer.
 * @param sessionId - The 6-byte session ID.
 * @returns The words joined by spaces, e.g. `bafe lomu kiza tose`.
 */
export function fingerprintWords(sessionId: Uint8Array): string {
  return bytesToWords(sessionId.subarray(0, (FINGERPRINT_WORDS * WORD_BITS) / 8)).join(' ');
}

/**
 * Writes a key secret as the words a person reads out or types.
 * @param secret - {@link KEY_SECRET_BYTES} random bytes.
 * @returns The words joined by hyphens.
 */
export function formatKeyCode(secret: Uint8Array): string {
  return bytesToWords(secret).join('-');
}

/**
 * Reads a key code typed or read aloud: any case, spaces, hyphens, commas or line breaks between words.
 * @param text - What the person entered.
 * @returns The secret, or null when it is not a valid key code.
 */
export function parseKeyCode(text: string): Uint8Array | null {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length !== KEY_CODE_WORDS) return null;
  return wordsToBytes(words);
}

/** Text of the key QR a sender shows while its button is held. It is not a transfer frame. */
const KEY_QR_PREFIX = 'QRKEY:';

/**
 * The text of a key QR.
 * @param secret - The key secret.
 * @returns Upper-case text, which a QR code stores compactly.
 */
export function keyQrText(secret: Uint8Array): string {
  return `${KEY_QR_PREFIX}${formatKeyCode(secret).toUpperCase()}`;
}

/**
 * Reads the text of a key QR.
 * @param text - Text a camera read.
 * @returns The secret, or null when the text is not a key QR.
 */
export function parseKeyQr(text: string): Uint8Array | null {
  return text.startsWith(KEY_QR_PREFIX) ? parseKeyCode(text.slice(KEY_QR_PREFIX.length)) : null;
}

/**
 * Cheap test for the text of a key QR, for code that must not build the word list.
 * @param text - Text a camera read.
 * @returns True when the text starts like a key QR.
 */
export function looksLikeKeyQr(text: string): boolean {
  return text.startsWith(KEY_QR_PREFIX);
}
