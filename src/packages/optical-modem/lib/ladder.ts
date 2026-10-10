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

import type { ChannelPreset } from './channel';
import type { DecodedFrame, DecodeFailure } from './codec';
import { constellationShape } from './constellation';
import { MODEM_PROFILES, type ModemProfile } from './profile';

/** One step of the profile ladder (#1161). */
export interface LadderRung {
  /** The number in the frame header: 0 to 5. */
  id: number;
  /** What the person is told. P2 to P4 stay "experimental" until real-device numbers are in. */
  label: string;
  kind: 'qr' | 'modem' | 'experimental';
  /** Frame shape of a modem rung. */
  modem?: ModemProfile;
}

/**
 * The ladder. P0 and P1 are the QR modes of Prism Stage A and are not drawn by this package; P2
 * to P4 are the modem profiles; P5 is the temporal research idea (#1166) and is not built.
 * "Steady", "Balanced" and "Fast" stay the names of the QR speeds (#1062); the modem rungs have
 * their own labels so the two sets of names never mean different things.
 */
export const LADDER: readonly LadderRung[] = [
  { id: 0, label: 'QR beacon', kind: 'qr' },
  { id: 1, label: 'QR codes (Steady, Balanced or Fast)', kind: 'qr' },
  { id: 2, label: '4-colour (experimental)', kind: 'modem', modem: MODEM_PROFILES[0] },
  { id: 3, label: 'Max (experimental)', kind: 'modem', modem: MODEM_PROFILES[1] },
  { id: 4, label: 'Max (experimental), densest', kind: 'modem', modem: MODEM_PROFILES[2] },
  { id: 5, label: 'Temporal modulation (research)', kind: 'experimental' },
];

/**
 * Airtime shares of one cycle: the dense profiles get most of it, the beacon always gets some so a
 * receiver can join at any time. These are a starting point, set without a device measurement.
 */
export const DEFAULT_LADDER_WEIGHTS: Readonly<Record<number, number>> = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 5 };

/**
 * One cycle of the sender's interleave, as profile numbers, one per frame. It is a smooth weighted
 * round-robin: integer arithmetic only, so every engine produces the same cycle, and equal profiles
 * are spread out rather than bunched, so a receiver sees its best profile at a steady pace.
 * @param weights - Frames per cycle for each profile number; zero or missing leaves a profile out.
 * @returns The cycle; its length is the sum of the weights.
 */
export function ladderSchedule(weights: Readonly<Record<number, number>> = DEFAULT_LADDER_WEIGHTS): number[] {
  const entries = Object.entries(weights)
    .map(([id, weight]) => ({ id: Number(id), weight: Math.floor(weight) }))
    .filter((e) => Number.isInteger(e.id) && e.weight > 0)
    .sort((a, b) => a.id - b.id);
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  const credit = entries.map(() => 0);
  const cycle: number[] = [];
  for (let slot = 0; slot < total; slot++) {
    let best = 0;
    entries.forEach((e, i) => {
      credit[i] += e.weight;
      if (credit[i] > credit[best]) best = i;
    });
    credit[best] -= total;
    cycle.push(entries[best].id);
  }
  return cycle;
}

/** One frame in this many is a beacon when the sender is locked to a profile. */
export const LOCKED_BEACON_EVERY = 16;

/**
 * The cycle after the sender locks to one profile, by the person's tap or by the receiver's
 * feedback (the optional duplex of #1146). Almost all airtime goes to that profile; the beacon
 * stays, so a second receiver can still join.
 * @param profile - The locked profile number.
 * @returns The cycle.
 */
export function lockedSchedule(profile: number): number[] {
  return ladderSchedule(profile === 0 ? { 0: 1 } : { 0: 1, [profile]: LOCKED_BEACON_EVERY - 1 });
}

/** A simulated receiver: a channel and how many camera pixels span the sender's whole frame. */
export interface SimulatedReceiver {
  name: string;
  preset: ChannelPreset;
  /** A profile's cell size in camera pixels is this over its columns. */
  widthPx: number;
}

/**
 * Receivers of three qualities for the simulator, chosen so that each one's densest readable
 * profile is a different rung (P2, P3 and P4) in `docs/OPTICAL_LADDER_BENCHMARK.md`. They are
 * model parameters, not measured devices.
 */
