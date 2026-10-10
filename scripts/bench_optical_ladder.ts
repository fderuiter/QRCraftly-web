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
 * Profile ladder benchmark (#1165): `pnpm run bench:optical-ladder [--quick] [--write]`.
 *
 * Three simulated receivers of different quality get the same file from a sender that
 * (a) sends only the best profile that receiver can read (the oracle, the single-profile maximum),
 * (b) interleaves the ladder in a fixed cycle, as a one-way link must, or
 * (c) interleaves until the receiver's lock reaches the sender through a back channel, and then locks.
 * Every frame goes through the real encoder, the channel simulator, the reference decoder and the
 * outer code. The channel is a model of a phone camera, not a measurement of any device, and the QR
 * rungs of the ladder (P0, P1) are not simulated: their airtime is counted as lost to this
 * modem-only receiver, so every figure below is on the low side for a receiver that also reads QR.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_LADDER_WEIGHTS,
  LADDER,
  LinkTracker,
  SIMULATED_RECEIVERS,
  MODEM_PROFILES,
  decodeModemFrame,
  encodeModemFrame,
  frameCapacity,
  ladderSchedule,
  linkLabel,
  loadOpticalModem,
  lockedSchedule,
  observeDecode,
  simulateCapture,
  type SimulatedReceiver,
  type ModemProfile,
} from '../src/packages/optical-modem/index.ts';
import { FountainDecoder, FountainEncoder } from '../src/packages/optical-transfer/index.ts';
import { createFrameTimer } from './utils/frameTimer.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = path.join(root, 'docs', 'OPTICAL_LADDER_BENCHMARK.md');
const SESSION = 20261006;
const CAMERA_FPS = 30;
const PITCH = 4;
/** The droplet size: the largest size that divides every profile's block, so any block carries whole droplets. */
const SYMBOL_BYTES = 16;
/** Time for a lock to reach the sender through the feedback code and for the sender to switch, in camera frames. */
const FEEDBACK_DELAY_FRAMES = 30;
/** Time per captured frame on the receive side. */
const decodeTimer = createFrameTimer();

type Strategy = 'single' | 'ladder' | 'duplex';

interface RunResult {
  frames: number;
  complete: boolean;
  /** Frame at which the sender locked (duplex only). */
  lockedAt: number | null;
  lockedProfile: number | null;
  /** Data bytes of repaired blocks per second, before the outer code, from the lock to the end (or the whole run). */
  steadyBytesPerSecond: number;
  lastLabel: string;
  /** Blocks whose tag refused the inner code's first repair. */
  refused: number;
  /** Blocks returned as repaired whose bytes differ from those sent. Must be zero. */
  wrong: number;
}

