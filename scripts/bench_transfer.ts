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
 * File transfer benchmark (#1139): `pnpm run bench:transfer [options]`.
 *
 * Two parts, both seeded so the numbers are repeatable:
 *   1. Codec: the fountain codec through an erasure channel (random loss, bursts, duplicate
 *      frames, joining mid-stream). Reports frames needed divided by K and the decode time.
 *   2. Optical: real QR frames of a BC-UR part, degraded the way a phone camera degrades them
 *      (blur, noise, dim screen, tilt, rolling-shutter tear) at 720p and 1080p, decoded with
 *      our reader (qr-decode, #1178). Reports the decode rate and an estimated throughput with its spec tier.
 *
 * The optical part is a Node-side estimate. It cannot see a real screen, lens or shutter, so
 * `docs/TRANSFER_DEVICE_CHECKLIST.md` lists what to measure on phones.
 *
 * Options:
 *   --quick          Small K and few frames (seconds); what the regression guard uses.
 *   --max-k <n>      Largest K for the codec part (default 10000; 50000 takes minutes).
 *   --no-optical     Codec part only.
 *   --no-tiles       Skip the multi-code (tiled) simulation, which takes a few minutes.
 *   --write          Write `docs/TRANSFER_BENCHMARK.md` and, with --baseline, the baseline file.
 *   --baseline       Also refresh `tests/fixtures/transfer-baseline.json` (overhead only, quick trials).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrEncoder as QRCode } from '../tests/fixtures/qrEncoder';
import { qrReader } from '../tests/fixtures/qrReader';
import { BcUrEncoder } from '../src/packages/optical-transfer/bcur.ts';
import {
  TILE_LAYOUTS,
  loadFecModule,
  TRANSFER_DENSITY_PROFILES,
  modulePxFor,
  prismSymbolSize,
  type TileLayoutId,
  type TransferDensity,
} from '../src/packages/optical-transfer/index.ts';
import { renderCorpusFrame } from '../tests/utils/scannerCorpus.ts';
import {
  measureDecoderPool,
  measureTrackedReads,
  runTearScenario,
  runTileTransfer,
  type PoolMeasurement,
  type TearResult,
  type TileRunResult,
  type TrackedMeasurement,
} from '../tests/utils/tileBench.ts';
import {
  ERASURE_CHANNELS,
  OPTICAL_CONDITIONS,
  OPTICAL_RESOLUTIONS,
  BASELINE_MAX_K,
  CODEC_BLOCK_SIZE,
  benchCodec,
  codecTrials,
  throughputTier,
  type CodecRow,
} from '../tests/utils/transferBench.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = path.join(REPO_ROOT, 'docs', 'TRANSFER_BENCHMARK.md');
const BASELINE_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'transfer-baseline.json');
const BLOCK_SIZE = CODEC_BLOCK_SIZE;
const OPTICAL_BLOCK_SIZES = [128, 256, 512];
const OPTICAL_FRAMES = 8;
const FILE_SIZES = [
  { label: '12 KB', bytes: 12 * 1024 },
  { label: '256 KB', bytes: 256 * 1024 },
  { label: '2 MB', bytes: 2 * 1024 * 1024 },
  { label: '20 MB', bytes: 20 * 1024 * 1024 },
];

interface OpticalRow {
  condition: string;
  resolution: string;
  blockSize: number;
  /** QR modules per side. */
  modules: number;
  modulePx: number;
  decodeRate: number;
  decodeMsMedian: number;
  /** Estimated KB/s at 30 and 60 frames per second. */
  kbps30: number;
  kbps60: number;
  tier60: string;
}

