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

import { describe, expect, it } from 'vitest';
import { createMulberry32, createMulberry32Uint32, fnv1a } from '../math';

describe('Mulberry32 PRNG', () => {
  it('generates deterministic float sequences for seed 0', () => {
    const rng = createMulberry32(0);
    const expectedFloats = [
      0.26642920868471265,
      0.0003297457005828619,
      0.2232720274478197,
      0.1462021479383111,
      0.46732782293111086,
    ];
    for (const expected of expectedFloats) {
      expect(rng()).toBeCloseTo(expected, 10);
    }
  });

  it('generates deterministic uint32 sequences for seed 0', () => {
    const rng = createMulberry32(0);
    const expectedUints = [
      0x4434b462,
      0x00159c37,
      0x39285b08,
      0x256d8104,
      0x77a2cbd4,
    ];
    for (const expected of expectedUints) {
      expect(rng.nextUint32()).toBe(expected);
    }
  });

  it('generates deterministic float sequences for seed 1', () => {
    const rng = createMulberry32(1);
    const expectedFloats = [
      0.6270739405881613,
      0.002735721180215478,
      0.5274470399599522,
      0.9810509674716741,
      0.9683778982143849,
    ];
    for (const expected of expectedFloats) {
      expect(rng()).toBeCloseTo(expected, 10);
    }
  });

  it('generates deterministic uint32 sequences for seed 1', () => {
    const rng = createMulberry32(1);
    const expectedUints = [
      0xa087eaf3,
      0x00b349c9,
      0x8706c4eb,
      0xfb2627fd,
      0xf7e79d2b,
    ];
    for (const expected of expectedUints) {
      expect(rng.nextUint32()).toBe(expected);
    }
  });

  it('supports .next() method alias and direct call interchangeably', () => {
    const rng1 = createMulberry32(42);
    const rng2 = createMulberry32(42);
    for (let i = 0; i < 20; i++) {
      expect(rng1.next()).toBe(rng2());
    }
  });

  it('supports createMulberry32Uint32 factory', () => {
    const rngDirect = createMulberry32Uint32(100);
    const rngObject = createMulberry32(100);
    for (let i = 0; i < 20; i++) {
      expect(rngDirect()).toBe(rngObject.nextUint32());
    }
  });

  it('produces values strictly in [0, 1)', () => {
    const rng = createMulberry32(12345);
    for (let i = 0; i < 10000; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('handles negative, non-integer and edge seed values via unsigned 32-bit truncation', () => {
    const rngNegative = createMulberry32(-1);
    const rngMaxUint = createMulberry32(0xffffffff);
    expect(rngNegative()).toBe(rngMaxUint());

    const rngFloat = createMulberry32(42.9);
    const rngInt = createMulberry32(42);
    expect(rngFloat()).toBe(rngInt());
  });

  it('maintains independent generator instances', () => {
    const rngA = createMulberry32(7);
    const rngB = createMulberry32(7);
    rngA();
    rngA();
    expect(rngB()).not.toBe(rngA());
  });
});

describe('fnv1a string hashing', () => {
  it('hashes empty string to FNV offset basis (2166136261 / 0x811c9dc5)', () => {
    expect(fnv1a('')).toBe(2166136261);
  });

  it('hashes known strings deterministically', () => {
    expect(fnv1a('qrcraftly')).toBe(3249315059);
    expect(fnv1a('hello')).toBe(1335831723);
  });

  it('returns an unsigned 32-bit integer', () => {
    const val = fnv1a('some long arbitrary text payload');
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(val)).toBe(true);
  });
});