export const SIMULATED_RECEIVERS: readonly SimulatedReceiver[] = [
  { name: 'Basic', preset: 'typical', widthPx: 440 },
  { name: 'Good', preset: 'typical', widthPx: 520 },
  { name: 'Best', preset: 'studio', widthPx: 640 },
];

/** What the receiver saw in one camera frame. */
export interface FrameObservation {
  /** Time of the camera frame, in milliseconds. */
  timeMs: number;
  /** Profile number from the header, or null when the frame was not read. */
  profile: number | null;
  /** Inner code blocks repaired. */
  blocksOk: number;
  /** Inner code blocks in the frame. */
  blocks: number;
  /** Data bytes in each block. */
  packetBytes: number;
  /** Why the frame was not read. */
  failure: DecodeFailure | null;
}

/**
 * Turns a decode result into an observation.
 * @param timeMs - Time of the camera frame.
 * @param result - What `decodeModemFrame` returned.
 * @returns The observation.
 */
export function observeDecode(timeMs: number, result: DecodedFrame): FrameObservation {
  if (!result.ok) return { timeMs, profile: null, blocksOk: 0, blocks: 0, packetBytes: 0, failure: result.reason };
  return { timeMs, profile: result.header.profile, blocksOk: result.blocksOk, blocks: result.blocks.length, packetBytes: result.header.packetBytes, failure: null };
}

/** What would raise the link, in the order the receiver offers it. */
export type LinkAdvice = 'find-screen' | 'brightness' | 'move-closer' | 'steady' | 'none';

/** Words for each advice code. */
export const LINK_ADVICE_TEXT: Readonly<Record<LinkAdvice, string>> = {
  'find-screen': "Point the camera at the sender's screen so all four corners show.",
  brightness: "Turn the sender's screen brightness up.",
  'move-closer': 'Move closer, or zoom in, so each coloured cell is bigger in the camera.',
  steady: 'Hold steady, or prop the phone against something.',
  none: 'This is the best the sender is offering.',
};

/** The live link, as the receiver shows it. */
export interface LinkState {
  /** The best profile that reads reliably, or null when none does yet. */
  lockedProfile: number | null;
  /** Data rate of repaired blocks over the window, in bytes per second, before the outer code's overhead. */
  bytesPerSecond: number;
  /** Camera frames per second over the window. */
  cameraFps: number;
  /** Share of camera frames whose header was read, 0 to 1. */
  readableShare: number;
  advice: LinkAdvice;
}

/** Share of a profile's blocks that must repair, on average, for the profile to count as locked. */
export const LOCK_BLOCK_SHARE = 0.5;
/** Frames of a profile the receiver needs to have seen in the window before it counts as locked. */
export const LOCK_MIN_FRAMES = 3;
/** Highest modem profile on the ladder. */
const TOP_MODEM_PROFILE = 4;

/**
 * Keeps the last few seconds of what the receiver saw and says which profile it has locked, what
 * the data rate is and what might raise it. The thresholds are heuristics set on the simulator and
 * are not validated on a device.
 */
export class LinkTracker {
  private observations: FrameObservation[] = [];

  /**
   * @param windowMs - How far back the state looks, in milliseconds.
   */
  private readonly windowMs: number;

  constructor(windowMs = 3000) {
    this.windowMs = windowMs;
  }

  /**
   * Adds a camera frame.
   * @param observation - What the receiver saw.
   */
  record(observation: FrameObservation): void {
    this.observations.push(observation);
    const cutoff = observation.timeMs - this.windowMs;
    while (this.observations.length > 1 && this.observations[0].timeMs < cutoff) this.observations.shift();
  }

