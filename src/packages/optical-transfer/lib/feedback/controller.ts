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

/**
 * The speed controller of the webcam back channel (#1146). It takes the receivers' feedback reports
 * and returns the profile to show, adding speed slowly and backing off fast (AIMD), and says when
 * every receiver it can see is done.
 *
 * Privacy: receivers are told apart by their random per-session nonce and by nothing else. The table
 * lives in memory, holds at most {@link MAX_RECEIVERS} entries, and an entry that stops reporting
 * expires. Nothing here touches the network or storage.
 *
 * The sender hook runs it while the person has "Let the receiver steer (preview)" on; it is off
 * otherwise (see `createFeedbackLink`).
 */
import type { FeedbackLayer, FeedbackReport } from '../prism/frame';
import { MULTI_RATE_PROFILES, type MultiRateProfile, type MultiRateProfileName } from '../multicode/multirate';

/** The profiles from slowest to fastest: the ladder the controller climbs. */
export const SPEED_LADDER: readonly MultiRateProfileName[] = ['steady', 'balanced', 'fast'];

/**
 * One symbol size for every rung. The shipped profiles use different sizes, so a sender that
 * switched between them would change the session ID and the receiver would start over; sharing
 * a size keeps one session and one decoder across a switch.
 */
export const SWITCHABLE_SYMBOL_SIZE = 350;

/**
 * A profile that can be switched to or from mid-transfer.
 * @param name - The profile.
 * @returns The profile with the shared symbol size.
 */
export function switchableProfile(name: MultiRateProfileName): MultiRateProfile {
  return { ...MULTI_RATE_PROFILES[name], symbolSize: SWITCHABLE_SYMBOL_SIZE };
}

/** Receivers tracked at once. A new one past this evicts the one heard from longest ago. */
export const MAX_RECEIVERS = 16;
/** A receiver not heard from for this long is forgotten (it moved away, or its screen went off). */
export const RECEIVER_EXPIRY_MS = 5000;
/** After a change, reports are not acted on for this long: they still describe the old speed. */
export const SETTLE_MS = 1500;
/** Every receiver must be reading well for this long before the sender adds speed. */
export const RISE_AFTER_MS = 2000;
/** The wait before the next rise doubles after each back-off, up to this. */
export const MAX_RISE_AFTER_MS = 16000;
/** A frame success rate below this is a struggling receiver. */
export const LOW_SUCCESS = 0.5;
/** A frame success rate at or above this is a healthy one. */
export const GOOD_SUCCESS = 0.8;

/** 0 for nothing dense, then 1 to 3 up the ladder. */
const rankOf = (layer: FeedbackLayer): number => (layer === 'none' ? 0 : SPEED_LADDER.indexOf(layer) + 1);

interface Receiver {
  lastSeen: number;
  rank: number;
  success: number;
  done: boolean;
}

/** What the controller wants the sender to do now. */
export interface ControllerDecision {
  profile: MultiRateProfileName;
  /** True once every receiver in sight is done: stop showing frames. Latched. */
  stop: boolean;
  /** Receivers currently tracked. */
  receivers: number;
}

export interface SpeedControllerOptions {
  /** The session being sent, as 12 hex characters; reports of another session are ignored. */
  sessionId: string;
  /** Where to start. Defaults to Balanced, the default profile. */
  initial?: MultiRateProfileName;
}

export interface SpeedController {
  readonly profile: MultiRateProfileName;
  readonly stopped: boolean;
  readonly receiverCount: number;
  /**
   * Takes one decoded feedback report.
   * @param report - The report.
   * @param sessionId - The session the frame named.
   * @param now - Time in milliseconds on any steady clock.
   * @returns What the sender should do now.
   */
  report(report: FeedbackReport, sessionId: string, now: number): ControllerDecision;
  /**
   * Runs expiry and the rise timer without a report. Call it about every 100 ms while sending.
   * @param now - Time in milliseconds on the same clock.
   * @returns What the sender should do now.
   */
  tick(now: number): ControllerDecision;
}

