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
 * Transfer benchmark core (#1139): the erasure channel and the codec trial that
 * `pnpm run bench:transfer` and the regression guard share.
 *
 * Everything here is seeded, so the overhead numbers (frames needed divided by K) are
 * identical between runs and machines. Only the decode times depend on the machine.
 */
import { FecDecoder, FecEncoder, FountainDecoder, FountainEncoder } from '../../src/packages/optical-transfer/index';
import { createRandom } from './scannerCorpus';

/** How frames are lost between the sender's screen and the receiver's decoder. */
export interface ErasureChannel {
  name: string;
  /** Chance that a frame is lost on its own. */
  loss: number;
  /** Bursts: a two-state channel that, once bad, loses frames until it recovers. */
  burst?: { enter: number; exit: number; lossInBad: number };
  /** Chance that a delivered frame arrives a second time (the camera sees it twice). */
  duplicate: number;
  /** The receiver joins the stream at a random frame, not at the start. */
  randomJoin: boolean;
}

export const ERASURE_CHANNELS: readonly ErasureChannel[] = [
  { name: 'clean', loss: 0, duplicate: 0, randomJoin: false },
  { name: 'join', loss: 0, duplicate: 0, randomJoin: true },
  { name: 'loss-10', loss: 0.1, duplicate: 0, randomJoin: true },
  { name: 'loss-30', loss: 0.3, duplicate: 0, randomJoin: true },
  { name: 'burst', loss: 0.02, burst: { enter: 0.03, exit: 0.2, lossInBad: 0.9 }, duplicate: 0, randomJoin: true },
  { name: 'duplicates', loss: 0.1, duplicate: 0.5, randomJoin: true },
];

/** One decode attempt. */
export interface CodecTrial {
  ok: boolean;
  /** Distinct frames that reached the decoder. */
  delivered: number;
  /** Frames the sender showed, from the receiver's join point. */
  transmitted: number;
  /** Time spent inside the decoder, in milliseconds. */
  decodeMs: number;
}

/** A sender never shows more than this many times K before the trial counts as failed. */
const GIVE_UP_FACTOR = 12;

/** A sender and receiver pair, so one trial loop serves the LT code and the outer code. */
interface TrialCodec {
  /** Encodes stream symbol `index` and returns the call that hands it to the decoder. */
  send(index: number): (copies: number) => void;
  readonly isComplete: boolean;
  finalize(): Uint8Array | null;
}

function ltCodec(message: Uint8Array, blockSize: number): TrialCodec {
  const encoder = new FountainEncoder(message, { blockSize });
  const decoder = new FountainDecoder();
  return {
    send(index) {
      const droplet = encoder.getDroplet(encoder.seqForIndex(index));
      return (copies) => {
        for (let copy = 0; copy < copies; copy++) decoder.ingest(droplet, droplet.data);
      };
    },
    get isComplete() {
      return decoder.isComplete;
    },
    finalize: () => decoder.finalize(),
  };
}

function fecCodec(message: Uint8Array, blockSize: number, module: WebAssembly.Module): TrialCodec {
  const encoder = new FecEncoder(module, message, { symbolSize: blockSize });
  const decoder = new FecDecoder(module, encoder.layout);
  return {
    send(index) {
      const { data } = encoder.symbol(index);
      return (copies) => {
        for (let copy = 0; copy < copies; copy++) decoder.addAt(index, data);
      };
    },
    get isComplete() {
      return decoder.isComplete;
    },
    finalize: () => decoder.finalize(),
  };
}

/**
 * Sends a seeded message through the channel until the decoder rebuilds it.
 * @param k - Number of source blocks.
 * @param blockSize - Bytes per block.
 * @param channel - The erasure channel.
 * @param seed - Seed for the message and the channel.
 * @param fecModule - The outer code's module, to run the trial with it instead of the LT code (#1141).
 * @returns What it took.
 */
export function runCodecTrial(k: number, blockSize: number, channel: ErasureChannel, seed: number, fecModule?: WebAssembly.Module): CodecTrial {
  const random = createRandom(seed);
  const message = new Uint8Array(k * blockSize - Math.floor(random() * Math.min(blockSize, 16)));
  for (let i = 0; i < message.length; i++) message[i] = Math.floor(random() * 256);

  const codec = fecModule ? fecCodec(message, blockSize, fecModule) : ltCodec(message, blockSize);
  let index = channel.randomJoin ? Math.floor(random() * 2 * k) : 0;
  let bad = false;
  let delivered = 0;
  let transmitted = 0;
  let decodeMs = 0;

  const limit = GIVE_UP_FACTOR * k;
  while (!codec.isComplete && transmitted < limit) {
    const deliver = codec.send(index++);
    transmitted += 1;
    if (channel.burst) {
      bad = bad ? random() >= channel.burst.exit : random() < channel.burst.enter;
    }
    const lossChance = bad && channel.burst ? channel.burst.lossInBad : channel.loss;
    if (random() < lossChance) continue;
    delivered += 1;
    const copies = random() < channel.duplicate ? 2 : 1;
    const started = performance.now();
    deliver(copies);
    decodeMs += performance.now() - started;
  }

  let ok = false;
  if (codec.isComplete) {
    const started = performance.now();
    const rebuilt = codec.finalize();
    decodeMs += performance.now() - started;
    ok = rebuilt !== null && rebuilt.length === message.length && rebuilt.every((byte, i) => byte === message[i]);
  }
  return { ok, delivered, transmitted, decodeMs };
}

/** Block size the codec benchmark and its regression guard use. */
export const CODEC_BLOCK_SIZE = 64;
/** Largest K the committed baseline covers; the guard re-runs it on every test run. */
export const BASELINE_MAX_K = 1000;

/**
 * How many seeded attempts each K gets: fewer for the sizes that take seconds each.
 * @param k - Number of source blocks.
 * @param quick - The short run the regression guard uses.
 * @returns The trial count.
 */
export function codecTrials(k: number, quick: boolean): number {
  if (quick) return k <= 100 ? 12 : 3;
  if (k <= 100) return 100;
  if (k <= 1000) return 30;
  if (k <= 10000) return 4;
  return 1;
}

/** A summary of many trials of one K over one channel. */
export interface CodecRow {
  /** The code: the LT fountain code, or the outer code (ADR 0037). */
  code: 'lt' | 'fec';
  channel: string;
  k: number;
  blockSize: number;
  trials: number;
  failures: number;
  /** Distinct delivered frames divided by K: the coding overhead (1.0 is perfect). */
  overheadMedian: number;
  overheadP95: number;
  overheadWorst: number;
  /** Frames the sender shows divided by K: overhead plus whatever the channel threw away. */
  transmittedMedian: number;
  decodeMsMedian: number;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)];
}

