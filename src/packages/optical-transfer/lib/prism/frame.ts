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
/** Type 2 is the receiver-to-sender channel (the optional webcam back channel, #1146); it carries no file data. */
export const FRAME_FEEDBACK = 2;

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
  | { type: 'manifest'; flags: number; sessionId: string; manifest: Uint8Array }
  | ({ type: 'feedback'; flags: number; sessionId: string } & FeedbackReport);

/** The densest layer a receiver reads: nothing dense (beacons only, or nothing), or a profile's dense layer. */
export type FeedbackLayer = 'none' | 'steady' | 'balanced' | 'fast';
const FEEDBACK_LAYERS: readonly FeedbackLayer[] = ['none', 'steady', 'balanced', 'fast'];

/** What a receiver tells the sender (#1146). Fractions are quantised on the wire: 16 bits and 8 bits. */
export interface FeedbackReport {
  /** Random per-session receiver nonce as 8 lowercase hex characters. It names no device or person. */
  nonce: string;
  /** Share of the file decoded, 0 to 1. */
  fractionDecoded: number;
  /** Share of the frames the receiver expected that it read, 0 to 1. */
  frameSuccessRate: number;
  densestLayer: FeedbackLayer;
  /** The file is complete and verified: the sender can stop. */
  done: boolean;
}

export const FEEDBACK_NONCE_BYTES = 4;
/** nonce, fraction (2), success rate, layer, done. */
const FEEDBACK_PAYLOAD_BYTES = FEEDBACK_NONCE_BYTES + 2 + 1 + 1 + 1;

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
 * Builds a feedback frame: the receiver's report to the sender, shown as a small QR code. It holds
 * no file data and a receiver never ingests one.
 * @param options.sessionId - The 6-byte ID of the session being received.
 * @param options.nonce - A random per-session receiver nonce (see {@link createReceiverNonce}).
 * @returns The Base45 text to put in a QR code.
 */
export function encodeFeedbackFrame(options: { sessionId: Uint8Array; nonce: Uint8Array; fractionDecoded: number; frameSuccessRate: number; densestLayer: FeedbackLayer; done: boolean }): string {
  if (options.nonce.length !== FEEDBACK_NONCE_BYTES) throw new RangeError('A receiver nonce is 4 bytes.');
  const payload = new Uint8Array(FEEDBACK_PAYLOAD_BYTES);
  payload.set(options.nonce, 0);
  const unit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  new DataView(payload.buffer).setUint16(FEEDBACK_NONCE_BYTES, Math.round(unit(options.fractionDecoded) * 0xffff));
  payload[FEEDBACK_NONCE_BYTES + 2] = Math.round(unit(options.frameSuccessRate) * 0xff);
  payload[FEEDBACK_NONCE_BYTES + 3] = FEEDBACK_LAYERS.indexOf(options.densestLayer);
  payload[FEEDBACK_NONCE_BYTES + 4] = options.done ? 1 : 0;
  return build(FRAME_FEEDBACK, 0, options.sessionId, 0, 1, undefined, payload);
}

/**
 * A fresh random receiver nonce. It lives in memory for one receive and is never stored.
 * @returns 4 random bytes.
 */
export function createReceiverNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(FEEDBACK_NONCE_BYTES));
}

function readFeedback(payload: Uint8Array): FeedbackReport | null {
  if (payload.length !== FEEDBACK_PAYLOAD_BYTES) return null;
  const layer = FEEDBACK_LAYERS[payload[FEEDBACK_NONCE_BYTES + 3]];
  const done = payload[FEEDBACK_NONCE_BYTES + 4];
  if (layer === undefined || done > 1) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return {
    nonce: bytesToHex(payload.subarray(0, FEEDBACK_NONCE_BYTES)),
    fractionDecoded: view.getUint16(FEEDBACK_NONCE_BYTES) / 0xffff,
    frameSuccessRate: payload[FEEDBACK_NONCE_BYTES + 2] / 0xff,
    densestLayer: layer,
    done: done === 1,
  };
}

/**
 * Cheap check that a decoded QR text is the start of a Prism frame, so a receiver can ignore every
 * other code its camera sees without decoding it fully.
 * @param text - Text read from a QR code.
 * @returns True when it is Base45 and its first byte is the Prism magic. A feedback frame is one too:
 * a receiver ignores it after {@link decodeFrame} tells it apart.
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
  if (type === FRAME_FEEDBACK) {
    const report = readFeedback(payload);
    return report ? { ok: true, frame: { type: 'feedback', flags, sessionId, ...report } } : { ok: false, reason: 'malformed' };
  }
  if (type !== FRAME_DATA) return { ok: false, reason: 'unsupported-type' };
  if (count === 0 || payload.length === 0 || payload.length % count !== 0) return { ok: false, reason: 'malformed' };
  return {
    ok: true,
    frame: { type: 'data', flags, sessionId, blockNumber: multiBlock ? bytes[12] : 0, firstSymbol, count, symbols: payload },
  };
}
