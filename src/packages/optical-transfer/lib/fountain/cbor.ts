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

/**
 * Minimal deterministic CBOR (RFC 8949) subset used by the BC-UR envelope:
 * unsigned integers (major type 0), byte strings (2), UTF-8 text strings (3)
 * and definite-length arrays (4). Indefinite lengths, tags, maps, negative
 * integers and floats are intentionally unsupported and rejected on decode.
 */

/** A value representable in the supported CBOR subset. */
export type CborValue = number | Uint8Array | string | CborValue[];

const MAJOR_UINT = 0;
const MAJOR_BYTES = 2;
const MAJOR_TEXT = 3;
const MAJOR_ARRAY = 4;

function encodeHead(major: number, value: number, out: number[]): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`CBOR: unsupported length or integer ${value}`);
  }
  const m = major << 5;
  if (value < 24) {
    out.push(m | value);
  } else if (value <= 0xff) {
    out.push(m | 24, value);
  } else if (value <= 0xffff) {
    out.push(m | 25, value >>> 8, value & 0xff);
  } else if (value <= 0xffffffff) {
    out.push(m | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  } else {
    const hi = Math.floor(value / 0x100000000);
    const lo = value >>> 0;
    out.push(
      m | 27,
      (hi >>> 24) & 0xff,
      (hi >>> 16) & 0xff,
      (hi >>> 8) & 0xff,
      hi & 0xff,
      (lo >>> 24) & 0xff,
      (lo >>> 16) & 0xff,
      (lo >>> 8) & 0xff,
      lo & 0xff
    );
  }
}

function encodeInto(value: CborValue, out: number[]): void {
  if (typeof value === 'number') {
    encodeHead(MAJOR_UINT, value, out);
  } else if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    encodeHead(MAJOR_TEXT, bytes.length, out);
    for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
  } else if (Array.isArray(value)) {
    encodeHead(MAJOR_ARRAY, value.length, out);
    for (const item of value) encodeInto(item, out);
  } else {
    // Byte strings are detected structurally so views from another realm
    // (e.g. a jsdom or worker TextEncoder) still encode as CBOR bytes.
    encodeHead(MAJOR_BYTES, value.length, out);
    for (let i = 0; i < value.length; i++) out.push(value[i]);
  }
}

/**
 * Encodes a value using the smallest (preferred) CBOR serialization.
 * @param value The value to encode.
 * @returns Encoded bytes.
 */
export function cborEncode(value: CborValue): Uint8Array {
  const out: number[] = [];
  encodeInto(value, out);
  return Uint8Array.from(out);
}

class CborReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  public get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  private byte(): number {
    if (this.offset >= this.bytes.length) {
      throw new RangeError('CBOR: unexpected end of input');
    }
    return this.bytes[this.offset++];
  }

  private readArgument(info: number): number {
    if (info < 24) return info;
    let length: number;
    if (info === 24) length = 1;
    else if (info === 25) length = 2;
    else if (info === 26) length = 4;
    else if (info === 27) length = 8;
    else throw new RangeError('CBOR: indefinite lengths are not supported');
    let value = 0;
    for (let i = 0; i < length; i++) {
      value = value * 256 + this.byte();
    }
    if (!Number.isSafeInteger(value)) {
      throw new RangeError('CBOR: integer exceeds safe range');
    }
    return value;
  }

  private take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new RangeError('CBOR: truncated string');
    }
    const slice = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  public read(depth = 0): CborValue {
    if (depth > 16) throw new RangeError('CBOR: nesting too deep');
    const initial = this.byte();
    const major = initial >>> 5;
    const arg = this.readArgument(initial & 0x1f);
    switch (major) {
      case MAJOR_UINT:
        return arg;
      case MAJOR_BYTES:
        return this.take(arg);
      case MAJOR_TEXT:
        return new TextDecoder('utf-8', { fatal: true }).decode(this.take(arg));
      case MAJOR_ARRAY: {
        if (arg > this.bytes.length - this.offset) {
          throw new RangeError('CBOR: array length exceeds input');
        }
        const items: CborValue[] = [];
        for (let i = 0; i < arg; i++) items.push(this.read(depth + 1));
        return items;
      }
      default:
        throw new RangeError(`CBOR: unsupported major type ${major}`);
    }
  }
}

/**
 * Decodes exactly one CBOR data item that spans the entire input.
 * @param bytes Encoded bytes.
 * @returns The decoded value.
 * @throws RangeError on malformed, unsupported or trailing data.
 */
export function cborDecode(bytes: Uint8Array): CborValue {
  const reader = new CborReader(bytes);
  const value = reader.read();
  if (!reader.done) {
    throw new RangeError('CBOR: trailing bytes after data item');
  }
  return value;
}
