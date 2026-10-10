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
 * Colour layer benchmark (#1147): `pnpm run bench:colour [--quick] [--write]`.
 *
 * Sends a seeded file through the simulated screen and camera of `tests/utils/colourBench.ts` with the
 * Colour profile and with the monochrome Fast profile it is built on, at 1080p and 30 fps, over a clean
 * and a harsh camera (cross-talk, a white balance shift mid-transfer, JPEG-like noise). Each pair is run
 * with full reads and with tracked reads, and each of those twice: once decoding every frame however long
 * it takes, and once on the camera's clock, dropping the frames the decoder was too busy for (#1241). It
 * prints the goodput, the real decode time and the cost of one plane decode. With `--write` it replaces
 * the colour block of `docs/TRANSFER_BENCHMARK.md`, which `bench:transfer --write` keeps.
 *
 * Nothing here measures a phone. See `docs/TRANSFER_DEVICE_CHECKLIST.md`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrEncoder as QRCode } from '../tests/fixtures/qrEncoder';
import { execBinary } from './utils/execHelper.js';
import { composeBeacon, composeColourTile, fitCrossTalk, loadCrossTalkKernels, qrModuleCount, samplePatch, splitChannels } from '../src/packages/optical-transfer/index.ts';
import { CLEAN_CHANNEL, COLOUR_BLIND_CHANNEL, REFERENCE_CHANNEL, capture, qrDecoders, runColourTransfer, type CameraChannel, type ColourRunMode, type ColourRunResult, type ReadPath } from '../tests/utils/colourBench.ts';
import { createRandom } from '../tests/utils/scannerCorpus.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = path.join(REPO_ROOT, 'docs', 'TRANSFER_BENCHMARK.md');
const COLOUR_BLOCK_START = '<!-- colour-bench:start -->';
const COLOUR_BLOCK_END = '<!-- colour-bench:end -->';
const FPS = 30;

interface Scenario {
  name: string;
  mode: ColourRunMode;
  channel: CameraChannel;
  readPath: ReadPath;
}

/** One scenario run twice: decoding every frame, and on the camera's clock. */
interface Row {
  scenario: Scenario;
  keepUp: ColourRunResult;
  onClock: ColourRunResult;
}

function table(headers: string[], body: Array<Array<string | number>>): string {
  const line = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...body.map(line)].join('\n');
}

const cell = (result: ColourRunResult, value: string): string => (result.verified ? value : 'did not finish');

/** Raw against corrected decodes of one tile, over cross-talk strengths: where the fit starts to matter. */
async function benchCorrection(): Promise<Array<Array<string | number>>> {
  const grid = (text: string, version: number) => QRCode.create(text, { errorCorrectionLevel: 'L', version }).modules;
  const texts = ['RED ' + 'r'.repeat(300), 'GREEN ' + 'g'.repeat(300), 'BLUE ' + 'b'.repeat(300)];
  const tile = composeColourTile([grid(texts[0], 20), grid(texts[1], 20), grid(texts[2], 20)], { modulePx: 4 });
  const beacon = composeBeacon(grid('beacon', 40), { modulePx: 4 });
  const modules = qrModuleCount(40);
  const code = { x: 16, y: 16, width: modules * 4, height: modules * 4 };
  const rows: Array<Array<string | number>> = [];
  for (const own of [0.8, 0.65, 0.6, 0.55, 0.5, 0.45]) {
    const other = (1 - own) / 2;
    const channel: CameraChannel = {
      ...REFERENCE_CHANNEL,
      matrix: [
        [own, other + 0.03, other - 0.03],
        [other, own, other],
        [other - 0.03, other + 0.03, own],
      ],
    };
    let raw = 0;
    let corrected = 0;
    const trials = 4;
    for (let seed = 1; seed <= trials; seed++) {
      const seen = capture(tile, channel, 0, createRandom(seed));
      const patch = samplePatch(capture(beacon, channel, 0, createRandom(seed + 100)), code, modules);
      const model = patch ? fitCrossTalk(patch) : null;
      const read = (planes: ReturnType<typeof splitChannels>) => planes.filter((plane, i) => qrDecoders.decodePlane(plane)?.text === texts[i]).length;
      raw += read(splitChannels(seen, null, null));
      corrected += read(splitChannels(seen, null, model));
    }
    rows.push([`${Math.round(own * 100)}% own channel`, `${raw} of ${trials * 3}`, `${corrected} of ${trials * 3}`]);
    process.stdout.write(`correction ${own}: raw ${raw}/${trials * 3}, corrected ${corrected}/${trials * 3}\n`);
  }
  return rows;
}

