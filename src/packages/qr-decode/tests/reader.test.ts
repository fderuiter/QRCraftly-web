/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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
import { qrEncoder } from '../../../../tests/fixtures/qrEncoder';
import { loadQrReader, type QrPoint, type QrReader } from '../index';
import type { QrSegmentInput, QrEncodeOptions } from '@/packages/qr-matrix';

const SCALE = 4;

/** Draws a symbol at `left`, `top` (in pixels) into a white RGBA frame. */
function draw(frame: { data: Uint8ClampedArray; width: number }, value: string | QrSegmentInput[], left: number, top: number, options: QrEncodeOptions = {}, dark = 0, light = 255): number {
  const { size, data } = qrEncoder.create(value, options).modules;
  for (let y = -4 * SCALE; y < (size + 4) * SCALE; y++) {
    for (let x = -4 * SCALE; x < (size + 4) * SCALE; x++) {
      const row = Math.floor(y / SCALE);
      const col = Math.floor(x / SCALE);
      const on = row >= 0 && col >= 0 && row < size && col < size && data[row * size + col] === 1;
      const i = ((top + y) * frame.width + left + x) * 4;
      frame.data.fill(on ? dark : light, i, i + 3);
      frame.data[i + 3] = 255;
    }
  }
  return size * SCALE;
}

function frameOf(width: number, height: number) {
  return { data: new Uint8ClampedArray(width * height * 4).fill(255), width, height };
}

function readOne(reader: QrReader, value: string | QrSegmentInput[], options: QrEncodeOptions = {}) {
  const frame = frameOf(240, 240);
  draw(frame, value, 40, 40, options);
  return reader.read(frame.data, frame.width, frame.height);
}