  /**
   * The link as of the last frame recorded.
   * @returns The state.
   */
  state(): LinkState {
    const frames = this.observations;
    const empty: LinkState = { lockedProfile: null, bytesPerSecond: 0, cameraFps: 0, readableShare: 0, advice: 'find-screen' };
    if (frames.length < 2) return empty;
    const first = frames[0].timeMs;
    const last = frames[frames.length - 1].timeMs;
    const span = Math.max(1, last - first);
    const readable = frames.filter((f) => f.profile !== null);
    const perProfile = new Map<number, FrameObservation[]>();
    for (const f of readable) perProfile.set(f.profile as number, [...(perProfile.get(f.profile as number) ?? []), f]);
    const share = (list: FrameObservation[]): number => {
      const blocks = list.reduce((s, f) => s + f.blocks, 0);
      return blocks === 0 ? 0 : list.reduce((s, f) => s + f.blocksOk, 0) / blocks;
    };
    let locked: number | null = null;
    for (const [profile, list] of perProfile) {
      if (list.length >= LOCK_MIN_FRAMES && share(list) >= LOCK_BLOCK_SHARE && (locked === null || profile > locked)) locked = profile;
    }
    const bytes = readable.reduce((s, f) => s + f.blocksOk * f.packetBytes, 0);
    const readableShare = readable.length / frames.length;
    return {
      lockedProfile: locked,
      // The window is as long as the frames it holds, but never counted shorter than one second.
      bytesPerSecond: (bytes * 1000) / Math.max(1000, span),
      cameraFps: ((frames.length - 1) * 1000) / span,
      readableShare,
      advice: this.adviceFor(locked, readableShare, perProfile, share),
    };
  }

  private adviceFor(locked: number | null, readableShare: number, perProfile: Map<number, FrameObservation[]>, share: (list: FrameObservation[]) => number): LinkAdvice {
    // Frames of a denser profile that were read but not repaired: intermittent damage means shake, steady damage means small cells.
    const denser = [...perProfile.keys()].filter((p) => locked === null || p > locked);
    if (denser.length > 0 && (locked === null ? readableShare >= 0.3 : true)) {
      const list = perProfile.get(Math.max(...denser)) ?? [];
      const shares = list.map((f) => (f.blocks === 0 ? 0 : f.blocksOk / f.blocks));
      const mixed = shares.length >= 2 && Math.min(...shares) < LOCK_BLOCK_SHARE && Math.max(...shares) >= 0.75;
      return mixed || share(list) >= LOCK_BLOCK_SHARE ? 'steady' : 'move-closer';
    }
    if (locked !== null) return locked >= TOP_MODEM_PROFILE || readableShare >= 0.9 ? 'none' : 'move-closer';
    const counts = new Map<DecodeFailure, number>();
    for (const f of this.observations) if (f.failure) counts.set(f.failure, (counts.get(f.failure) ?? 0) + 1);
    const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? [null];
    return top === 'low-contrast' ? 'brightness' : top === 'no-header' ? 'move-closer' : 'find-screen';
  }
}

/**
 * Formats a data rate in the units of the transfer pages (1 KB is 1000 bytes).
 * @param bytesPerSecond - Rate.
 * @returns For example "820 B/s", "37 KB/s" or "1.74 MB/s".
 */
export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1000) return `${Math.round(bytesPerSecond)} B/s`;
  if (bytesPerSecond < 1_000_000) return `${bytesPerSecond < 10_000 ? (bytesPerSecond / 1000).toFixed(1) : Math.round(bytesPerSecond / 1000)} KB/s`;
  return `${(bytesPerSecond / 1_000_000).toFixed(2)} MB/s`;
}

/**
 * The one-line link display, in the form the spec gives.
 * @param state - The link state.
 * @returns For example "Optical link: 8-colour · 120×67 · 30 Hz · 37 KB/s", or a line saying there is no lock yet.
 */
export function linkLabel(state: LinkState): string {
  const rung = LADDER.find((r) => r.id === state.lockedProfile);
  if (!rung?.modem) return 'Optical link: looking for the sender';
  const colours = constellationShape(rung.modem.constellation).size;
  return `Optical link: ${colours}-colour · ${rung.modem.cols}×${rung.modem.rows} · ${Math.round(state.cameraFps)} Hz · ${formatRate(state.bytesPerSecond)}`;
}

/**
 * The large lock level the receiver shows, which a person at the sender can read out.
 * @param state - The link state.
 * @returns For example "Locked P3", or "No lock yet".
 */
export function lockLevelText(state: LinkState): string {
  return state.lockedProfile === null ? 'No lock yet' : `Locked P${state.lockedProfile}`;
}