interface Measured {
  date: string;
  commit: string;
}

function render(rows: Row[], fallback: ColourRunResult, correction: Array<Array<string | number>>, bytes: number, measured: Measured): string {
  const find = (mode: ColourRunMode, readPath: ReadPath): Row => {
    const row = rows.find((r) => r.scenario.mode === mode && r.scenario.readPath === readPath && r.scenario.channel === REFERENCE_CHANNEL);
    if (!row) throw new Error(`Missing scenario ${mode} ${readPath}`);
    return row;
  };
  const colour = find('colour', 'tracked');
  const mono = find('mono', 'tracked');
  const colourFull = find('colour', 'full');
  const ratio = (a: ColourRunResult, b: ColourRunResult): string => (a.verified && b.verified && b.goodputKBps > 0 ? `${(a.goodputKBps / b.goodputKBps).toFixed(2)}x` : 'did not finish');
  const budget = (1000 / FPS).toFixed(1);
  const parts: string[] = [COLOUR_BLOCK_START, '', '## Colour layer (#1147, #1241)', ''];
  parts.push(
    `Written by \`pnpm run bench:colour --write\` (minutes; \`bench:transfer --write\` keeps this block), measured on ${measured.date} at commit ${measured.commit}. The Colour profile (Fast with three Prism frames in every tile, one per colour channel, and the same beacons) against the monochrome Fast profile, 2x2 v25 tiles, error correction L, 1080p, 30 fps (a 60 Hz display held for 2 refreshes, one sender frame per camera frame), a ${(bytes / 1000).toFixed(0)} KB random file. Real Prism frames, QR codes, pixels, decodes with our reader (qr-decode), cross-talk fit and correction, tile tracking, dedup and receiver; simulated screen and camera. The camera mixes the three channels through a 3x3 matrix, scales them with a white balance that shifts mid-transfer (red up 12%, blue down 14% over 10 frames from frame 24), shares colour over 2x2 pixels and adds per-pixel and per-8x8-block noise as a JPEG-like stand-in (it is not a JPEG codec). The camera is sharp, level and in sync with the display, so these rates are an upper bound for the code and decode chain, not a prediction for a phone.`,
    ''
  );
  parts.push(
    `Both profiles start the same way: they wait for a beacon (one in 12 frames), place the tiles from it, then read the tracked tile crops and go back to the beacon when the crops fail. A full read searches each crop; a tracked read samples the grid at the box where the tile's code last read (\`readTracked\`, #1178) and searches the crop only when that misses. Each row runs twice. "Decoder keeps up" decodes every camera frame however long it takes and counts simulated camera time, as the first colour bench did. "On the camera's clock" runs the receiver at its real speed on this machine, one thread: a frame that arrives while it is still busy is dropped, and when it is free it takes the newest frame. Goodput is file bytes over that time until the receiver verified the file, start-up included. Times are real milliseconds on this machine (a desktop-class core, not a phone), against a budget of ${budget} ms per camera frame.`,
    ''
  );
  parts.push(
    table(
      ['Scenario', 'Read', 'Goodput, decoder keeps up', "Goodput on the camera's clock", 'Frames decoded, dropped', 'Real time per decoded frame', 'Of which plane decodes', 'One plane decode, p50 and p95', 'Tracked reads that searched'],
      rows.map(({ scenario, keepUp, onClock }) => [
        scenario.name,
        scenario.readPath,
        cell(keepUp, `${keepUp.goodputKBps} KB/s`),
        cell(onClock, `${onClock.goodputKBps} KB/s`),
        `${onClock.framesDecoded}, ${onClock.framesDropped}`,
        `${onClock.decodeMsPerFrame} ms`,
        `${onClock.planeMsPerFrame} ms`,
        `${onClock.planeMsP50} ms, ${onClock.planeMsP95} ms`,
        scenario.readPath === 'tracked' ? String(onClock.trackedFallbacks) : 'n/a',
      ])
    ),
    ''
  );
  parts.push(
    `For mono a "plane" is one tile crop read in grey from RGBA; for Colour it is one corrected colour channel of a crop, three per tile. The time per frame that is not plane decodes is the channel split and cross-talk correction (Colour only) and the full-frame beacon reads. The tracked-read p95 includes the crops that missed and were searched. The colour-blind camera (its three channels see the same mixture) rejects the patch, gives colour up and finishes a 12 KB file from the monochrome beacons alone: ${cell(fallback, `${fallback.goodputKBps} KB/s`)} with the decoder keeping up.`,
    ''
  );
  parts.push(
    'The first colour bench (#1147) reported 220.6 KB/s for Colour against 91.7 KB/s for mono on the harsh camera. Those figures were simulated camera time only: every frame was decoded however long it took (550 ms per frame then, with jsQR), the monochrome receiver was told where its tiles were and paid no start-up, and every crop was a full read. The "decoder keeps up" column is the same kind of figure with both profiles waiting for a beacon.',
    ''
  );
  parts.push('### Where the correction matters', '');
  parts.push(
    'One v20 tile (three codes of 300 characters) through the harsh camera at several cross-talk strengths, four noise draws each. "Raw" splits the camera channels with no correction; "corrected" fits the model from a beacon patch first. Counts are channel codes that decoded to the right text.',
    ''
  );
  parts.push(table(['Cross-talk', 'Raw channels', 'Corrected channels'], correction), '');
  parts.push('### What this proves and what it does not (#1147, #1241)', '');
  parts.push(
    table(
      ['Criterion', 'Bench result', 'Status'],
      [
        [
          'Colour at least 200 KB/s at 1080p/30 fps with simulated cross-talk, white balance shift and JPEG noise',
          `Harsh camera, tracked reads: ${cell(colour.keepUp, `${colour.keepUp.goodputKBps} KB/s`)} with the decoder keeping up, ${cell(colour.onClock, `${colour.onClock.goodputKBps} KB/s`)} on the camera's clock (${cell(colourFull.onClock, `${colourFull.onClock.goodputKBps} KB/s`)} with full reads)`,
          colour.onClock.verified && colour.onClock.goodputKBps >= 200
            ? "Met on the camera's clock, on one desktop thread, in the simulation."
            : colour.keepUp.verified && colour.keepUp.goodputKBps >= 200
              ? "Met only when the decoder is assumed to keep up. Not met on the camera's clock on one desktop thread."
              : 'Not met in the simulation.',
        ],
        [
          'At least 1.8x the matching monochrome profile',
          `${ratio(colour.keepUp, mono.keepUp)} with the decoder keeping up, ${ratio(colour.onClock, mono.onClock)} on the camera's clock (tracked reads, harsh camera)`,
          colour.onClock.verified && mono.onClock.verified && colour.onClock.goodputKBps >= 1.8 * mono.onClock.goodputKBps
            ? "Met on the camera's clock, in the simulation."
            : colour.keepUp.verified && mono.keepUp.verified && colour.keepUp.goodputKBps >= 1.8 * mono.keepUp.goodputKBps
              ? "Met only when the decoder is assumed to keep up."
              : 'Not met in the simulation.',
        ],
        ['At least 200 KB/s on a recent iPhone and a recent Android', 'Not measured. No phone was used.', 'Not met. Open: the items are in the device checklist, and the profile stays off until they pass.'],
        ['If colour fails to decode, the transfer still completes from the mono beacons', 'Tested twice in `tests/colourTransfer.test.ts`: a decoder that reads no colour, and a camera that cannot separate the channels.', 'Met, tested.'],
      ]
    ),
    ''
  );
  parts.push(
    `Decode cost. On the harsh camera with tracked reads, Colour spends ${colour.onClock.decodeMsPerFrame} ms of real time per decoded frame (${colour.onClock.planeMsPerFrame} ms of it in plane decodes) against ${mono.onClock.decodeMsPerFrame} ms for mono, with a budget of ${budget} ms. A receiver that cannot finish a frame in time drops the next ones, and the fountain code makes up for them with later frames, so goodput falls rather than the transfer failing. The phone numbers depend on how fast the channel split, the correction and the reads run in a browser worker there, and how many workers share the crops, which this bench does not measure.`,
    ''
  );
  parts.push(
    'Not measured at all: a real phone camera (its true cross-talk, gamma, auto white balance and auto exposure, which are not linear and not constant), real JPEG or video compression, glare, focus and rolling shutter on colour, how often a camera holds 4 px modules on a colour channel, decoding in browser workers or across several of them, heat, and the sender screen (an OLED or a laptop panel has its own primaries and gamut). The model is linear in the coded values and not gamma-aware. The 200 KB/s device criterion is therefore **not measured**. See [the device checklist](TRANSFER_DEVICE_CHECKLIST.md#colour-layer-1147).',
    ''
  );
  parts.push(COLOUR_BLOCK_END);
  return parts.join('\n');
}

