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
import { runFeedbackBench, type BenchReceiver } from './utils/feedbackBench';

const strong: BenchReceiver = { name: 'strong', reads: 'fast' };
const middle: BenchReceiver = { name: 'middle', reads: 'balanced' };
const weak: BenchReceiver = { name: 'weak', reads: 'steady' };
const FILE_BYTES = 400_000;

describe('webcam back channel simulation (#1146)', () => {
  it.each([
    [strong, 'fast'],
    [middle, 'balanced'],
    [weak, 'steady'],
  ] as const)('settles on the best profile a %s receiver reads and sends the whole file', async (receiver, best) => {
    const run = await runFeedbackBench({ mode: { kind: 'steered' }, receivers: [receiver], fileBytes: FILE_BYTES, seed: 1 });
    expect(run.complete).toBe(true);
    expect(run.timeline[run.timeline.length - 1].profile).toBe(best);
  }, 120_000);

  it('raises goodput for a strong receiver above what the default profile gives', async () => {
    const fixed = await runFeedbackBench({ mode: { kind: 'fixed', profile: 'balanced' }, receivers: [strong], fileBytes: FILE_BYTES, seed: 1 });
    const steered = await runFeedbackBench({ mode: { kind: 'steered' }, receivers: [strong], fileBytes: FILE_BYTES, seed: 1 });
    expect(steered.goodputKBps[0]).toBeGreaterThan(fixed.goodputKBps[0] * 1.5);
  }, 120_000);

  it('beats guessing too fast for a weak receiver and costs little against the best fixed profile', async () => {
    const wrongGuess = await runFeedbackBench({ mode: { kind: 'fixed', profile: 'balanced' }, receivers: [weak], fileBytes: 200_000, seed: 2 });
    const best = await runFeedbackBench({ mode: { kind: 'fixed', profile: 'steady' }, receivers: [weak], fileBytes: 200_000, seed: 2 });
    const steered = await runFeedbackBench({ mode: { kind: 'steered' }, receivers: [weak], fileBytes: 200_000, seed: 2 });
    expect(steered.goodputKBps[0]).toBeGreaterThan(wrongGuess.goodputKBps[0] * 2);
    expect(steered.goodputKBps[0]).toBeGreaterThan(best.goodputKBps[0] * 0.8);
  }, 120_000);

  it.each([1, 2, 3, 4, 5])('stops within 1 s of done on the default back channel (seed %i)', async (seed) => {
    const run = await runFeedbackBench({ mode: { kind: 'steered' }, receivers: [strong], fileBytes: FILE_BYTES, seed });
    expect(run.stopDelayMs).not.toBeNull();
    expect(run.stopDelayMs ?? Infinity).toBeLessThanOrEqual(1000);
  }, 120_000);

  it('stops only after every receiver in sight is done, and follows the weakest', async () => {
    const run = await runFeedbackBench({ mode: { kind: 'steered' }, receivers: [strong, middle], fileBytes: FILE_BYTES, seed: 3 });
    expect(run.complete).toBe(true);
    const lastDone = Math.max(...(run.doneAtMs as number[]));
    expect(run.stoppedAtMs ?? 0).toBeGreaterThanOrEqual(lastDone);
    expect(run.stopDelayMs ?? Infinity).toBeLessThanOrEqual(1000);
    expect(run.timeline[run.timeline.length - 1].profile).toBe('balanced');
  }, 120_000);

  it('never stops a one-way stream by itself and never sends feedback', async () => {
    const run = await runFeedbackBench({ mode: { kind: 'fixed', profile: 'balanced' }, receivers: [strong], fileBytes: 100_000, seed: 1 });
    expect(run.complete).toBe(true);
    expect(run.stoppedAtMs).toBeNull();
    expect(run.stopDelayMs).toBeNull();
    expect(run.feedbackSent).toBe(0);
    expect(run.timeline).toHaveLength(1);
  }, 120_000);

  it('is repeatable: the same seed gives the same run', async () => {
    const options = { mode: { kind: 'steered' }, receivers: [middle], fileBytes: 150_000, seed: 4 } as const;
    expect(await runFeedbackBench(options)).toEqual(await runFeedbackBench(options));
  }, 120_000);
});
