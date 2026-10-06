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
import {
  DEFAULT_LADDER_WEIGHTS,
  LADDER,
  LINK_ADVICE_TEXT,
  LinkTracker,
  MODEM_PROFILES,
  SIMULATED_RECEIVERS,
  decodeModemFrame,
  encodeModemFrame,
  frameCapacity,
  ladderSchedule,
  linkLabel,
  lockLevelText,
  lockedSchedule,
  observeDecode,
  simulateCapture,
  type FrameObservation,
  type LinkState,
  loadOpticalModem,
} from '../index';

const FPS = 30;

/** A camera frame in which `profile` repaired `ok` of its `blocks` blocks (null: not read). */
function frame(index: number, profile: number | null, ok: number, blocks = 10, failure: FrameObservation['failure'] = null): FrameObservation {
  return { timeMs: (index * 1000) / FPS, profile, blocksOk: ok, blocks, packetBytes: 80, failure: profile === null ? (failure ?? 'no-fiducials') : null };
}

/** Feeds `seconds` of camera frames made by `make`. */
function feed(make: (index: number) => FrameObservation, seconds: number): LinkState {
  const tracker = new LinkTracker();
  for (let i = 0; i < seconds * FPS; i++) tracker.record(make(i));
  return tracker.state();
}

beforeAll(() => loadOpticalModem());

