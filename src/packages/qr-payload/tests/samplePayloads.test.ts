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

import { describe, it, expect } from 'vitest';
import { QRType } from '@/packages/core/types';
import { getSamplePayload, SAMPLE_PAYLOADS, validatePayload, QR_GENERATORS } from '../index';

describe('Type-Aware Fallback Sample Payloads', () => {
  const allTypes = Object.values(QRType) as QRType[];

  it('provides a valid non-empty sample payload for every supported QR type', () => {
    for (const type of allTypes) {
      const sample = getSamplePayload(type);
      expect(sample).toBeDefined();
      expect(typeof sample).toBe('string');
      expect(sample.length).toBeGreaterThan(0);
      expect(SAMPLE_PAYLOADS[type]).toBe(sample);
    }
  });

  it('ensures sample payloads pass security and structural validation without violations', () => {
    for (const type of allTypes) {
      const sample = getSamplePayload(type);
      const violations = validatePayload(sample, type);
      expect(violations).toEqual([]);
    }
  });

  it('can parse/hydrate every sample payload back into structured data or valid type', () => {
    for (const type of allTypes) {
      const sample = getSamplePayload(type);
      const parsed: unknown = QR_GENERATORS[type].hydrate(sample);
      expect(parsed).not.toBeNull();
      expect(parsed).toBeDefined();
    }
  });

  it('falls back to URL sample payload for an unknown QR type', () => {
    const unknownType = 'UNKNOWN' as QRType;
    expect(getSamplePayload(unknownType)).toBe(SAMPLE_PAYLOADS[QRType.URL]);
  });
});
