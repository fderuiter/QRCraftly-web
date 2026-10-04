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
import { QRErrorCorrectionLevel } from '../types';
import { MIN_MODULE_MM, formatDistance, getPrintGuidance, moduleSizeMm } from './printGuidance';

describe('print guidance', () => {
  it('measures a module from the printed width, quiet zone included', () => {
    // 29 modules + 8 quiet-zone modules = 37 across.
    expect(moduleSizeMm(3.7, 29)).toBeCloseTo(1, 5);
  });

  it('starts from about ten times the width for a medium code of average density', () => {
    const guidance = getPrintGuidance(10, 33, QRErrorCorrectionLevel.M);
    expect(guidance.distanceCm).toBeCloseTo(100, 5);
  });

  it('shortens the distance for denser codes and lengthens it for sparse ones', () => {
    const sparse = getPrintGuidance(10, 21, QRErrorCorrectionLevel.M).distanceCm;
    const average = getPrintGuidance(10, 33, QRErrorCorrectionLevel.M).distanceCm;
    const dense = getPrintGuidance(10, 97, QRErrorCorrectionLevel.M).distanceCm;
    expect(sparse).toBeGreaterThan(average);
    expect(average).toBeGreaterThan(dense);
    // The density factor is bounded, so a huge code never reads as hopeless or an empty one as unlimited.
    expect(getPrintGuidance(10, 1, QRErrorCorrectionLevel.M).distanceCm).toBeLessThanOrEqual(120);
    expect(getPrintGuidance(10, 500, QRErrorCorrectionLevel.M).distanceCm).toBeGreaterThanOrEqual(50);
  });

  it('forgives more distance at higher error correction', () => {
    const at = (level: QRErrorCorrectionLevel) => getPrintGuidance(10, 33, level).distanceCm;
    expect(at(QRErrorCorrectionLevel.L)).toBeLessThan(at(QRErrorCorrectionLevel.M));
    expect(at(QRErrorCorrectionLevel.Q)).toBeLessThan(at(QRErrorCorrectionLevel.H));
  });

  it('warns when modules print smaller than the minimum, and gives the size that fixes it', () => {
    const small = getPrintGuidance(1.5, 41, QRErrorCorrectionLevel.M);
    expect(small.moduleMm).toBeLessThan(MIN_MODULE_MM);
    expect(small.tooSmall).toBe(true);
    const fixed = getPrintGuidance(small.minWidthCm, 41, QRErrorCorrectionLevel.M);
    expect(fixed.tooSmall).toBe(false);
    expect(fixed.moduleMm).toBeCloseTo(MIN_MODULE_MM, 5);
    expect(getPrintGuidance(10, 41, QRErrorCorrectionLevel.M).tooSmall).toBe(false);
  });

  it('formats distances in centimetres or metres', () => {
    expect(formatDistance(45.4)).toBe('45 cm');
    expect(formatDistance(240)).toBe('2.4 m');
  });
});