describe('the ladder', () => {
  it('has six rungs numbered like the frame header, with the modem rungs tied to the profiles', () => {
    expect(LADDER.map((r) => r.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(LADDER.filter((r) => r.modem).map((r) => r.modem)).toEqual([...MODEM_PROFILES]);
    // The QR speeds keep their names; the modem rungs do not reuse "Steady", "Balanced" or "Fast".
    for (const rung of LADDER.filter((r) => r.kind !== 'qr')) expect(rung.label).not.toMatch(/Steady|Balanced|^Fast/);
    expect(LADDER[3].label).toBe('Max (experimental)');
    expect(LADDER[4].label).toMatch(/^Max \(experimental\)/);
  });

  it('interleaves with the dense profiles getting most of the airtime, always including the beacon, and is deterministic', () => {
    const cycle = ladderSchedule();
    const count = (id: number) => cycle.filter((p) => p === id).length;
    expect(cycle).toHaveLength(Object.values(DEFAULT_LADDER_WEIGHTS).reduce((a, b) => a + b, 0));
    for (const id of [0, 1, 2, 3, 4]) expect(count(id)).toBe(DEFAULT_LADDER_WEIGHTS[id]);
    expect(count(3) + count(4)).toBeGreaterThan(cycle.length / 2);
    expect(count(0)).toBeGreaterThan(0);
    expect(ladderSchedule()).toEqual(cycle);
    // Pinned: integer arithmetic only, so every engine gives this cycle.
    expect(cycle).toEqual([4, 3, 2, 4, 0, 1, 4, 3, 4, 2, 3, 4]);
  });

  it('spreads equal profiles out rather than bunching them', () => {
    const cycle = ladderSchedule({ 2: 4, 4: 8 });
    expect(cycle).toHaveLength(12);
    const longestRun = cycle.reduce((best, p, i) => (i > 0 && cycle[i - 1] === p ? { run: best.run + 1, max: Math.max(best.max, best.run + 1) } : { run: 1, max: Math.max(best.max, 1) }), { run: 0, max: 0 }).max;
    expect(longestRun).toBeLessThanOrEqual(2);
    expect(ladderSchedule({ 2: 0, 3: -1 })).toEqual([]);
  });

  it('locks to one profile with a beacon one frame in sixteen, and to the beacon alone when asked for P0', () => {
    const locked = lockedSchedule(3);
    expect(locked).toHaveLength(16);
    expect(locked.filter((p) => p === 3)).toHaveLength(15);
    expect(locked.filter((p) => p === 0)).toHaveLength(1);
    expect(lockedSchedule(0)).toEqual([0]);
  });
});

describe('link tracker', () => {
  it('says there is no lock before it has seen anything', () => {
    const empty = new LinkTracker().state();
    expect(empty).toMatchObject({ lockedProfile: null, bytesPerSecond: 0, advice: 'find-screen' });
    expect(linkLabel(empty)).toBe('Optical link: looking for the sender');
    expect(lockLevelText(empty)).toBe('No lock yet');
  });

  it('locks to the densest profile that repairs at least half its blocks, and reports the rate and the camera rate', () => {
    // A cycle of P2, P3, P4 where P4 repairs 2 of 10 blocks (not usable), P3 and P2 all of them.
    const state = feed((i) => [frame(i, 2, 10), frame(i, 3, 10), frame(i, 4, 2)][i % 3], 4);
    expect(state.lockedProfile).toBe(3);
    expect(lockLevelText(state)).toBe('Locked P3');
    expect(state.cameraFps).toBeCloseTo(30, 0);
    // Per second: 10 P2 frames and 10 P3 frames with 10 blocks of 80 bytes, 10 P4 frames with 2.
    expect(state.bytesPerSecond).toBeGreaterThan(15000);
    expect(state.bytesPerSecond).toBeLessThan(18000);
    expect(state.advice).toBe('move-closer');
    expect(linkLabel(state)).toMatch(/^Optical link: 8-colour · 120×67 · 30 Hz · \d+(\.\d)? KB\/s$/);
  });

  it('does not lock on a profile it has seen fewer than three times in the window', () => {
    const state = feed((i) => (i < 2 ? frame(i, 4, 10) : frame(i, 2, 10)), 2);
    expect(state.lockedProfile).toBe(2);
  });

  it('lets old frames age out of the window, so a lost lock shows', () => {
    const tracker = new LinkTracker(3000);
    for (let i = 0; i < 120; i++) tracker.record(frame(i, 3, 10));
    expect(tracker.state().lockedProfile).toBe(3);
    for (let i = 120; i < 300; i++) tracker.record(frame(i, null, 0, 0, 'no-fiducials'));
    const lost = tracker.state();
    expect(lost.lockedProfile).toBeNull();
    expect(lost.bytesPerSecond).toBe(0);
    expect(lost.readableShare).toBe(0);
  });

  it('is quiet at the top of the ladder and when almost every frame is read', () => {
    expect(feed((i) => frame(i, 4, 10), 3).advice).toBe('none');
    expect(feed((i) => frame(i, 2, 10), 3).advice).toBe('none');
  });

  it('advises by what is going wrong: find the screen, brighten it, move closer, hold steady', () => {
    expect(feed((i) => frame(i, null, 0, 0, 'no-fiducials'), 3).advice).toBe('find-screen');
    expect(feed((i) => frame(i, null, 0, 0, 'low-contrast'), 3).advice).toBe('brightness');
    expect(feed((i) => frame(i, null, 0, 0, 'no-header'), 3).advice).toBe('move-closer');
    // Read every time but never repaired: the cells are too small.
    expect(feed((i) => frame(i, 3, 1), 3).advice).toBe('move-closer');
    // Read and repaired on some frames, ruined on others: it is the hand.
    expect(feed((i) => frame(i, 3, i % 2 === 0 ? 10 : 1), 3)).toMatchObject({ lockedProfile: 3, advice: 'none' });
    expect(feed((i) => frame(i, 3, [10, 10, 10, 2, 2, 2][i % 6]), 3)).toMatchObject({ lockedProfile: 3 });
    const shaky = feed((i) => frame(i, 3, i % 7 < 2 ? 10 : 0), 3);
    expect(shaky.lockedProfile).toBeNull();
    expect(shaky.advice).toBe('steady');
    for (const text of Object.values(LINK_ADVICE_TEXT)) expect(text.length).toBeGreaterThan(10);
  });

  it('formats rates in the units of the transfer pages', () => {
    const at = (bytesPerSecond: number): string => linkLabel({ lockedProfile: 3, bytesPerSecond, cameraFps: 59.6, readableShare: 1, advice: 'none' });
    expect(at(820)).toMatch(/60 Hz · 820 B\/s$/);
    expect(at(4560)).toMatch(/4\.6 KB\/s$/);
    expect(at(37400)).toMatch(/37 KB\/s$/);
    expect(at(1_740_000)).toMatch(/1\.74 MB\/s$/);
    expect(linkLabel({ lockedProfile: 3, bytesPerSecond: 1, cameraFps: 60, readableShare: 1, advice: 'none' })).toContain('8-colour · 120×67');
    expect(linkLabel({ lockedProfile: 0, bytesPerSecond: 1, cameraFps: 60, readableShare: 1, advice: 'none' })).toBe('Optical link: looking for the sender');
  });
});

describe('observing real decodes', () => {
  it('turns a decoded frame into an observation, and a failure into a reason', { timeout: 60000 }, () => {
    const profile = MODEM_PROFILES[0];
    const capture = simulateCapture(encodeModemFrame(profile, new Uint8Array(frameCapacity(profile).payloadBytes).fill(9), 1, 7, 4), 'studio', { pixelsPerCell: 6, cellPitch: 4, seed: 1 });
    const read = observeDecode(250, decodeModemFrame(capture));
    expect(read).toEqual({ timeMs: 250, profile: 2, blocksOk: frameCapacity(profile).blocks, blocks: frameCapacity(profile).blocks, packetBytes: profile.packetBytes, failure: null });
    const lost = observeDecode(0, decodeModemFrame({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(180) }));
    expect(lost).toMatchObject({ profile: null, failure: 'no-fiducials' });
  });

  it('names the simulated receivers so each one tops out on a different rung', () => {
    expect(SIMULATED_RECEIVERS.map((r) => r.name)).toEqual(['Basic', 'Good', 'Best']);
    expect(new Set(SIMULATED_RECEIVERS.map((r) => r.widthPx)).size).toBe(3);
  });
});