function benchOptical(quick: boolean): OpticalRow[] {
  const rows: OpticalRow[] = [];
  const message = new Uint8Array(512 * 64).map((_, i) => (i * 2654435761) >>> 24);
  const frames = quick ? 3 : OPTICAL_FRAMES;
  const conditions = quick ? OPTICAL_CONDITIONS.slice(0, 3) : OPTICAL_CONDITIONS;
  for (const resolution of OPTICAL_RESOLUTIONS) {
    for (const blockSize of OPTICAL_BLOCK_SIZES) {
      // A real BC-UR part carries one block in the same `ur:bytes/` framing the old droplets used.
      const encoder = new BcUrEncoder('bytes', message, blockSize);
      const texts = Array.from({ length: frames * 3 + 2 }, () => encoder.nextPart().toUpperCase());
      for (const condition of conditions) {
        let decoded = 0;
        let modules = 0;
        let modulePx = 0;
        const times: number[] = [];
        for (let i = 0; i < frames; i++) {
          const text = texts[i * 3 + 1];
          // The sender fills the screen, so the code takes about 90% of the frame height.
          const side = resolution.height * 0.9;
          const count = QRCode.create(text, { errorCorrectionLevel: 'L' }).modules.size;
          modulePx = Math.max(1, Math.floor(side / (count + 8)));
          const frame = renderCorpusFrame({
            text,
            errorCorrection: 'L',
            modulePx,
            width: resolution.width,
            height: resolution.height,
            seed: 100 + i,
            blurPx: condition.blurPx,
            noise: condition.noise,
            contrast: condition.contrast,
            brightness: condition.brightness,
            perspective: condition.perspective,
            rotateDeg: condition.rotateDeg,
            tear: condition.tear,
          });
          const started = performance.now();
          const [result] = qrReader.read(frame.data, frame.width, frame.height);
          times.push(performance.now() - started);
          if (result?.text === text) decoded += 1;
          modules = Math.max(modules, count);
        }
        times.sort((a, b) => a - b);
        const rate = decoded / frames;
        const medianMs = times[Math.floor(times.length / 2)] ?? 0;
        // A phone cannot decode faster than the decoder allows, whatever the camera rate.
        const decodeFps = medianMs > 0 ? 1000 / medianMs : Infinity;
        const kbps = (fps: number) => Number(((Math.min(fps, decodeFps) * rate * blockSize) / 1.1 / 1000).toFixed(1));
        rows.push({
          condition: condition.name,
          resolution: resolution.name,
          blockSize,
          modules,
          modulePx,
          decodeRate: Number(rate.toFixed(2)),
          decodeMsMedian: Number(medianMs.toFixed(1)),
          kbps30: kbps(30),
          kbps60: kbps(60),
          tier60: throughputTier(kbps(60)),
        });
      }
    }
  }
  return rows;
}


interface TileScenario {
  name: string;
  layoutId: TileLayoutId;
  frame: { width: number; height: number };
  hold: number;
  staggered: boolean;
  cameraFps: number;
  bytes: number;
  tear?: boolean;
}

const FRAME_1080 = { width: 1920, height: 1080 };
const FRAME_720 = { width: 1280, height: 720 };

const TILE_SCENARIOS: readonly TileScenario[] = [
  { name: 'mono 2x2 v25, 1080p, 30 fps', layoutId: '2x2-v25', frame: FRAME_1080, hold: 2, staggered: true, cameraFps: 30, bytes: 400_000 },
  { name: '1 x v40, 1080p, 30 fps', layoutId: '1xv40', frame: FRAME_1080, hold: 2, staggered: false, cameraFps: 30, bytes: 300_000 },
  { name: '3x2 v20, 1080p, 30 fps', layoutId: '3x2-v20', frame: FRAME_1080, hold: 2, staggered: true, cameraFps: 30, bytes: 400_000 },
  { name: '2x2 v20, 720p, 30 fps', layoutId: '2x2-v20', frame: FRAME_720, hold: 2, staggered: true, cameraFps: 30, bytes: 200_000 },
  { name: 'mono 2x2 v25, 1080p, 60 fps (hold 1)', layoutId: '2x2-v25', frame: FRAME_1080, hold: 1, staggered: false, cameraFps: 60, bytes: 400_000 },
  { name: '2x2 v25, torn every frame, staggered', layoutId: '2x2-v25', frame: FRAME_1080, hold: 2, staggered: true, cameraFps: 30, bytes: 200_000, tear: true },
  { name: '2x2 v25, torn every frame, not staggered', layoutId: '2x2-v25', frame: FRAME_1080, hold: 2, staggered: false, cameraFps: 30, bytes: 200_000, tear: true },
];

interface TileRow extends TileScenario {
  modulePx: number;
  result: TileRunResult;
}

