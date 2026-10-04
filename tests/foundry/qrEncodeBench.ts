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

/**
 * `pnpm run bench:qr-encode` (#1177): time per encode through the encoder's
 * TypeScript wrapper (text in, module grid out), at p50 and p95, for typical
 * payloads under 300 bytes and for version 40 symbols.
 */
import type { QrEccLetter, QrSymbolEncoder } from '@/packages/qr-matrix/encoder';

export interface QrEncodeBenchCase {
  name: string;
  text: string;
  ecc: QrEccLetter;
}

export interface QrEncodeBenchResult {
  name: string;
  bytes: number;
  version: number;
  samples: number;
  p50Micros: number;
  p95Micros: number;
}

export interface QrEncodeBenchReport {
  bench: 'qr-encode';
  runtime: string;
  options: { samples: number };
  cases: QrEncodeBenchResult[];
}

const repeatTo = (unit: string, length: number) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);

/** The payloads timed: what people type, then the largest symbols. */
export const QR_ENCODE_BENCH_CASES: readonly QrEncodeBenchCase[] = [
  { name: 'URL', text: 'https://qrcraftly.com/menu?table=12', ecc: 'M' },
  { name: 'Wi-Fi', text: 'WIFI:T:WPA;S:QRCraftly_Guest;P:examplepass123;;', ecc: 'M' },
  { name: 'vCard', text: 'BEGIN:VCARD\nVERSION:3.0\nN:Doe;Jane\nFN:Jane Doe\nORG:QRCraftly\nTEL:+1 555-0199\nEMAIL:jane.doe@example.com\nURL:https://qrcraftly.com\nEND:VCARD', ecc: 'Q' },
  { name: 'text 100 B', text: repeatTo('The quick brown fox jumps over the lazy dog. ', 100), ecc: 'H' },
  { name: 'text 300 B', text: repeatTo('Pack my box with five dozen liquor jugs, 0123456789! ', 300), ecc: 'M' },
  { name: 'v40 bytes (L)', text: repeatTo('abcdefghijklmnopqrstuvwxyz', 2953), ecc: 'L' },
  { name: 'v40 digits (L)', text: repeatTo('0123456789', 7089), ecc: 'L' },
  { name: 'v40 mixed (M)', text: repeatTo('Order 12345678901234 SHIPPED to Zürich; ', 1900), ecc: 'M' },
];

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

/** Times `samples` encodes of each case after a warm-up. */
export function runQrEncodeBench(encoder: QrSymbolEncoder, options: { samples: number }, cases = QR_ENCODE_BENCH_CASES): QrEncodeBenchReport {
  const results = cases.map((c): QrEncodeBenchResult => {
    let version = 0;
    for (let i = 0; i < Math.min(20, options.samples); i++) version = encoder.create(c.text, { errorCorrectionLevel: c.ecc }).version;
    const times: number[] = [];
    for (let i = 0; i < options.samples; i++) {
      const start = performance.now();
      encoder.create(c.text, { errorCorrectionLevel: c.ecc });
      times.push((performance.now() - start) * 1000);
    }
    times.sort((a, b) => a - b);
    const round = (micros: number) => Math.round(micros * 10) / 10;
    return {
      name: c.name,
      bytes: new TextEncoder().encode(c.text).length,
      version,
      samples: options.samples,
      p50Micros: round(percentile(times, 0.5)),
      p95Micros: round(percentile(times, 0.95)),
    };
  });
  return { bench: 'qr-encode', runtime: `node ${process.version}`, options, cases: results };
}
