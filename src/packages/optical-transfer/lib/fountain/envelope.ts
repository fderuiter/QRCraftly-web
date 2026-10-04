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

import { DropletMetadata, FountainDroplet } from './contracts';
import { cborEncode, cborDecode } from './cbor';
import { decodeBytewordsMinimal, encodeBytewordsMinimal } from './bytewords';
import { MAX_RECEIVE_MESSAGE_BYTES } from '../limits';

/** Canonical (lowercase) BC-UR type prefix for fountain droplets. */
export const FOUNTAIN_URI_PREFIX = 'ur:bytes/';

/** Upper bound on K accepted from an untrusted droplet header. */
const MAX_SOURCE_BLOCKS = 1 << 22;
const MAX_UINT32 = 0xffffffff;

/**
 * Serializes a droplet as a BC-UR multipart part:
 * `UR:BYTES/<seq>-<k>/<minimal bytewords of CBOR [seq, k, messageLen, checksum, data]>`.
 * The string is uppercase so QR encoders can use the denser alphanumeric mode.
 * @param droplet The droplet to serialize.
 * @returns The uppercase UR string.
 */
export function serializeDroplet(droplet: FountainDroplet): string {
  const body = cborEncode([droplet.seq, droplet.k, droplet.messageLength, droplet.checksum, droplet.data]);
  return `${FOUNTAIN_URI_PREFIX}${droplet.seq}-${droplet.k}/${encodeBytewordsMinimal(body)}`.toUpperCase();
}

/**
 * Checks (case-insensitively) whether a decoded QR string is a `ur:bytes/` droplet.
 * @param str Decoded QR text.
 * @returns True if the text carries the fountain UR prefix.
 */
export function isFountainDropletString(str: string): boolean {
  return str.length > FOUNTAIN_URI_PREFIX.length && str.slice(0, FOUNTAIN_URI_PREFIX.length).toLowerCase() === FOUNTAIN_URI_PREFIX;
}

function isUint(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * Parses and validates a BC-UR multipart droplet string.
 * @param str Decoded QR text.
 * @returns Droplet metadata and fragment bytes, or null if malformed or tampered.
 */
export function parseDropletString(str: string): { meta: DropletMetadata; data: Uint8Array } | null {
  if (!isFountainDropletString(str)) return null;
  const match = /^(\d{1,10})-(\d{1,10})\/([a-z]+)$/.exec(str.slice(FOUNTAIN_URI_PREFIX.length).toLowerCase());
  if (!match) return null;

  const body = decodeBytewordsMinimal(match[3]);
  if (!body) return null;

  let decoded;
  try {
    decoded = cborDecode(body);
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || decoded.length !== 5) return null;
  const [seq, k, messageLength, checksum, data] = decoded;
  if (
    !isUint(seq, MAX_UINT32) ||
    seq < 1 ||
    !isUint(k, MAX_SOURCE_BLOCKS) ||
    k < 1 ||
    !isUint(messageLength) ||
    !isUint(checksum, MAX_UINT32) ||
    !(data instanceof Uint8Array) ||
    data.length === 0 ||
    // A claim larger than the receive limit is rejected before any decoder state exists.
    messageLength > MAX_RECEIVE_MESSAGE_BYTES
  ) {
    return null;
  }
  if (Number(match[1]) !== seq || Number(match[2]) !== k) return null;
  // The message must fill exactly k fragments of this size (last one padded).
  if (messageLength > k * data.length || messageLength <= (k - 1) * data.length) return null;

  return { meta: { seq, k, messageLength, checksum }, data };
}