/**
 * Creates the controller for one send. It follows the weakest receiver: the sender never runs
 * faster than the worst of the receivers it sees can read.
 * - **Back off fast.** A receiver that reads a lower layer than the one sent drops the sender to that
 *   layer at once (one rung when it reads no dense layer at all); one that reads under half the frames
 *   costs one rung. Each back-off doubles the wait
 *   before the next climb.
 * - **Add slowly.** One rung up only after every receiver read the current layer well for
 *   {@link RISE_AFTER_MS} (more after a back-off), then reports are set aside for {@link SETTLE_MS}.
 * @param options - Session and starting profile.
 * @returns The controller.
 */
export function createSpeedController(options: SpeedControllerOptions): SpeedController {
  const table = new Map<string, Receiver>();
  let rung = Math.max(0, SPEED_LADDER.indexOf(options.initial ?? 'balanced'));
  let stopped = false;
  let settleUntil = Number.NEGATIVE_INFINITY;
  let healthySince: number | null = null;
  let riseAfter = RISE_AFTER_MS;

  const decision = (): ControllerDecision => ({ profile: SPEED_LADDER[rung], stop: stopped, receivers: table.size });

  function expire(now: number): void {
    for (const [nonce, receiver] of table) {
      if (now - receiver.lastSeen > RECEIVER_EXPIRY_MS) table.delete(nonce);
    }
  }

  function moveTo(next: number, now: number, backOff: boolean): void {
    if (backOff) riseAfter = Math.min(MAX_RISE_AFTER_MS, riseAfter * 2);
    rung = next;
    settleUntil = now + SETTLE_MS;
    healthySince = null;
  }

  function evaluate(now: number): void {
    expire(now);
    if (stopped || table.size === 0) return;
    const all = [...table.values()];
    if (all.every((receiver) => receiver.done)) {
      stopped = true;
      return;
    }
    if (now < settleUntil) return;
    // A receiver that is done no longer holds the sender back.
    const waiting = all.filter((receiver) => !receiver.done);
    const lowest = Math.min(...waiting.map((receiver) => receiver.rank));
    const current = rung + 1;
    if (lowest < current && rung > 0) {
      // A receiver that reads nothing dense says nothing about which rung it could read: step down one.
      moveTo(Math.max(0, lowest === 0 ? rung - 1 : lowest - 1), now, true);
      return;
    }
    if (rung > 0 && waiting.some((receiver) => receiver.success < LOW_SUCCESS)) {
      moveTo(rung - 1, now, true);
      return;
    }
    const healthy = waiting.every((receiver) => receiver.rank >= current && receiver.success >= GOOD_SUCCESS);
    if (!healthy) {
      healthySince = null;
      return;
    }
    healthySince ??= now;
    if (rung < SPEED_LADDER.length - 1 && now - healthySince >= riseAfter) moveTo(rung + 1, now, false);
  }

  function makeRoom(now: number): void {
    expire(now);
    if (table.size < MAX_RECEIVERS) return;
    let stalest: string | null = null;
    let stalestSeen = Number.POSITIVE_INFINITY;
    for (const [nonce, receiver] of table) {
      if (receiver.lastSeen < stalestSeen) {
        stalest = nonce;
        stalestSeen = receiver.lastSeen;
      }
    }
    if (stalest !== null) table.delete(stalest);
  }

  return {
    get profile() {
      return SPEED_LADDER[rung];
    },
    get stopped() {
      return stopped;
    },
    get receiverCount() {
      return table.size;
    },
    report(report, sessionId, now) {
      if (sessionId !== options.sessionId || stopped) return decision();
      if (!table.has(report.nonce)) makeRoom(now);
      // Keep a done receiver done: a late, reordered frame must not undo it.
      const wasDone = table.get(report.nonce)?.done ?? false;
      table.set(report.nonce, { lastSeen: now, rank: rankOf(report.densestLayer), success: report.frameSuccessRate, done: report.done || wasDone });
      evaluate(now);
      return decision();
    },
    tick(now) {
      evaluate(now);
      return decision();
    },
  };
}