async function benchTiles(quick: boolean): Promise<TileRow[]> {
  const rows: TileRow[] = [];
  for (const scenario of quick ? TILE_SCENARIOS.slice(0, 2) : TILE_SCENARIOS) {
    const layout = TILE_LAYOUTS[scenario.layoutId];
    const modulePx = modulePxFor(layout, scenario.frame);
    const bytes = quick ? Math.round(scenario.bytes / 8) : scenario.bytes;
    const result = await runTileTransfer({ ...scenario, bytes, screen: { frame: scenario.frame, modulePx }, refreshHz: 60 });
    rows.push({ ...scenario, bytes, modulePx, result });
    process.stdout.write(`tiles ${scenario.name}: ${result.complete ? `${result.goodputKBps} KB/s in ${result.cameraFrames} frames` : 'did not finish'}, crop ${result.cropMsMedian} ms\n`);
  }
  return rows;
}

interface TearRow {
  layoutId: TileLayoutId;
  staggered: boolean;
  result: TearResult;
}

async function benchTears(quick: boolean): Promise<TearRow[]> {
  const rows: TearRow[] = [];
  for (const layoutId of ['2x2-v25', '3x2-v20', '1xv40'] as const) {
    const modulePx = modulePxFor(TILE_LAYOUTS[layoutId], FRAME_1080);
    for (const staggered of [true, false]) {
      const result = await runTearScenario(layoutId, { frame: FRAME_1080, modulePx }, 2, staggered, quick ? 3 : 9);
      rows.push({ layoutId, staggered, result });
      process.stdout.write(`tear ${layoutId} ${staggered ? 'staggered' : 'not staggered'}: worst ${result.worst}, mean ${result.mean}\n`);
    }
  }
  return rows;
}

const TILE_STATUS = `### What this proves and what it does not (#1142)

| Criterion                                                  | Bench result                                                                                                  | Status                                                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Mono 2x2 v25, 1080p, 30 fps, at least 100 KB/s            | 134.8 KB/s in the simulation                                                                                  | Met in the simulation only. A real camera, lens and screen are not in it.                                        |
| 1 x v40 at least 60 KB/s                                   | 78.9 KB/s in the simulation                                                                                   | Met in the simulation only.                                                                                      |
| Staggered refresh keeps at least 50% of tiles per torn frame | 2x2 v25: worst 75%, mean 78% (together: worst 50%, mean 56%). 3x2 v20: worst 67%.                             | Met for the tiled layouts. A single code (1 x v40) cannot stagger: a tear through it loses it.                   |
| At least 120 decodes per second without dropping UI frames | Our reader: see the decoder threads table above. Main thread lag at most 6 ms. | Not shown. This is a desktop-class core, not a mid-range phone, and Node has no browser UI thread. |
| Hold is a whole number of refreshes                        | Unit test with a stepped frame clock (\`multicode.test.ts\`)                                                    | Met, tested.                                                                                                     |
| Scanner page behaviour unchanged                           | No scanner file changed; the new code is imported by nothing in the app                                       | Met by construction.                                                                                             |

Not measured at all: a real camera's focus, exposure and rolling shutter; whether a phone resolves 4 px modules; how often tracking is lost with a hand-held phone (the crop margin is 3 modules, so a camera that drifts more than that between frames falls back to a full search); decoding in browser workers on a phone; thermal throttling; and the receiver's capture request and \`requestVideoFrameCallback\` (not built yet). The 60 fps row assumes a camera that really captures 60 distinct frames per second. The full search here scans layout hypotheses, reading one code per crop, so its cost is not the cost of our reader's multi-code read. The device list is in [the device checklist](TRANSFER_DEVICE_CHECKLIST.md).`;

