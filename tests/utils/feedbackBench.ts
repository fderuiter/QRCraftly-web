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
 * Webcam back channel simulation (#1146): `pnpm run bench:feedback` and the test that guards it.
 *
 * What is real: the Prism frames of the multi-rate sender (dense tiles and beacons, one session across
 * profile switches), the receivers (`PrismReceiver`, which decodes and verifies), the feedback frames
 * (encoded to Base45 and decoded again), and the speed controller. What is a model: which frames a
 * receiver reads. A receiver reads a dense tile with a fixed chance when its camera can read that
 * layer and almost never when it cannot, and reads a beacon with a lower fixed chance at any layer.
 * The back channel is a delay and a loss rate. None of it is a measurement of a camera, a screen or a
 * webcam; it tests the control logic, not the optics. Time is simulated, so the run is repeatable.
 */
import {
  PrismReceiver,
  SPEED_LADDER,
  createMultiRateSender,
  createPrismSession,
  createSpeedController,
  decodeFrame,
  encodeFeedbackFrame,
  switchableProfile,
  type FeedbackLayer,
  type MultiRateProfileName,
  type MultiRateSender,
} from '../../src/packages/optical-transfer/index';
import { createRandom } from './scannerCorpus';

/** A simulated receiver: the densest profile its camera can read. */
export interface BenchReceiver {
  name: string;
  /** The best profile it reads dense tiles of. Faster ones are read only by their beacons. */
  reads: MultiRateProfileName;
}

/** Chance of reading one dense tile the camera can resolve. */
export const DENSE_READ_CHANCE = 0.9;
/** Chance of reading a dense tile the camera cannot resolve. */
export const DENSE_UNREADABLE_CHANCE = 0.02;
/** Chance of reading a beacon, at any profile. */
export const BEACON_READ_CHANCE = 0.7;

export interface BackChannel {
  /** How often a receiver refreshes the feedback code on its screen. */
  intervalMs: number;
  /** From the receiver's screen to a decoded report at the sender: the webcam frame and the decode. */
  latencyMs: number;
  /** Chance that a feedback code is not read. */
  loss: number;
}

/** A webcam seeing a small corner code at 4 reads a second, 150 ms to the decoder, 1 in 5 missed. */
export const DEFAULT_BACK_CHANNEL: BackChannel = { intervalMs: 250, latencyMs: 150, loss: 0.2 };

export type BenchMode =
  /** No back channel: the sender shows one profile until the run ends (the one-way stream). */
  | { kind: 'fixed'; profile: MultiRateProfileName }
  /** The receivers steer the sender and it stops when they are all done. */
  | { kind: 'steered'; start?: MultiRateProfileName };

export interface FeedbackBenchOptions {
  mode: BenchMode;
  receivers: BenchReceiver[];
  fileBytes: number;
  seed: number;
  backChannel?: BackChannel;
  /** Give up after this many simulated seconds. */
  limitSeconds?: number;
}

export interface FeedbackBenchResult {
  /** Every receiver finished before the limit. */
  complete: boolean;
  /** Simulated time each receiver verified the file, in ms (null when it never did). */
  doneAtMs: (number | null)[];
  /** File bytes per second of each receiver, in KB/s (0 when it never finished). */
  goodputKBps: number[];
  /** When the sender stopped, in ms; null when it never did (always for a fixed one-way stream). */
  stoppedAtMs: number | null;
  /** From the last receiver finishing to the sender stopping, in ms; null when it never stopped. */
  stopDelayMs: number | null;
  /** Profile changes: the time and the profile from then on. */
  timeline: { atMs: number; profile: MultiRateProfileName }[];
  /** Feedback codes sent, and how many reached the sender. */
  feedbackSent: number;
  feedbackDelivered: number;
}

const toBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
const rankOf = (name: MultiRateProfileName): number => SPEED_LADDER.indexOf(name) + 1;
const WINDOW_MS = 1000;

interface Sim {
  receiver: PrismReceiver;
  reads: number;
  random: () => number;
  nonce: Uint8Array;
  doneAt: number | null;
  /** Dense tiles shown and read in the last second, with the rank each was shown at. */
  window: { at: number; rank: number; read: boolean }[];
  nextReport: number;
}

/** A random file of a precompressed type, so the message equals the file. */
async function makeSession(fileBytes: number, seed: number) {
  const random = createRandom(seed);
  const file = new Uint8Array(fileBytes);
  for (let i = 0; i < fileBytes; i++) file[i] = Math.floor(random() * 256);
  return { file, session: await createPrismSession(file, { fileName: 'bench.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 20 }) };
}

/**
 * Runs one simulated transfer.
 * @param options - The mode, receivers, file size and seed.
 * @returns What happened.
 */
export async function runFeedbackBench(options: FeedbackBenchOptions): Promise<FeedbackBenchResult> {
  const channel = options.backChannel ?? DEFAULT_BACK_CHANNEL;
  const limitMs = (options.limitSeconds ?? 240) * 1000;
  const { file, session } = await makeSession(options.fileBytes, options.seed);
  const senders = new Map<MultiRateProfileName, MultiRateSender>();
  const senderFor = (name: MultiRateProfileName) => {
    let sender = senders.get(name);
    if (!sender) {
      sender = createMultiRateSender({ message: file, manifest: session.manifest, profile: switchableProfile(name) });
      senders.set(name, sender);
    }
    return sender;
  };

  const first = decodeFrame(senderFor('balanced').frame(0).texts[0]);
  if (!first.ok) throw new Error('The sender made a frame that does not decode.');
  const sessionHex = first.frame.sessionId;
  const sessionBytes = toBytes(sessionHex);

  const random = createRandom(options.seed * 7919 + 1);
  const sims: Sim[] = options.receivers.map((spec, index) => ({
    receiver: new PrismReceiver(),
    reads: rankOf(spec.reads),
    random: createRandom(options.seed * 104729 + index + 1),
    nonce: Uint8Array.from({ length: 4 }, () => Math.floor(random() * 256)),
    doneAt: null,
    window: [],
    nextReport: 0,
  }));

  const steered = options.mode.kind === 'steered';
  const controller = steered ? createSpeedController({ sessionId: sessionHex, initial: options.mode.start ?? 'balanced' }) : null;
  let profile: MultiRateProfileName = options.mode.kind === 'fixed' ? options.mode.profile : (options.mode.start ?? 'balanced');
  const timeline = [{ atMs: 0, profile }];

  /** Reports on their way to the sender, with the time they arrive. */
  const inFlight: { arrivesAt: number; text: string }[] = [];
  let feedbackSent = 0;
  let feedbackDelivered = 0;

  let now = 0;
  let denseSent = 0;
  let sinceSwitch = 0;
  let startIndex = 0;
  let stoppedAt: number | null = null;

  const emit = (sim: Sim) => {
    const cutoff = now - WINDOW_MS;
    sim.window = sim.window.filter((entry) => entry.at > cutoff);
    const shown = sim.window.length;
    const read = sim.window.filter((entry) => entry.read);
    const layerRank = read.reduce((best, entry) => Math.max(best, entry.rank), 0);
    const layer: FeedbackLayer = layerRank === 0 ? 'none' : SPEED_LADDER[layerRank - 1];
    const text = encodeFeedbackFrame({
      sessionId: sessionBytes,
      nonce: sim.nonce,
      fractionDecoded: (sim.receiver.snapshot()?.progress ?? 0) / 100,
      frameSuccessRate: shown === 0 ? 0 : read.length / shown,
      densestLayer: layer,
      done: sim.doneAt !== null,
    });
    feedbackSent += 1;
    if (sim.random() >= channel.loss) inFlight.push({ arrivesAt: now + channel.latencyMs, text });
  };

  while (now < limitMs && stoppedAt === null) {
    const sender = senderFor(profile);
    const p = sender.profile;
    const index = startIndex + sinceSwitch;
    const frame = sender.frame(index);
    sinceSwitch += 1;
    const tiles = frame.kind === 'dense' ? sender.layout.tiles : 1;
    if (frame.kind === 'dense') denseSent += sender.denseSymbols * tiles;

    for (const sim of sims) {
      if (sim.doneAt !== null) continue;
      for (const text of frame.texts) {
        let chance = BEACON_READ_CHANCE;
        if (frame.kind === 'dense') chance = rankOf(profile) <= sim.reads ? DENSE_READ_CHANCE : DENSE_UNREADABLE_CHANCE;
        const read = sim.random() < chance;
        if (frame.kind === 'dense') sim.window.push({ at: now, rank: rankOf(profile), read });
        if (read) sim.receiver.ingest(text);
      }
      if (sim.receiver.isComplete) {
        sim.doneAt = now;
        // The receiver's screen shows "done" at once, not at the next refresh.
        sim.nextReport = now;
      }
    }

    if (controller) {
      for (const sim of sims) {
        // A receiver that has not seen a dense tile has nothing to report yet, except that it is done.
        if (now >= sim.nextReport && (sim.window.length > 0 || sim.doneAt !== null)) {
          emit(sim);
          sim.nextReport = now + channel.intervalMs;
        }
      }
      let decision = controller.tick(now);
      while (inFlight.length > 0 && inFlight[0].arrivesAt <= now) {
        const arrived = inFlight.shift();
        const decoded = arrived ? decodeFrame(arrived.text) : null;
        if (decoded?.ok && decoded.frame.type === 'feedback') {
          feedbackDelivered += 1;
          decision = controller.report(decoded.frame, decoded.frame.sessionId, now);
        }
      }
      if (decision.stop) {
        stoppedAt = now;
      } else if (decision.profile !== profile) {
        profile = decision.profile;
        const next = senderFor(profile);
        const denseIndex = Math.ceil(denseSent / (next.denseSymbols * next.layout.tiles));
        const every = next.profile.beaconEvery;
        startIndex = Math.ceil((denseIndex * every) / (every - 1));
        sinceSwitch = 0;
        timeline.push({ atMs: Math.round(now), profile });
      }
    } else if (sims.every((sim) => sim.doneAt !== null)) {
      break;
    }
    now += 1000 / p.targetFps;
  }

  const doneAtMs = sims.map((sim) => (sim.doneAt === null ? null : Math.round(sim.doneAt)));
  const lastDone = doneAtMs.every((value) => value !== null) ? Math.max(...(doneAtMs as number[])) : null;
  return {
    complete: lastDone !== null,
    doneAtMs,
    goodputKBps: doneAtMs.map((value) => (value === null ? 0 : options.fileBytes / 1000 / (value / 1000))),
    stoppedAtMs: stoppedAt === null ? null : Math.round(stoppedAt),
    stopDelayMs: stoppedAt === null || lastDone === null ? null : Math.round(stoppedAt) - lastDone,
    timeline,
    feedbackSent,
    feedbackDelivered,
  };
}
