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

import { crc32c } from '../fountain/crc32';
import { bytesToHex } from '../fountain/session';
import { decodeBase45, encodeBase45, isBase45 } from './base45';

/**
 * The Prism frame: one QR code of a transfer, as bytes in Base45 text (see ADR 0023).
 *
 * | Bytes | Field |
 * | --- | --- |
 * | 1 | magic `0b1010` (high nibble) and format version (low nibble) |
 * | 1 | frame type (3 bits) and flags (5 bits) |
 * | 6 | session ID |
 * | 3 | first symbol ID |
 * | 1 | symbol count |
 * | 1 | source block number, only when the multi-block flag is set |
 * | n | the payload: symbols for a data frame, the manifest for a manifest frame |
 * | 4 | CRC-32C of everything before it |
 */

export const PRISM_VERSION = 1;
const MAGIC = 0b1010;

export const FRAME_DATA = 0;
export const FRAME_MANIFEST = 1;
/* Type 2 is reserved for the receiver-to-sender channel (webcam duplex); this version never produces it. */

export const FLAG_ENCRYPTED = 0b00001;
export const FLAG_MULTI_BLOCK = 0b00010;
/** Flags this version understands; a frame carrying another one is refused rather than misread. */
const KNOWN_FLAGS = FLAG_ENCRYPTED | FLAG_MULTI_BLOCK;

export const SESSION_ID_BYTES = 6;
/** Largest symbol ID a frame can name (24 bits). */
export const MAX_SYMBOL_ID = 0xffffff;
/** Bytes a frame spends on everything but its payload (a multi-block frame adds one). */
export const FRAME_OVERHEAD = 1 + 1 + SESSION_ID_BYTES + 3 + 1 + 4;

/** A decoded frame. The payload of a data frame is `count` equal-sized symbols, back to back. */
export type PrismFrame =
  | {
      type: 'data';
      flags: number;
      /** Session ID as 12 lowercase hex characters. */
      sessionId: string;
      blockNumber: number;
      firstSymbol: number;
      count: number;
      symbols: Uint8Array;
    }
  | { type: 'manifest'; flags: number; sessionId: string; manifest: Uint8Array };

/** Why a text is not an accepted frame. */
export type FrameRejection =
  /** Not Base45, or the first byte is not the Prism magic: some other kind of text. */
  | 'not-prism'
  | 'truncated'
  /** The CRC-32C does not match: a misread or tampered frame. */
  | 'corrupt'
  /** A newer format version: the receiver should say so. */
  | 'unsupported-version'
  | 'unsupported-type'
  | 'malformed';

export type FrameDecodeResult = { ok: true; frame: PrismFrame } | { ok: false; reason: FrameRejection; version?: number };

function build(
  type: number,
  flags: number,
  sessionId: Uint8Array,
  firstSymbol: number,
  count: number,
  blockNumber: number | undefined,
  payload: Uint8Array
): string {
  if (sessionId.length !== SESSION_ID_BYTES) throw new RangeError('A session ID is 6 bytes.');
  if (!Number.isInteger(firstSymbol) || firstSymbol < 0 || firstSymbol > MAX_SYMBOL_ID) throw new RangeError('Symbol ID out of range.');
  if (!Number.isInteger(count) || count < 0 || count > 0xff) throw new RangeError('Symbol count out of range.');
  const multiBlock = blockNumber !== undefined;
  const allFlags = multiBlock ? flags | FLAG_MULTI_BLOCK : flags & ~FLAG_MULTI_BLOCK;
  const headerLength = 12 + (multiBlock ? 1 : 0);
  const bytes = new Uint8Array(headerLength + payload.length + 4);
  bytes[0] = (MAGIC << 4) | PRISM_VERSION;
  bytes[1] = (type << 5) | (allFlags & 0b11111);
  bytes.set(sessionId, 2);
  bytes[8] = firstSymbol >>> 16;
  bytes[9] = (firstSymbol >>> 8) & 0xff;
  bytes[10] = firstSymbol & 0xff;
  bytes[11] = count;
  if (multiBlock) bytes[12] = blockNumber & 0xff;
  bytes.set(payload, headerLength);
  new DataView(bytes.buffer).setUint32(bytes.length - 4, crc32c(bytes.subarray(0, bytes.length - 4)));
  return encodeBase45(bytes);
}