function renderTiles(tiles: TileRow[], tears: TearRow[], pool: PoolMeasurement[], tracked: TrackedMeasurement): string[] {
  const parts: string[] = ['## Multi-code frames (#1142)', ''];
  parts.push(
    'Several QR codes ("tiles") per frame, error correction L, a 60 Hz display held for 2 refreshes (30 fps) and a camera frame the same size as the screen. Real Prism frames, QR codes, pixels, decodes with our reader (qr-decode), tile tracking, dedup and receiver; simulated display and camera. The camera is sharp, level and in sync with the display (except in the two torn rows), so these rates are an upper bound for the code and the decode chain, not a prediction for a phone. Goodput is file bytes divided by the simulated camera time until the receiver verified the file, manifest and coding overhead included. The bench reads one code per crop, so the full search is a scan over layout hypotheses; one search runs per transfer and tracked frames decode crops only.',
    ''
  );
  parts.push(
    table(
      ['Scenario', 'Module px', 'File', 'Camera frames', 'Goodput', 'Searches', 'Tile reads', 'Dedup dropped', 'Crop decode (median)'],
      tiles.map((r) => [
        r.name,
        r.modulePx,
        `${Math.round(r.bytes / 1000)} KB`,
        r.result.cameraFrames,
        r.result.complete ? `${r.result.goodputKBps} KB/s` : 'did not finish',
        r.result.searches,
        r.result.decodes,
        r.result.duplicates,
        `${r.result.cropMsMedian} ms`,
      ])
    ),
    ''
  );
  parts.push('### Torn frames', '');
  parts.push(
    'A torn frame shows one picture above a row and the next picture below it. Each row below tears a 1080p frame at 9 rows spread over the codes, at every refresh where something changes, and counts the tiles whose own decode still returns a valid frame of the old or the new picture. "Staggered" changes the two diagonal groups on alternate refreshes; "not staggered" changes every tile together.',
    ''
  );
  parts.push(
    table(
      ['Layout', 'Schedule', 'Tiles kept, worst case', 'Tiles kept, mean', 'Tears tried'],
      tears.map((r) => [r.layoutId, r.staggered ? 'staggered' : 'together', `${Math.round(r.result.worst * 100)}%`, `${Math.round(r.result.mean * 100)}%`, r.result.positions])
    ),
    ''
  );
  parts.push('### Decoder threads', '');
  parts.push(
    'Real worker threads (Node `worker_threads`) each decode one 2x2 v25 tile crop from a 1080p frame with our reader (qr-decode) in a loop. "Main thread lag" is the longest gap in a 16 ms timer on the main thread while they ran. This is this machine, loaded by other work, with 4 logical cores; it says nothing about a phone CPU or a browser UI thread.',
    ''
  );
  parts.push(table(['Workers', 'Crop decodes per second', 'Main thread lag (max)'], pool.map((r) => [r.workers, r.decodesPerSecond, `${r.mainThreadMaxLagMs} ms`])), '');
  parts.push('### Fast path for tracked tiles (#1178)', '');
  parts.push(
    'Once a tile has been found, the receiver knows its corners, version and level, so our reader can sample its grid directly instead of searching (`readTracked`). One thread, the same 2x2 v25 crop as above, and the whole 1080p frame with all four tiles read in one call (the frame is copied into the module once per call).',
    ''
  );
  parts.push(
    table(
      ['Read', 'Per second'],
      [
        ['Full read of the crop (search and decode)', tracked.fullPerSecond],
        ['Fast path, same crop', tracked.trackedPerSecond],
        ['Fast path, whole 1080p frame, 4 tiles per call (tiles)', tracked.frameTilesPerSecond],
      ]
    ),
    '',
    `On the same crop the fast path is ${(tracked.trackedPerSecond / tracked.fullPerSecond).toFixed(1)} times as fast as a full read (the bar in #1178 is 3 times). The receiver does not use it yet; #1142 switches its tracked frames over.`,
    ''
  );
  parts.push(TILE_STATUS, '');
  return parts;
}

const READING_NOTES = `## Reading these numbers

- The coding overhead is the part a better code can improve. It is the "Frames needed" column, and it is the number to compare when a new code lands (#1141).
- Decode time grows much faster than K. A decoder that peels most blocks and then falls back to Gaussian elimination is cheap at 1,000 blocks and slow at 50,000. A large file needs either bigger blocks (a smaller K) or a faster decoder.
- The optical estimate is bounded by how many frames per second one decode can handle, so a single code per frame cannot reach the upper tiers on its own. That is the case for multi-code frames (#1142) and a faster decoder.
- One pass of our reader (qr-decode) fails on the tilted rows. The shipped scanner tries several strategies, so these rows measure the simulator's floor, not the app's.
`;

function table(headers: string[], body: Array<Array<string | number>>): string {
  const line = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...body.map(line)].join('\n');
}

function formatSeconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(1)} ms`;
}

/**
 * Payload bytes per frame of the `ur:bytes/` droplets (ADR 0014) at each density, measured for a
 * 256 KB file before #1149 removed that format. Kept as the comparison for Prism.
 */
const UR_BYTES_PAYLOAD: Readonly<Record<TransferDensity, number>> = { reliable: 27, balanced: 98, fast: 150 };

/** Payload bytes per frame at each density: the old `ur:bytes/` framing against Prism. */
function capacityRows(): Array<Array<string | number>> {
  return (Object.keys(TRANSFER_DENSITY_PROFILES) as TransferDensity[]).map((density) => {
    const { errorCorrectionLevel, maxVersion } = TRANSFER_DENSITY_PROFILES[density];
    const old = UR_BYTES_PAYLOAD[density];
    const prism = prismSymbolSize(errorCorrectionLevel, maxVersion);
    return [density, `${errorCorrectionLevel}, version ${maxVersion}`, `${old} B`, `${prism} B`, `${(prism / old).toFixed(2)}x`];
  });
}

function render(codec: CodecRow[], optical: OpticalRow[], tileSection: string[]): string {
  const parts: string[] = [];
  parts.push('# File transfer benchmark', '');
  parts.push(
    'Generated by `pnpm run bench:transfer --write`. Overhead numbers are seeded and repeatable. Decode times and the optical part depend on the machine and are estimates; see [the device checklist](TRANSFER_DEVICE_CHECKLIST.md) for what to measure on phones.',
    ''
  );
  parts.push('## Payload per frame', '');
  parts.push('Bytes of file data in each frame at every density, for a 256 KB file. `ur:bytes/` is the format before Prism (ADR 0014), as measured before it was removed; Prism is the format since (ADR 0024).', '');
  parts.push(table(['Density', 'QR code', 'ur:bytes/', 'Prism', 'Gain'], capacityRows()), '');
  parts.push('## Codec through an erasure channel', '');
  parts.push(
    `Block size ${BLOCK_SIZE} bytes. "Frames needed" is the distinct frames that reached the decoder divided by K, so 1.00 would be a perfect code. "Shown" is what the sender had to display, which adds what the channel lost. "LT" is the fountain code Prism has used since ADR 0024; "outer" is the outer code of ADR 0037, which the sender offers under Advanced (#1141). Its decode time is the whole elimination, most of which runs while frames are still arriving.`,
    ''
  );
  parts.push(
    table(
      ['Code', 'Channel', 'K', 'Trials', 'Failed', 'Frames needed ÷ K (median)', 'p95', 'worst', 'Shown ÷ K (median)', 'Decode time (median)'],
      codec.map((r) => [r.code === 'fec' ? 'outer' : 'LT', r.channel, r.k, r.trials, r.failures, r.overheadMedian.toFixed(3), r.overheadP95.toFixed(3), r.overheadWorst.toFixed(3), r.transmittedMedian.toFixed(3), formatSeconds(r.decodeMsMedian)])
    ),
    ''
  );
  if (optical.length > 0) {
    parts.push('## Optical channel simulator', '');
    parts.push(
      'Real QR frames of one BC-UR part each (error correction L), degraded and decoded with our reader (qr-decode), one pass. The estimate is `min(fps, decode rate) × success rate × block size ÷ 1.1` (the 1.1 is the coding overhead). It ignores display tearing between refreshes beyond the rolling-shutter row, and a real camera adds exposure, focus hunting and dropped frames.',
      ''
    );
    parts.push(
      table(
        ['Condition', 'Frame', 'Block', 'Module px', 'Decoded', 'Decode time', 'KB/s at 30 fps', 'KB/s at 60 fps', 'Tier at 60 fps'],
        optical.map((r) => [r.condition, r.resolution, `${r.blockSize} B`, r.modulePx, `${Math.round(r.decodeRate * 100)}%`, `${r.decodeMsMedian} ms`, r.kbps30, r.kbps60, r.tier60])
      ),
      ''
    );
    parts.push('## Time to send', '');
    const best = optical.filter((r) => r.condition === 'ideal').reduce((a, b) => (b.kbps60 > a.kbps60 ? b : a), optical[0]);
    parts.push(`Using the best ideal-condition estimate (${best.kbps60} KB/s, ${best.resolution}, ${best.blockSize} B blocks):`, '');
    parts.push(
      table(
        ['File', 'Frames at that block size', 'Time at the estimate'],
        FILE_SIZES.map((f) => [f.label, Math.ceil((f.bytes / best.blockSize) * 1.1), best.kbps60 > 0 ? formatSeconds((f.bytes / 1024 / best.kbps60) * 1000) : 'n/a'])
      ),
      ''
    );
  }
  parts.push(...tileSection);
  parts.push(READING_NOTES);
  return `${parts.join('\n')}\n`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const maxKIndex = args.indexOf('--max-k');
  const maxK = maxKIndex >= 0 ? Number(args[maxKIndex + 1]) : quick ? 1000 : 10000;
  const ks = [10, 100, 1000, 10000, 50000].filter((k) => k <= maxK);

  const fecModule = await loadFecModule();
  const codec: CodecRow[] = [];
  for (const k of ks) {
    // Large K is slow, so only the clean-join and lossy channels run there.
    const channels = k >= 10000 ? ERASURE_CHANNELS.filter((c) => ['join', 'loss-30'].includes(c.name)) : ERASURE_CHANNELS;
    for (const module of [undefined, fecModule]) {
      for (const channel of channels) {
        const row = benchCodec(k, BLOCK_SIZE, channel, codecTrials(k, quick), module);
        codec.push(row);
        process.stdout.write(`codec ${row.code} ${channel.name} K=${k}: ${row.overheadMedian.toFixed(3)} (p95 ${row.overheadP95.toFixed(3)}), ${formatSeconds(row.decodeMsMedian)}, ${row.failures} failed\n`);
      }
    }
  }
  const optical = args.includes('--no-optical') ? [] : benchOptical(quick);
  for (const row of optical) {
    process.stdout.write(`optical ${row.condition} ${row.resolution} ${row.blockSize}B: ${Math.round(row.decodeRate * 100)}% ${row.decodeMsMedian} ms ${row.kbps60} KB/s (${row.tier60})\n`);
  }

  let tileSection: string[] = [];
  if (!args.includes('--no-tiles')) {
    const tiles = await benchTiles(quick);
    const tears = await benchTears(quick);
    const pool = await measureDecoderPool(quick ? [1, 2] : [1, 2, 3, 4], quick ? 1000 : 3000);
    for (const row of pool) process.stdout.write(`pool ${row.workers} workers: ${row.decodesPerSecond} decodes/s, main thread lag ${row.mainThreadMaxLagMs} ms\n`);
    const tracked = await measureTrackedReads(quick ? 1000 : 3000);
    process.stdout.write(`fast path: ${tracked.trackedPerSecond} reads/s vs ${tracked.fullPerSecond} full reads/s of the crop; ${tracked.frameTilesPerSecond} tiles/s from the whole frame\n`);
    tileSection = renderTiles(tiles, tears, pool, tracked);
  }

  if (args.includes('--write')) {
    // The colour block is written by `bench:colour` (it takes minutes of its own); keep what is there.
    const previous = fs.existsSync(REPORT_PATH) ? fs.readFileSync(REPORT_PATH, 'utf8').replace(/\r?\n/g, '\n') : '';
    const colourBlock = /<!-- colour-bench:start -->[\s\S]*?<!-- colour-bench:end -->/.exec(previous)?.[0];
    const fresh = render(codec, optical, tileSection);
    const marker = '## Reading these numbers';
    const at = fresh.indexOf(marker);
    fs.writeFileSync(REPORT_PATH, colourBlock && at >= 0 ? `${fresh.slice(0, at)}${colourBlock}\n\n${fresh.slice(at)}` : fresh);
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, REPORT_PATH).split(path.sep).join('/')}\n`);
  }
  if (args.includes('--baseline')) {
    // The baseline always uses the quick trial counts, which is what the regression guard re-runs.
    const baseline: Record<string, { overheadMedian: number; overheadP95: number }> = {};
    for (const k of [10, 100, BASELINE_MAX_K]) {
      for (const channel of ERASURE_CHANNELS) {
        const row = benchCodec(k, BLOCK_SIZE, channel, codecTrials(k, true));
        baseline[`${channel.name}/${k}`] = { overheadMedian: row.overheadMedian, overheadP95: row.overheadP95 };
        const fec = benchCodec(k, BLOCK_SIZE, channel, codecTrials(k, true), fecModule);
        baseline[`fec/${channel.name}/${k}`] = { overheadMedian: fec.overheadMedian, overheadP95: fec.overheadP95 };
      }
    }
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, BASELINE_PATH).split(path.sep).join('/')}\n`);
  }
  if (codec.some((r) => r.failures > 0)) process.exitCode = 1;
}

await main();
