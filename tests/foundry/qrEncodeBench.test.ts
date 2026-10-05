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
import { qrEncoder } from '../fixtures/qrEncoder';
import { QR_ENCODE_BENCH_CASES, runQrEncodeBench } from './qrEncodeBench';

describe('bench:qr-encode', () => {
  it('times every case and reports the symbol it made', () => {
    const report = runQrEncodeBench(qrEncoder, { samples: 3 });
    expect(report.bench).toBe('qr-encode');
    expect(report.cases.map((c) => c.name)).toEqual(QR_ENCODE_BENCH_CASES.map((c) => c.name));
    for (const c of report.cases) {
      expect(c.version).toBeGreaterThanOrEqual(1);
      expect(c.p95Micros).toBeGreaterThanOrEqual(c.p50Micros);
    }
    // Typical payloads stay under 300 bytes; the last cases reach the largest symbols.
    expect(report.cases.filter((c) => c.bytes <= 300)).toHaveLength(5);
    expect(report.cases.filter((c) => c.version === 40)).toHaveLength(2);
  });
});