function table(header: string[], rows: (string | number)[][]): string {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

function profileById(id: number): ModemProfile | undefined {
  return LADDER.find((r) => r.id === id)?.modem;
}

/** Sends one file to one receiver under one strategy. */
function run(receiver: SimulatedReceiver, strategy: Strategy, bestProfile: number, fileBytes: number, maxFrames: number): RunResult {
  const message = Uint8Array.from({ length: fileBytes }, (_, i) => (i * 131 + 17) & 255);
  const encoder = new FountainEncoder(message, { blockSize: SYMBOL_BYTES });
  const decoder = new FountainDecoder();
  const meta = { k: encoder.k, messageLength: encoder.messageLength, checksum: encoder.checksum };
  const tracker = new LinkTracker();
  let schedule = strategy === 'single' ? lockedSchedule(bestProfile).filter((p) => p !== 0) : ladderSchedule(DEFAULT_LADDER_WEIGHTS);
  let scheduleStart = 0;
  let nextSymbol = 0;
  let lockedAt: number | null = null;
  let lockedProfile: number | null = null;
  const pending: { at: number; profile: number }[] = [];
  let reported: number | null = null;
  let steadyBytes = 0;
  let steadyFrames = 0;
  let refused = 0;
  let wrong = 0;
  for (let frame = 0; frame < maxFrames; frame++) {
    const timeMs = (frame * 1000) / CAMERA_FPS;
    while (pending.length > 0 && pending[0].at <= frame) {
      const { profile } = pending.shift() ?? { profile: 0 };
      schedule = lockedSchedule(profile);
      scheduleStart = frame;
      lockedAt = frame;
      lockedProfile = profile;
    }
    const slot = schedule[(frame - scheduleStart) % schedule.length];
    const profile = profileById(slot);
    const lockedNow = strategy !== 'duplex' || lockedAt !== null;
    let blocksOk = 0;
    if (!profile) {
      // A QR rung: this receiver has no QR path in the simulation, so the frame gives it nothing.
      tracker.record({ timeMs, profile: null, blocksOk: 0, blocks: 0, packetBytes: 0, failure: 'no-fiducials' });
    } else {
      const capacity = frameCapacity(profile);
      const perBlock = profile.packetBytes / SYMBOL_BYTES;
      const first = nextSymbol;
      nextSymbol += capacity.blocks * perBlock;
      const payload = new Uint8Array(capacity.payloadBytes);
      for (let s = 0; s < capacity.blocks * perBlock; s++) payload.set(encoder.getDroplet(encoder.seqForIndex(first + s)).data, s * SYMBOL_BYTES);
      const pixelsPerCell = receiver.widthPx / profile.cols;
      // The frame number in the header is the index of its first droplet, so any profile's blocks name their droplets.
      const capture = simulateCapture(encodeModemFrame(profile, payload, SESSION, first, PITCH), receiver.preset, { pixelsPerCell, cellPitch: PITCH, seed: frame + 1 });
      const result = decodeTimer.time(() => decodeModemFrame(capture, { geometries: [profile] }));
      tracker.record(observeDecode(timeMs, result));
      if (result.ok) {
        refused += result.refused;
        result.blocks.forEach((block, b) => {
          if (!block) return;
          blocksOk++;
          if (!block.every((v, i) => v === payload[b * profile.packetBytes + i])) wrong++;
          for (let j = 0; j < perBlock; j++) decoder.ingest({ seq: encoder.seqForIndex(result.header.seq + b * perBlock + j), ...meta }, block.subarray(j * SYMBOL_BYTES, (j + 1) * SYMBOL_BYTES));
        });
      }
      if (lockedNow) steadyBytes += blocksOk * profile.packetBytes;
    }
    if (lockedNow) steadyFrames++;
    if (decoder.isComplete) return finish(frame + 1, true);
    if (strategy === 'duplex' && lockedAt === null && pending.length === 0 && frame % CAMERA_FPS === CAMERA_FPS - 1) {
      const lock = tracker.state().lockedProfile;
      // The receiver reports a lock once it has held the same profile for a second.
      if (lock !== null && lock === reported) pending.push({ at: frame + FEEDBACK_DELAY_FRAMES, profile: lock });
      reported = lock;
    }
  }
  return finish(maxFrames, false);

  function finish(frames: number, complete: boolean): RunResult {
    return {
      frames,
      complete,
      lockedAt,
      lockedProfile,
      steadyBytesPerSecond: steadyFrames === 0 ? 0 : (steadyBytes * CAMERA_FPS) / steadyFrames,
      lastLabel: linkLabel(tracker.state()),
      refused,
      wrong,
    };
  }
}

/** The highest profile this receiver reads with at least half its blocks, from a few probe frames. */
function bestProfileFor(receiver: SimulatedReceiver): { best: number; shares: Map<number, number> } {
  const shares = new Map<number, number>();
  for (const profile of MODEM_PROFILES) {
    const capacity = frameCapacity(profile);
    let ok = 0;
    for (const seed of [1, 2, 3]) {
      const payload = new Uint8Array(capacity.payloadBytes).fill(seed);
      const capture = simulateCapture(encodeModemFrame(profile, payload, SESSION, seed, PITCH), receiver.preset, { pixelsPerCell: receiver.widthPx / profile.cols, cellPitch: PITCH, seed });
      const result = decodeTimer.time(() => decodeModemFrame(capture, { geometries: [profile] }));
      if (result.ok) ok += result.blocksOk;
    }
    shares.set(profile.id, ok / (3 * capacity.blocks));
  }
  const usable = [...shares.entries()].filter(([, share]) => share >= 0.5).map(([id]) => id);
  return { best: Math.max(...usable), shares };
}

const percent = (x: number): string => `${(x * 100).toFixed(0)}%`;

function main(): void {
  const quick = process.argv.includes('--quick');
  const fileKb = Number(process.argv[process.argv.indexOf('--file-kb') + 1]);
  const fileBytes = Number.isFinite(fileKb) && fileKb > 0 ? fileKb * 1000 : quick ? 4000 : 12000;
  const maxFrames = Math.max(300, Math.ceil(fileBytes / 8));
  const rows: (string | number)[][] = [];
  const capRows: (string | number)[][] = [];
  for (const receiver of SIMULATED_RECEIVERS) {
    const { best, shares } = bestProfileFor(receiver);
    capRows.push([receiver.name, receiver.preset, receiver.widthPx, ...MODEM_PROFILES.map((p) => `${(receiver.widthPx / p.cols).toFixed(1)} px, ${percent(shares.get(p.id) ?? 0)}`), `P${best}`]);
    process.stdout.write(`${receiver.name}: best readable profile P${best}\n`);
    const results = new Map<Strategy, RunResult>();
    for (const strategy of ['single', 'ladder', 'duplex'] as const) {
      const r = run(receiver, strategy, best, fileBytes, maxFrames);
      results.set(strategy, r);
      process.stdout.write(`  ${strategy}: ${r.complete ? `${r.frames} frames` : 'incomplete'}\n`);
    }
    const single = results.get('single') as RunResult;
    for (const strategy of ['single', 'ladder', 'duplex'] as const) {
      const r = results.get(strategy) as RunResult;
      const seconds = r.frames / CAMERA_FPS;
      const goodput = r.complete ? fileBytes / 1000 / seconds : 0;
      const singleGoodput = single.complete ? fileBytes / 1000 / (single.frames / CAMERA_FPS) : 0;
      rows.push([
        receiver.name,
        strategy === 'single' ? `only P${best} (oracle)` : strategy === 'ladder' ? 'interleaved ladder, one way' : 'ladder, then locked by feedback',
        r.complete ? 'yes' : `no, gave up at ${r.frames} frames`,
        r.frames,
        seconds.toFixed(1),
        r.complete ? goodput.toFixed(1) : '-',
        r.complete && singleGoodput > 0 ? percent(goodput / singleGoodput) : '-',
        strategy === 'duplex' && r.lockedAt !== null ? `P${r.lockedProfile} at ${(r.lockedAt / CAMERA_FPS).toFixed(1)} s` : strategy === 'duplex' ? 'never' : '-',
        single.steadyBytesPerSecond > 0 && r.steadyBytesPerSecond > 0 ? `${(r.steadyBytesPerSecond / 1000).toFixed(1)} KB/s, ${percent(r.steadyBytesPerSecond / single.steadyBytesPerSecond)}` : '-',
        r.refused,
        r.wrong,
      ]);
    }
  }
  const report = [
    '# Optical profile ladder benchmark',
    '',
    'Generated by `pnpm run bench:optical-ladder --write`. Every number comes from the channel simulator in `src/packages/optical-modem`, a model of a phone camera and not a measurement of any device. Real-device results come from the probe page ([ADR 0027](adr/0027-optical-channel-probe.md)); until then they are unmeasured.',
    '',
    '## Receivers',
    '',
    `Three simulated receivers. A receiver is a channel preset and the number of camera pixels across the sender's whole frame, so a profile with more columns has smaller cells in the camera: cell size is the frame width over the profile's columns. "Readable" is the share of a profile's blocks repaired over three frames. The cap of a receiver is the densest profile that repairs at least half its blocks.`,
    '',
    table(['Receiver', 'Channel', 'Frame width (px)', ...MODEM_PROFILES.map((p) => `P${p.id}: cell size, blocks repaired`), 'Cap'], capRows),
    '',
    '## Transfers',
    '',
    `A ${(fileBytes / 1000).toFixed(0)} KB file through the outer code, droplets of ${SYMBOL_BYTES} bytes (the largest size that divides every profile's block, so a block of any profile carries whole droplets), one camera frame per frame sent at ${CAMERA_FPS} fps. The ladder cycle is ${ladderSchedule(DEFAULT_LADDER_WEIGHTS).map((p) => `P${p}`).join(' ')}; P0 and P1 are QR rungs that this modem-only receiver cannot use, so ${((DEFAULT_LADDER_WEIGHTS[0] + DEFAULT_LADDER_WEIGHTS[1]) * 100 / ladderSchedule(DEFAULT_LADDER_WEIGHTS).length).toFixed(0)}% of the ladder's airtime is lost to it in this bench. With feedback, the receiver reports a lock after holding the same profile for a second and the sender switches ${FEEDBACK_DELAY_FRAMES} frames later; it then sends only that profile and a beacon one frame in 16. "Steady" is the data rate of repaired blocks (before the outer code) from the lock to the end, against the oracle's. "Refused by tag" counts blocks whose first repair the inner code accepted but whose identity-bound tag ([ADR 0043](adr/0043-optical-modem-block-tag.md)) did not match, so without the tag they would have reached the outer code wrong; "wrong accepts" counts blocks returned as repaired whose bytes differ from those sent, and must be zero.`,
    '',
    table(['Receiver', 'Sender', 'File complete', 'Frames', 'Seconds', 'File goodput KB/s', 'Of the oracle', 'Locked', 'Steady data rate', 'Refused by tag', 'Wrong accepts'], rows),
    '',
  ].join('\n');
  process.stdout.write(`\n${report}\n`);
  process.stdout.write(`${decodeTimer.summary('receive, frame decode')}\n`);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(REPORT_PATH, `${report}\n`, 'utf8');
    process.stdout.write(`wrote ${path.relative(root, REPORT_PATH).split(path.sep).join('/')}\n`);
  }
}

await loadOpticalModem();
main();