/**
 * Builds a data frame.
 * @param options.sessionId - The 6-byte session ID.
 * @param options.firstSymbol - Symbol ID of the first symbol; the rest follow in order.
 * @param options.symbols - Equal-sized symbols.
 * @param options.flags - Frame flags (encrypted).
 * @param options.blockNumber - Source block number; setting it marks the frame multi-block.
 * @returns The Base45 text to put in a QR code.
 */
export function encodeDataFrame(options: {
  sessionId: Uint8Array;
  firstSymbol: number;
  symbols: Uint8Array[];
  flags?: number;
  blockNumber?: number;
}): string {
  const { symbols } = options;
  const size = symbols[0]?.length ?? 0;
  if (symbols.length === 0 || size === 0 || symbols.some((symbol) => symbol.length !== size)) {
    throw new RangeError('A data frame carries one or more equal, non-empty symbols.');
  }
  const payload = new Uint8Array(size * symbols.length);
  symbols.forEach((symbol, index) => payload.set(symbol, index * size));
  return build(FRAME_DATA, options.flags ?? 0, options.sessionId, options.firstSymbol, symbols.length, options.blockNumber, payload);
}

/**
 * Builds a manifest frame.
 * @param options.sessionId - The 6-byte session ID (the first bytes of the manifest's SHA-256).
 * @param options.manifest - The encoded manifest.
 * @param options.flags - Frame flags.
 * @returns The Base45 text to put in a QR code.
 */
export function encodeManifestFrame(options: { sessionId: Uint8Array; manifest: Uint8Array; flags?: number }): string {
  return build(FRAME_MANIFEST, options.flags ?? 0, options.sessionId, 0, 1, undefined, options.manifest);
}

/**
 * Cheap check that a decoded QR text is the start of a Prism frame, so a receiver can ignore every
 * other code its camera sees without decoding it fully.
 * @param text - Text read from a QR code.
 * @returns True when it is Base45 and its first byte is the Prism magic.
 */
export function looksLikePrismFrame(text: string): boolean {
  if (text.length < 3 || !isBase45(text)) return false;
  const first = decodeBase45(text.slice(0, 3));
  return first !== null && first[0] >>> 4 === MAGIC;
}

/**
 * Reads a decoded QR text as a frame. Never throws: a truncated, corrupt or tampered frame comes
 * back as a rejection with a reason.
 * @param text - Text read from a QR code.
 * @returns The frame, or why it was not accepted.
 */
export function decodeFrame(text: string): FrameDecodeResult {
  if (text.length < 2 || !isBase45(text)) return { ok: false, reason: 'not-prism' };
  const bytes = decodeBase45(text);
  if (!bytes) return { ok: false, reason: 'not-prism' };
  if (bytes[0] >>> 4 !== MAGIC) return { ok: false, reason: 'not-prism' };
  if (bytes.length < FRAME_OVERHEAD) return { ok: false, reason: 'truncated' };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(bytes.length - 4) !== crc32c(bytes.subarray(0, bytes.length - 4))) return { ok: false, reason: 'corrupt' };
  const version = bytes[0] & 0x0f;
  if (version !== PRISM_VERSION) return { ok: false, reason: 'unsupported-version', version };

  const type = bytes[1] >>> 5;
  const flags = bytes[1] & 0b11111;
  if (flags & ~KNOWN_FLAGS) return { ok: false, reason: 'unsupported-version', version };
  const multiBlock = (flags & FLAG_MULTI_BLOCK) !== 0;
  const headerLength = 12 + (multiBlock ? 1 : 0);
  if (bytes.length < headerLength + 4) return { ok: false, reason: 'truncated' };

  const sessionId = bytesToHex(bytes.subarray(2, 2 + SESSION_ID_BYTES));
  const firstSymbol = (bytes[8] << 16) | (bytes[9] << 8) | bytes[10];
  const count = bytes[11];
  const payload = bytes.slice(headerLength, bytes.length - 4);

  if (type === FRAME_MANIFEST) {
    if (payload.length === 0) return { ok: false, reason: 'malformed' };
    return { ok: true, frame: { type: 'manifest', flags, sessionId, manifest: payload } };
  }
  if (type !== FRAME_DATA) return { ok: false, reason: 'unsupported-type' };
  if (count === 0 || payload.length === 0 || payload.length % count !== 0) return { ok: false, reason: 'malformed' };
  return {
    ok: true,
    frame: { type: 'data', flags, sessionId, blockNumber: multiBlock ? bytes[12] : 0, firstSymbol, count, symbols: payload },
  };
}
