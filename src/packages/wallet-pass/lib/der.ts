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
 * A minimal DER (ITU-T X.690) reader and writer: just what certificates, keys and CMS
 * signatures need. Only definite lengths are read or written, as DER requires.
 */

import { concatBytes } from '@/packages/core/encoding';

/** Universal tags used by certificates and CMS. */
export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

/** Thrown when bytes are not valid DER for what was expected. */
export class DerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DerError';
  }
}

/** One decoded element. `bytes` is the whole element (tag, length and contents). */
export interface DerNode {
  tag: number;
  /** The contents, without the tag and length. */
  value: Uint8Array;
  bytes: Uint8Array;
}

/** Reads the element at `offset`. */
export function readDer(data: Uint8Array, offset = 0): DerNode {
  if (offset + 2 > data.length) throw new DerError('The data ends in the middle of an element.');
  const tag = data[offset];
  if ((tag & 0x1f) === 0x1f) throw new DerError('High tag numbers are not supported.');
  let length = data[offset + 1];
  let start = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4) throw new DerError('Indefinite or oversized lengths are not DER.');
    if (start + count > data.length) throw new DerError('The data ends in the middle of a length.');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + data[start + i];
    start += count;
  }
  const end = start + length;
  if (end > data.length) throw new DerError('An element runs past the end of the data.');
  return { tag, value: data.subarray(start, end), bytes: data.subarray(offset, end) };
}

/** Reads the elements inside a constructed element (a SEQUENCE, SET or explicit tag). */
export function readChildren(node: DerNode): DerNode[] {
  const children: DerNode[] = [];
  let offset = 0;
  while (offset < node.value.length) {
    const child = readDer(node.value, offset);
    children.push(child);
    offset += child.bytes.length;
  }
  return children;
}

/** Reads a whole buffer that must hold exactly one element. */
export function readDerAll(data: Uint8Array): DerNode {
  const node = readDer(data);
  if (node.bytes.length !== data.length) throw new DerError('There are extra bytes after the element.');
  return node;
}

/** Returns the `index`th child, checking its tag. */
export function childAt(node: DerNode, index: number, tag?: number): DerNode {
  const child = readChildren(node)[index];
  if (!child) throw new DerError(`Element ${index} is missing.`);
  if (tag !== undefined && child.tag !== tag) throw new DerError(`Element ${index} has tag 0x${child.tag.toString(16)}, expected 0x${tag.toString(16)}.`);
  return child;
}

/** Decodes an OBJECT IDENTIFIER to dotted form. */
export function readOid(node: DerNode): string {
  if (node.tag !== TAG.OID || node.value.length === 0) throw new DerError('Expected an object identifier.');
  const parts: number[] = [];
  let value = 0;
  for (const byte of node.value) {
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  const first = parts.shift() ?? 0;
  const head = first < 80 ? [Math.floor(first / 40), first % 40] : [2, first - 80];
  return [...head, ...parts].join('.');
}

/** Decodes a string type (UTF8String, PrintableString, IA5String and the like). */
export function readString(node: DerNode): string {
  return new TextDecoder().decode(node.value);
}

/** Decodes a UTCTime or GeneralizedTime. */
export function readTime(node: DerNode): Date {
  const text = readString(node);
  const match =
    node.tag === TAG.UTC_TIME ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text) : node.tag === TAG.GENERALIZED_TIME ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text) : null;
  if (!match) throw new DerError(`Unsupported time: ${text}`);
  let year = Number(match[1]);
  if (node.tag === TAG.UTC_TIME) year += year < 50 ? 2000 : 1900;
  return new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])));
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

function encodeLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** Encodes an element with `tag` around `contents`. */
export function der(tag: number, ...contents: Uint8Array[]): Uint8Array {
  const body = concatBytes(contents);
  return concatBytes([Uint8Array.of(tag, ...encodeLength(body.length)), body]);
}

/** A SEQUENCE of the given elements. */
export const sequence = (...items: Uint8Array[]): Uint8Array => der(TAG.SEQUENCE, ...items);

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** A SET OF the given elements, sorted by their encodings as DER requires. */
export const setOf = (...items: Uint8Array[]): Uint8Array => der(TAG.SET, ...[...items].sort(compareBytes));

/** A context-specific constructed tag `[n]` around `contents` (EXPLICIT, or IMPLICIT over a constructed type). */
export const contextTag = (n: number, ...contents: Uint8Array[]): Uint8Array => der(0xa0 | n, ...contents);

/** An OBJECT IDENTIFIER from dotted form. */
export function oid(dotted: string): Uint8Array {
  const parts = dotted.split('.').map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isSafeInteger(part) || part < 0)) throw new DerError(`Invalid object identifier: ${dotted}`);
  const bytes: number[] = [];
  for (const part of [parts[0] * 40 + parts[1], ...parts.slice(2)]) {
    const group = [part & 0x7f];
    for (let rest = Math.floor(part / 128); rest > 0; rest = Math.floor(rest / 128)) group.unshift((rest & 0x7f) | 0x80);
    bytes.push(...group);
  }
  return der(TAG.OID, Uint8Array.from(bytes));
}

/** An INTEGER from a small non-negative number or from big-endian unsigned bytes. */
export function integer(value: number | Uint8Array): Uint8Array {
  let bytes: Uint8Array;
  if (typeof value === 'number') {
    const list: number[] = [];
    for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) list.unshift(rest & 0xff);
    bytes = Uint8Array.from(list.length ? list : [0]);
  } else {
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start++;
    bytes = value.subarray(start);
  }
  // A leading 1 bit would read as negative, so unsigned values get a zero byte.
  return der(TAG.INTEGER, bytes[0] & 0x80 ? concatBytes([Uint8Array.of(0), bytes]) : bytes);
}

/** An OCTET STRING. */
export const octetString = (bytes: Uint8Array): Uint8Array => der(TAG.OCTET_STRING, bytes);

/** A BIT STRING with no unused bits. */
export const bitString = (bytes: Uint8Array): Uint8Array => der(TAG.BIT_STRING, Uint8Array.of(0), bytes);

/** NULL. */
export const nullValue = (): Uint8Array => Uint8Array.of(TAG.NULL, 0);

/** A UTF8String. */
export const utf8String = (text: string): Uint8Array => der(TAG.UTF8_STRING, new TextEncoder().encode(text));

/** A UTCTime (years 1950 to 2049), as CMS signing time requires; GeneralizedTime outside them. */
export function time(date: Date): Uint8Array {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getUTCFullYear();
  const rest = `${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  if (year >= 1950 && year < 2050) return der(TAG.UTC_TIME, new TextEncoder().encode(`${pad(year % 100)}${rest}`));
  return der(TAG.GENERALIZED_TIME, new TextEncoder().encode(`${year}${rest}`));
}

/** An AlgorithmIdentifier with NULL parameters. */
export const algorithm = (dotted: string): Uint8Array => sequence(oid(dotted), nullValue());
