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
import {
  MAX_RECEIVERS,
  MULTI_RATE_PROFILES,
  RECEIVER_EXPIRY_MS,
  RISE_AFTER_MS,
  SETTLE_MS,
  SWITCHABLE_SYMBOL_SIZE,
  createSpeedController,
  switchableProfile,
  type FeedbackLayer,
  type FeedbackReport,
  type MultiRateProfileName,
} from '../index';

const SESSION = 'aabbccddeeff';

const report = (nonce: string, layer: FeedbackLayer, overrides: Partial<FeedbackReport> = {}): FeedbackReport => ({
  nonce,
  fractionDecoded: 0.2,
  frameSuccessRate: 0.95,
  densestLayer: layer,
  done: false,
  ...overrides,
});

/** Feeds one receiver's healthy report every 250 ms from `from` to `to`, returning the last profile. */
function steady(controller: ReturnType<typeof createSpeedController>, nonce: string, layer: FeedbackLayer, from: number, to: number): MultiRateProfileName {
  let profile = controller.profile;
  for (let t = from; t <= to; t += 250) profile = controller.report(report(nonce, layer), SESSION, t).profile;
  return profile;
}

describe('speed controller (#1146)', () => {
  it('starts at Balanced, the default profile', () => {
    expect(createSpeedController({ sessionId: SESSION }).profile).toBe('balanced');
  });

  it('adds speed slowly: one rung only after a healthy stretch, then waits out the settle time', () => {
    const controller = createSpeedController({ sessionId: SESSION });
    expect(steady(controller, 'aaaa0001', 'balanced', 0, RISE_AFTER_MS - 250)).toBe('balanced');
    expect(steady(controller, 'aaaa0001', 'balanced', RISE_AFTER_MS, RISE_AFTER_MS)).toBe('fast');
    // The top rung is the last one; nothing climbs past it.
    expect(steady(controller, 'aaaa0001', 'fast', RISE_AFTER_MS + 250, 60000)).toBe('fast');
    const slow = createSpeedController({ sessionId: SESSION, initial: 'steady' });
    steady(slow, 'aaaa0001', 'steady', 0, RISE_AFTER_MS);
    expect(slow.profile).toBe('balanced');
    // Reports during the settle time describe the old speed and are not acted on.
    expect(steady(slow, 'aaaa0001', 'steady', RISE_AFTER_MS + 250, RISE_AFTER_MS + SETTLE_MS - 250)).toBe('balanced');
  });

  it('backs off fast: a receiver that reads a lower layer drops the sender to it at once, over several rungs', () => {
    const controller = createSpeedController({ sessionId: SESSION, initial: 'fast' });
    expect(controller.report(report('aaaa0001', 'steady'), SESSION, 0).profile).toBe('steady');
  });

  it('steps down one rung, not to the floor, when a receiver reads no dense layer', () => {
    const controller = createSpeedController({ sessionId: SESSION, initial: 'fast' });
    expect(controller.report(report('aaaa0001', 'none', { frameSuccessRate: 0.05 }), SESSION, 0).profile).toBe('balanced');
  });

  it('backs off one rung when a receiver reads under half the frames, and waits longer before the next climb', () => {
    const controller = createSpeedController({ sessionId: SESSION, initial: 'fast' });
    expect(controller.report(report('aaaa0001', 'fast', { frameSuccessRate: 0.3 }), SESSION, 0).profile).toBe('balanced');
    // Healthy again: the first climb needs more than the base wait.
    steady(controller, 'aaaa0001', 'balanced', SETTLE_MS, SETTLE_MS + RISE_AFTER_MS + 250);
    expect(controller.profile).toBe('balanced');
    steady(controller, 'aaaa0001', 'balanced', SETTLE_MS + RISE_AFTER_MS + 500, SETTLE_MS + 2 * RISE_AFTER_MS + 750);
    expect(controller.profile).toBe('fast');
  });

  it('never drops below Steady', () => {
    const controller = createSpeedController({ sessionId: SESSION, initial: 'steady' });
    expect(controller.report(report('aaaa0001', 'none', { frameSuccessRate: 0 }), SESSION, 0).profile).toBe('steady');
  });

  it('follows the weakest receiver, and a receiver that finished no longer holds it back', () => {
    const controller = createSpeedController({ sessionId: SESSION, initial: 'fast' });
    controller.report(report('aaaa0001', 'fast'), SESSION, 0);
    expect(controller.report(report('bbbb0002', 'steady'), SESSION, 100).profile).toBe('steady');
    controller.report(report('bbbb0002', 'steady', { done: true }), SESSION, 1700);
    expect(controller.profile).toBe('steady');
    // Only the strong receiver is left waiting, and it reads Balanced: no back-off is asked for it.
    expect(controller.report(report('aaaa0001', 'balanced'), SESSION, 1800).stop).toBe(false);
  });

  it('stops as soon as every receiver it can see reports done, and stays stopped', () => {
    const controller = createSpeedController({ sessionId: SESSION });
    controller.report(report('aaaa0001', 'balanced'), SESSION, 0);
    controller.report(report('bbbb0002', 'balanced'), SESSION, 10);
    expect(controller.report(report('aaaa0001', 'balanced', { done: true, fractionDecoded: 1 }), SESSION, 20).stop).toBe(false);
    expect(controller.report(report('bbbb0002', 'balanced', { done: true, fractionDecoded: 1 }), SESSION, 30).stop).toBe(true);
    expect(controller.report(report('cccc0003', 'balanced'), SESSION, 40).stop).toBe(true);
    expect(controller.tick(9999).stop).toBe(true);
  });

  it('does not let a late, reordered frame undo done', () => {
    const controller = createSpeedController({ sessionId: SESSION });
    controller.report(report('aaaa0001', 'balanced', { done: true }), SESSION, 0);
    expect(controller.stopped).toBe(true);
    const two = createSpeedController({ sessionId: SESSION });
    two.report(report('aaaa0001', 'balanced', { done: true }), SESSION, 0);
    two.report(report('bbbb0002', 'balanced'), SESSION, 1);
    two.report(report('aaaa0001', 'balanced', { done: false }), SESSION, 2);
    two.report(report('bbbb0002', 'balanced', { done: true }), SESSION, 3);
    expect(two.stopped).toBe(true);
  });

  it('stops when the only receiver still waiting goes out of sight and the rest are done', () => {
    const controller = createSpeedController({ sessionId: SESSION });
    controller.report(report('bbbb0002', 'balanced'), SESSION, 0);
    controller.report(report('aaaa0001', 'balanced', { done: true }), SESSION, RECEIVER_EXPIRY_MS);
    expect(controller.stopped).toBe(false);
    expect(controller.tick(RECEIVER_EXPIRY_MS + 100).stop).toBe(true);
  });

  it('ignores a report for another session', () => {
    const controller = createSpeedController({ sessionId: SESSION });
    const decision = controller.report(report('aaaa0001', 'balanced', { done: true }), '000000000000', 0);
    expect(decision).toEqual({ profile: 'balanced', stop: false, receivers: 0 });
  });

  it('expires receivers it has not heard from', () => {
    const controller = createSpeedController({ sessionId: SESSION });
    controller.report(report('aaaa0001', 'balanced'), SESSION, 0);
    expect(controller.receiverCount).toBe(1);
    controller.tick(RECEIVER_EXPIRY_MS + 1);
    expect(controller.receiverCount).toBe(0);
  });

  it('keeps bounded memory: a flood of distinct nonces never grows the table past the cap', () => {
    const controller = createSpeedController({ sessionId: SESSION });
    for (let i = 0; i < MAX_RECEIVERS * 5; i++) controller.report(report(i.toString(16).padStart(8, '0'), 'balanced'), SESSION, i);
    expect(controller.receiverCount).toBe(MAX_RECEIVERS);
  });

  it('evicts the receiver heard from longest ago, not the newest', () => {
    const controller = createSpeedController({ sessionId: SESSION });
    for (let i = 0; i < MAX_RECEIVERS; i++) controller.report(report(`0000000${i.toString(16)}`.slice(-8), 'balanced'), SESSION, i);
    controller.report(report('ffffffff', 'balanced'), SESSION, MAX_RECEIVERS);
    // The oldest (nonce 0) was evicted: its done report is a new receiver, and stop needs every one of them done.
    controller.report(report('00000001', 'balanced', { done: true }), SESSION, MAX_RECEIVERS + 1);
    expect(controller.stopped).toBe(false);
  });

  it('gives every rung one symbol size, so a switch keeps one session', () => {
    const sizes = (['steady', 'balanced', 'fast'] as const).map((name) => switchableProfile(name).symbolSize);
    expect(new Set(sizes)).toEqual(new Set([SWITCHABLE_SYMBOL_SIZE]));
    expect(switchableProfile('fast').layoutId).toBe(MULTI_RATE_PROFILES.fast.layoutId);
  });
});
