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
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRErrorCorrectionLevel, QRType } from '@/packages/core/types';
import { resolveEncodedValue } from '@/packages/qr-matrix';
import { targetFromConfig } from './target';

describe('targetFromConfig', () => {
  it('uses the same normalized URL payload as the generator', () => {
    const config = { ...DEFAULT_CONFIG, type: QRType.URL, value: 'example.com/menu' };
    const target = targetFromConfig(config);
    expect(target.payload).toBe('https://example.com/menu');
    expect(target.payload).toBe(resolveEncodedValue(config));
  });

  it('keeps non-URL payloads verbatim', () => {
    const target = targetFromConfig({ ...DEFAULT_CONFIG, type: QRType.TEXT, value: 'example.com' });
    expect(target.payload).toBe('example.com');
  });

  it('carries the error correction tier and falls back to the foreground colour for eyes', () => {
    const target = targetFromConfig({
      ...DEFAULT_CONFIG,
      errorCorrectionLevel: QRErrorCorrectionLevel.Q,
      fgColor: '#123456',
      eyeColor: '',
    });
    expect(target.ecc).toBe(QRErrorCorrectionLevel.Q);
    expect(target.eyeColor).toBe('#123456');
  });
});