const round = (value: number, places: number): number => Number(value.toFixed(places));

/**
 * Runs the trials for one (K, channel) cell.
 * @param k - Number of source blocks.
 * @param blockSize - Bytes per block.
 * @param channel - The erasure channel.
 * @param trials - How many seeded attempts.
 * @param fecModule - The outer code's module, to bench it instead of the LT code.
 * @returns The summary row.
 */
export function benchCodec(k: number, blockSize: number, channel: ErasureChannel, trials: number, fecModule?: WebAssembly.Module): CodecRow {
  const overhead: number[] = [];
  const transmitted: number[] = [];
  const times: number[] = [];
  let failures = 0;
  for (let t = 0; t < trials; t++) {
    const trial = runCodecTrial(k, blockSize, channel, 1000 + t * 7919 + k, fecModule);
    if (!trial.ok) {
      failures += 1;
      continue;
    }
    overhead.push(trial.delivered / k);
    transmitted.push(trial.transmitted / k);
    times.push(trial.decodeMs);
  }
  const sortedOverhead = overhead.sort((a, b) => a - b);
  return {
    code: fecModule ? 'fec' : 'lt',
    channel: channel.name,
    k,
    blockSize,
    trials,
    failures,
    overheadMedian: round(percentile(sortedOverhead, 0.5), 3),
    overheadP95: round(percentile(sortedOverhead, 0.95), 3),
    overheadWorst: round(sortedOverhead[sortedOverhead.length - 1] ?? 0, 3),
    transmittedMedian: round(percentile(transmitted.sort((a, b) => a - b), 0.5), 3),
    decodeMsMedian: round(percentile(times.sort((a, b) => a - b), 0.5), 1),
  };
}

/** A camera and screen condition for the optical channel simulator. */
export interface OpticalCondition {
  name: string;
  /** What it stands for on a real device. */
  note: string;
  blurPx?: number;
  noise?: number;
  contrast?: number;
  brightness?: number;
  perspective?: number;
  rotateDeg?: number;
  tear?: { at: number; shiftPx: number };
}

export const OPTICAL_CONDITIONS: readonly OpticalCondition[] = [
  { name: 'ideal', note: 'sharp, level, well lit' },
  { name: 'soft-focus', note: 'slight defocus', blurPx: 1 },
  { name: 'blurry', note: 'motion or poor focus', blurPx: 2 },
  { name: 'grainy', note: 'low light sensor noise', noise: 14 },
  { name: 'dim-screen', note: 'low brightness, washed-out screen', contrast: 0.45, brightness: -25 },
  { name: 'tilted', note: 'phone held at an angle', perspective: 0.15, rotateDeg: 5 },
  { name: 'rolling-shutter', note: 'tear between two screen refreshes', tear: { at: 0.5, shiftPx: 3 } },
];

export interface OpticalResolution {
  name: string;
  width: number;
  height: number;
}

export const OPTICAL_RESOLUTIONS: readonly OpticalResolution[] = [
  { name: '720p', width: 1280, height: 720 },
  { name: '1080p', width: 1920, height: 1080 },
];

/** Throughput tiers from the Prism spec (#1138), in KB/s. */
export function throughputTier(kbPerSecond: number): string {
  if (kbPerSecond >= 1000) return 'tier 3 (1+ MB/s)';
  if (kbPerSecond >= 200) return 'tier 2 (200-500 KB/s)';
  if (kbPerSecond >= 50) return 'tier 1 (50-150 KB/s)';
  return 'below tier 1';
}