function splice(report: string, block: string): string {
  const start = report.indexOf(COLOUR_BLOCK_START);
  const end = report.indexOf(COLOUR_BLOCK_END);
  if (start >= 0 && end > start) return `${report.slice(0, start)}${block}${report.slice(end + COLOUR_BLOCK_END.length)}`;
  const marker = '## Reading these numbers';
  const at = report.indexOf(marker);
  return at >= 0 ? `${report.slice(0, at)}${block}\n\n${report.slice(at)}` : `${report.trimEnd()}\n\n${block}\n`;
}

function measuredOn(): Measured {
  const date = new Date().toISOString().slice(0, 10);
  try {
    const commit = execBinary('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execBinary('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== '';
    return { date, commit: dirty ? `${commit} (with uncommitted changes)` : commit };
  } catch {
    return { date, commit: 'unknown' };
  }
}

const summary = (result: ColourRunResult): string =>
  result.verified ? `${result.goodputKBps} KB/s, ${result.framesDecoded} decoded, ${result.framesDropped} dropped, ${result.decodeMsPerFrame} ms/frame, plane p50 ${result.planeMsP50} ms p95 ${result.planeMsP95} ms` : 'did not finish';

async function main(): Promise<void> {
  await loadCrossTalkKernels();
  const args = process.argv.slice(2);
  const bytes = args.includes('--quick') ? 300_000 : 1_000_000;
  const measured = measuredOn();
  const scenarios: Scenario[] = [];
  for (const [camera, channel] of [
    ['clean', CLEAN_CHANNEL],
    ['harsh', REFERENCE_CHANNEL],
  ] as const) {
    for (const mode of ['mono', 'colour'] as const) {
      for (const readPath of ['full', 'tracked'] as const) scenarios.push({ name: `${mode === 'mono' ? 'Mono Fast' : 'Colour'}, ${camera} camera`, mode, channel, readPath });
    }
  }
  const rows: Row[] = [];
  for (const scenario of scenarios) {
    const started = Date.now();
    const run = (deadline: boolean) => runColourTransfer({ mode: scenario.mode, bytes, channel: scenario.channel, maxFrames: 2400, fps: FPS, readPath: scenario.readPath, deadline });
    const keepUp = await run(false);
    const onClock = await run(true);
    rows.push({ scenario, keepUp, onClock });
    process.stdout.write(`${scenario.name}, ${scenario.readPath} reads: keeps up ${summary(keepUp)}; on the clock ${summary(onClock)} (${Math.round((Date.now() - started) / 1000)} s)\n`);
  }
  const fallback = await runColourTransfer({ mode: 'colour', bytes: 12_000, channel: COLOUR_BLIND_CHANNEL, maxFrames: 2400, fps: FPS, readPath: 'tracked' });
  process.stdout.write(`Colour, colour-blind camera: ${summary(fallback)}, ${fallback.state}\n`);
  const correction = await benchCorrection();
  if (args.includes('--write')) {
    const report = fs.readFileSync(REPORT_PATH, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(REPORT_PATH, splice(report, render(rows, fallback, correction, bytes, measured)));
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, REPORT_PATH).split(path.sep).join('/')}\n`);
  }
}

await main();
