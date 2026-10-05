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

import { beforeAll, describe, expect, it } from 'vitest';
import { loadFecModule } from '@/packages/optical-transfer';
import baseline from './fixtures/transfer-baseline.json';
import { BASELINE_MAX_K, CODEC_BLOCK_SIZE, ERASURE_CHANNELS, benchCodec, codecTrials, runCodecTrial } from './utils/transferBench';

/** How much worse than the committed baseline the codec may get before this test fails. */
const TOLERANCE = 1.15;

describe('transfer benchmark regression guard (#1139)', () => {
  const cells = [10, 100, BASELINE_MAX_K].flatMap((k) => ERASURE_CHANNELS.map((channel) => ({ k, channel })));

  it.each(cells)('$channel.name at K=$k needs no more than 15% more frames than the baseline', ({ k, channel }) => {
    const recorded = (baseline as Record<string, { overheadMedian: number; overheadP95: number }>)[`${channel.name}/${k}`];
    expect(recorded, 'run `pnpm run bench:transfer -- --quick --baseline` to record it').toBeDefined();
    const row = benchCodec(k, CODEC_BLOCK_SIZE, channel, codecTrials(k, true));
    expect(row.failures).toBe(0);
    expect(row.overheadMedian).toBeLessThanOrEqual(recorded.overheadMedian * TOLERANCE);
    expect(row.overheadP95).toBeLessThanOrEqual(recorded.overheadP95 * TOLERANCE);
  });

  describe('the outer code (#1141)', () => {
    let module: WebAssembly.Module;
    beforeAll(async () => {
      module = await loadFecModule();
    });

    it.each(cells)('$channel.name at K=$k stays within its baseline', ({ k, channel }) => {
      const recorded = (baseline as Record<string, { overheadMedian: number; overheadP95: number }>)[`fec/${channel.name}/${k}`];
      expect(recorded, 'run `pnpm run bench:transfer -- --quick --baseline` to record it').toBeDefined();
      const row = benchCodec(k, CODEC_BLOCK_SIZE, channel, codecTrials(k, true), module);
      expect(row.failures).toBe(0);
      expect(row.overheadMedian).toBeLessThanOrEqual(recorded.overheadMedian * TOLERANCE);
      expect(row.overheadP95).toBeLessThanOrEqual(recorded.overheadP95 * TOLERANCE);
    });
  });

  it('is repeatable: the same seed gives the same trial', () => {
    const channel = ERASURE_CHANNELS[4];
    const a = runCodecTrial(100, CODEC_BLOCK_SIZE, channel, 42);
    const b = runCodecTrial(100, CODEC_BLOCK_SIZE, channel, 42);
    expect({ ...a, decodeMs: 0 }).toEqual({ ...b, decodeMs: 0 });
  });
});
