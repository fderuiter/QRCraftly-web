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

import { rsDecode, rsEncode } from './rs';

/** The format version this build reads and writes. */
export const MODEM_VERSION = 1;
/** First byte of every header. */
export const HEADER_MAGIC = 0xb7;
/** Message bytes in a header. */
export const HEADER_MESSAGE_BYTES = 18;
/** Check bytes in a header: 24 of 42 bytes, so a header survives 12 wrong bytes. */
export const HEADER_PARITY = 24;
/** Bytes in the header codeword. */
export const HEADER_CODEWORD_BYTES = HEADER_MESSAGE_BYTES + HEADER_PARITY;

/** What every frame says about itself. */
export interface FrameHeader {
  /** Format version, 0 to 15. */
  version: number;
  /** Profile number, 0 to 15. The modem profiles are 2 to 4; 15 marks a probe frame. */
  profile: number;
  /** A constellation id. */
  constellation: number;
  /** Data bytes in each inner code block. */
  packetBytes: number;
  /** Check bytes in each inner code block (0 to 254 - packetBytes), so a receiver needs no table to read a frame. */
  parity: number;
  /** Reserved for later versions; written as 0. */
  flags: number;
  /** Session id, 32 bits. */
  session: number;
  /** Frame sequence number, 32 bits. */
  seq: number;
  cols: number;
  rows: number;
}

/**
 * Writes a header as a Reed-Solomon codeword.
 * @param header - The header fields.
 * @returns 42 bytes.
 */
export function encodeHeader(header: FrameHeader): Uint8Array {
  const message = new Uint8Array(HEADER_MESSAGE_BYTES);
  const view = new DataView(message.buffer);
  message[0] = HEADER_MAGIC;
  message[1] = ((header.version & 15) << 4) | (header.profile & 15);
  message[2] = header.constellation;
  message[3] = header.packetBytes;
  view.setUint32(4, header.session >>> 0);
  view.setUint32(8, header.seq >>> 0);
  view.setUint16(12, header.cols);
  view.setUint16(14, header.rows);
  message[16] = header.parity;
  message[17] = header.flags;
  return rsEncode(message, HEADER_PARITY);
}

/**
 * Reads a header codeword.
 * @param codeword - 42 bytes, possibly damaged.
 * @returns The header, or null when the code cannot repair it or the magic byte is wrong.
 */
export function decodeHeader(codeword: Uint8Array): FrameHeader | null {
  const result = rsDecode(codeword, HEADER_PARITY);
  if (!result.ok || result.message[0] !== HEADER_MAGIC) return null;
  const view = new DataView(result.message.buffer, result.message.byteOffset, result.message.byteLength);
  return {
    version: result.message[1] >> 4,
    profile: result.message[1] & 15,
    constellation: result.message[2],
    packetBytes: result.message[3],
    session: view.getUint32(4),
    seq: view.getUint32(8),
    cols: view.getUint16(12),
    rows: view.getUint16(14),
    parity: result.message[16],
    flags: result.message[17],
  };
}
