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

import { describe, it, expect, vi } from 'vitest';
import { QRErrorCorrectionLevel, QRType } from '@/types';
import { qrEncoder } from '../../../../tests/fixtures/qrEncoder';
import { buildMatrix, loadQrEncoder, resolveEncodedValue, type QrEncoder } from '../index';

const fakeEncoder = (): QrEncoder & { create: ReturnType<typeof vi.fn> } => ({
  create: vi.fn(() => ({ modules: { size: 21, get: () => false } })),
});

describe('buildMatrix', () => {
  it('normalizes a bare domain URL payload before encoding', () => {
    const encoder = fakeEncoder();
    buildMatrix({ type: QRType.URL, value: 'example.com', errorCorrectionLevel: QRErrorCorrectionLevel.H }, encoder);
    expect(encoder.create).toHaveBeenCalledWith('https://example.com/', { errorCorrectionLevel: QRErrorCorrectionLevel.H });
  });

  it('leaves URLs that already carry a scheme untouched', () => {
    expect(resolveEncodedValue({ type: QRType.URL, value: 'https://qrcraftly.com/a?b=c' })).toBe('https://qrcraftly.com/a?b=c');
  });

  it('never normalizes non-URL payloads, even when they look like domains', () => {
    const encoder = fakeEncoder();
    buildMatrix({ type: QRType.TEXT, value: 'example.com', errorCorrectionLevel: QRErrorCorrectionLevel.M }, encoder);
    expect(encoder.create).toHaveBeenCalledWith('example.com', { errorCorrectionLevel: QRErrorCorrectionLevel.M });
  });

  it('returns the encoder modules', () => {
    const modules = { size: 21, get: () => true };
    const encoder: QrEncoder = { create: () => ({ modules }) };
    expect(buildMatrix({ type: QRType.TEXT, value: 'x', errorCorrectionLevel: QRErrorCorrectionLevel.L }, encoder)).toBe(modules);
  });

  it('propagates encoder failures to the caller', () => {
    const encoder: QrEncoder = {
      create: () => {
        throw new Error('No input text');
      },
    };
    expect(() => buildMatrix({ type: QRType.TEXT, value: '', errorCorrectionLevel: QRErrorCorrectionLevel.L }, encoder)).toThrow(
      'No input text'
    );
  });

  it('produces the same matrix for a bare domain and its normalized form with the real encoder', async () => {
    const encoder = await loadQrEncoder();
    const bare = buildMatrix({ type: QRType.URL, value: 'example.com', errorCorrectionLevel: QRErrorCorrectionLevel.M }, encoder);
    const full = qrEncoder.create('https://example.com/', { errorCorrectionLevel: QRErrorCorrectionLevel.M }).modules;
    expect(bare.size).toBe(full.size);
    for (let r = 0; r < full.size; r++) {
      for (let c = 0; c < full.size; c++) {
        expect(bare.get(r, c)).toBe(full.get(r, c));
      }
    }
  });
});