describe('qr-decode reader (#1178)', () => {
  it('loads once and reads text, bytes and the symbol', async () => {
    const reader = await loadQrReader();
    expect(await loadQrReader()).toBe(reader);
    const [code, ...rest] = readOne(reader, 'https://qrcraftly.com/ünïcode ✓', { errorCorrectionLevel: 'Q', maskPattern: 3 });
    expect(rest).toEqual([]);
    expect(code.text).toBe('https://qrcraftly.com/ünïcode ✓');
    expect(new TextDecoder().decode(code.bytes)).toBe(code.text);
    expect(code).toMatchObject({ level: 'Q', mask: 3, mirrored: false, inverted: false, structuredAppend: null, fnc1: null });
    expect(code.corners[0].x).toBeCloseTo(40, 0);
    expect(code.corners[0].y).toBeCloseTo(40, 0);
    expect(code.finders).toHaveLength(3);
  });

  it('decodes kanji, ECI and mixed segments as text', async () => {
    const reader = await loadQrReader();
    const kanji = Uint8Array.of(0x93, 0xfa, 0x96, 0x7b);
    const mixed = readOne(reader, [
      { mode: 'numeric', data: '2026' },
      { mode: 'alphanumeric', data: ' QR ' },
      { mode: 'kanji', data: kanji },
    ])[0];
    expect(mixed.text).toBe('2026 QR 日本');
    expect(mixed.segments.map((s) => s.mode)).toEqual(['numeric', 'alphanumeric', 'kanji']);

    const latin = readOne(reader, [{ mode: 'byte', data: Uint8Array.of(0x63, 0x61, 0x66, 0xe9) }], { eci: 3 })[0];
    expect(latin.text).toBe('café');
    expect(latin.segments[0].eci).toBe(3);
    // Without an ECI, bytes that are not UTF-8 read as Latin-1.
    expect(readOne(reader, [{ mode: 'byte', data: Uint8Array.of(0x63, 0x61, 0x66, 0xe9) }])[0].text).toBe('café');
  });

  it('reports structured append', async () => {
    const reader = await loadQrReader();
    const [code] = readOne(reader, 'part two', { structuredAppend: { index: 1, total: 3, parity: 0x5a } });
    expect(code.structuredAppend).toEqual({ index: 1, total: 3, parity: 0x5a });
  });

  it('finds several codes, light-on-dark codes when asked, and grey frames', async () => {
    const reader = await loadQrReader();
    const frame = frameOf(480, 240);
    draw(frame, 'left', 40, 40);
    draw(frame, 'right', 280, 40);
    const both = reader.read(frame.data, frame.width, frame.height, { maxCodes: 4 });
    expect(both.map((c) => c.text).sort()).toEqual(['left', 'right']);

    const dark = frameOf(240, 240);
    draw(dark, 'inverted', 40, 40, {}, 255, 0);
    expect(reader.read(dark.data, 240, 240)).toEqual([]);
    expect(reader.read(dark.data, 240, 240, { inverted: true })[0]).toMatchObject({ text: 'inverted', inverted: true });

    const grey = new Uint8Array(240 * 240);
    for (let i = 0; i < grey.length; i++) grey[i] = dark.data[i * 4];
    expect(reader.read(grey, 240, 240, { inverted: true })[0].text).toBe('inverted');
  });

  it('reads tracked tiles from their corners, versions and levels (the Prism fast path)', async () => {
    const reader = await loadQrReader();
    const frame = frameOf(480, 240);
    const side = draw(frame, 'tile one', 40, 40, { errorCorrectionLevel: 'M' });
    draw(frame, 'tile two', 280, 40, { errorCorrectionLevel: 'M' });
    const [found] = reader.read(frame.data, frame.width, frame.height);
    const corners = (x: number): [QrPoint, QrPoint, QrPoint, QrPoint] => [
      { x, y: 40 },
      { x: x + side, y: 40 },
      { x: x + side, y: 40 + side },
      { x, y: 40 + side },
    ];
    const version = found.version;

    const [one, two, wrongLevel, wrongVersion] = reader.readTracked(frame.data, frame.width, frame.height, [
      { corners: corners(40), version, level: 'M' },
      { corners: corners(280), version },
      { corners: corners(40), version, level: 'H' },
      { corners: corners(40), version: version + 1 },
    ]);
    expect(one).toMatchObject({ text: 'tile one', version, level: 'M', mirrored: false, inverted: false, alignment: null });
    expect(one?.corners).toEqual(corners(40));
    expect(two?.text).toBe('tile two');
    expect(wrongLevel).toBeNull();
    expect(wrongVersion).toBeNull();

    const dark = frameOf(240, 240);
    draw(dark, 'tile one', 40, 40, { errorCorrectionLevel: 'M' }, 255, 0);
    expect(reader.readTracked(dark.data, 240, 240, [{ corners: corners(40), version }])).toEqual([null]);
    expect(reader.readTracked(dark.data, 240, 240, [{ corners: corners(40), version, inverted: true }])[0]).toMatchObject({ text: 'tile one', inverted: true });

    expect(() => reader.readTracked(frame.data, frame.width, frame.height, [])).toThrow(/tiles/);
    expect(() => reader.readTracked(frame.data, frame.width, frame.height, [{ corners: corners(40), version: 41 }])).toThrow(/version/);
    const nan: [QrPoint, QrPoint, QrPoint, QrPoint] = [{ x: Number.NaN, y: 0 }, ...corners(40).slice(1)] as [QrPoint, QrPoint, QrPoint, QrPoint];
    expect(() => reader.readTracked(frame.data, frame.width, frame.height, [{ corners: nan, version }])).toThrow(/status/);
  });

  it('rejects pixels that do not match the size', async () => {
    const reader = await loadQrReader();
    expect(() => reader.read(new Uint8ClampedArray(10), 4, 4)).toThrow(/grey or RGBA/);
    expect(() => reader.read(new Uint8ClampedArray(0), 0, 0)).toThrow();
    expect(reader.read(new Uint8ClampedArray(64 * 64 * 4), 64, 64)).toEqual([]);
  });
});
