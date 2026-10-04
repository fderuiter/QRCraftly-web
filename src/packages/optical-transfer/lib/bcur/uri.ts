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

import { decodeBytewordsMinimal, encodeBytewordsMinimal } from '../fountain/bytewords';
import { cborDecode, cborEncode } from '../fountain/cbor';

/** One multipart UR part (BCR-2024-001): `[seqNum, seqLen, messageLen, checksum, data]`. */
export interface BcUrPart {
  seqNum: number;
  seqLen: number;
  messageLen: number;
  checksum: number;
  data: Uint8Array;
}

/** A UR string split into its type and body. */
export interface ParsedUr {
  type: string;
  /** Present for multipart URs (`ur:type/<seq>-<n>/body`). */
  seq?: { seqNum: number; seqLen: number };
  /** Minimal Bytewords body, lowercase. */
  body: string;
}

const TYPE_RE = /^[a-z0-9-]+$/;
const SEQ_RE = /^(\d{1,10})-(\d{1,10})$/;
const BODY_RE = /^[a-z]+$/;

/**
 * Cheap syntactic check (case-insensitive) that text is a UR string, single or multipart.
 * It cannot tell a real BC-UR stream from this app's own `ur:bytes` droplets.
 * @param text Decoded QR text.
 * @returns True for `ur:<type>[/<seq>-<n>]/<bytewords>`.
 */
export function isBcUr(text: string): boolean {
  return parseUr(text) !== null;
}

/**
 * @param text A UR string.
 * @returns The parsed pieces, or null if malformed.
 */
export function parseUr(text: string): ParsedUr | null {
  const lower = text.trim().toLowerCase();
  if (!lower.startsWith('ur:')) return null;
  const segments = lower.slice(3).split('/');
  if (segments.length < 2 || segments.length > 3) return null;
  const type = segments[0];
  const body = segments[segments.length - 1];
  if (!TYPE_RE.test(type) || !BODY_RE.test(body)) return null;
  if (segments.length === 2) return { type, body };
  const seq = SEQ_RE.exec(segments[1]);
  return seq ? { type, body, seq: { seqNum: Number(seq[1]), seqLen: Number(seq[2]) } } : null;
}

/**
 * @param type UR type (`bytes`, `crypto-psbt`, ...).
 * @param cbor The whole CBOR payload.
 * @returns The single-part string `ur:<type>/<bytewords>`.
 */
export function encodeSingleUr(type: string, cbor: Uint8Array): string {
  return `ur:${type}/${encodeBytewordsMinimal(cbor)}`;
}

/**
 * @param type UR type.
 * @param part The part to serialize.
 * @returns The multipart string `ur:<type>/<seq>-<n>/<bytewords>`.
 */
export function encodeUrPart(type: string, part: BcUrPart): string {
  const body = cborEncode([part.seqNum, part.seqLen, part.messageLen, part.checksum, part.data]);
  return `ur:${type}/${part.seqNum}-${part.seqLen}/${encodeBytewordsMinimal(body)}`;
}

function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

/**
 * @param body Minimal Bytewords body of a multipart UR.
 * @returns The part, or null if the CRC, CBOR or field types are invalid.
 */
export function decodeUrPart(body: string): BcUrPart | null {
  const bytes = decodeBytewordsMinimal(body);
  if (!bytes) return null;
  let value;
  try {
    value = cborDecode(bytes);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 5) return null;
  const [seqNum, seqLen, messageLen, checksum, data] = value;
  if (!isUint32(seqNum) || !isUint32(seqLen) || !isUint32(messageLen) || !isUint32(checksum)) return null;
  if (!(data instanceof Uint8Array) || data.length === 0 || seqNum < 1 || seqLen < 1 || messageLen < 1) return null;
  return { seqNum, seqLen, messageLen, checksum, data };
}
