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
 * Colour profile and with the monochrome Fast profile it is built on, at 1080p and 30 fps, over a clean,
 * a mild and a harsh camera (cross-talk, a white balance shift mid-transfer, JPEG-like noise), and prints
 * the measured goodput. With `--write` it replaces the colour block of `docs/TRANSFER_BENCHMARK.md`,
 * which `bench:transfer --write` keeps.
 *
 * Nothing here measures a phone. See `docs/TRANSFER_DEVICE_CHECKLIST.md`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { qrEncoder as QRCode } from '../tests/fixtures/qrEncoder';
import { composeBeacon, composeColourTile, fitCrossTalk, qrModuleCount, samplePatch, splitChannels } from '../src/packages/optical-transfer/index.ts';
import { CLEAN_CHANNEL, COLOUR_BLIND_CHANNEL, MILD_CHANNEL, REFERENCE_CHANNEL, capture, qrDecoders, runColourTransfer, type CameraChannel, type ColourRunMode, type ColourRunResult } from '../tests/utils/colourBench.ts';
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
  bytes: number;
}

interface Row {
  scenario: Scenario;
  result: ColourRunResult;
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

function render(rows: Row[], correction: Array<Array<string | number>>, bytes: number): string {
  const find = (name: string): ColourRunResult => {
    const row = rows.find((r) => r.scenario.name === name);
    if (!row) throw new Error(`Missing scenario ${name}`);
    return row.result;
  };
  const colour = find('Colour, harsh camera');
  const mono = find('Mono Fast, harsh camera');
  const ratio = mono.goodputKBps > 0 ? colour.goodputKBps / mono.goodputKBps : 0;
  const coresNeeded = (colour.decodeMsPerFrame / (1000 / FPS)).toFixed(1);
  const parts: string[] = [COLOUR_BLOCK_START, '', '## Colour layer (#1147)', ''];
  parts.push(
    `Written by \`pnpm run bench:colour --write\` (minutes; \`bench:transfer --write\` keeps this block). The Colour profile (Fast with three Prism frames in every tile, one per colour channel, and the same beacons) against the monochrome Fast profile, 2x2 v25 tiles, error correction L, 1080p, 30 fps (a 60 Hz display held for 2 refreshes, one sender frame per camera frame), a ${(bytes / 1000).toFixed(0)} KB random file. Real Prism frames, QR codes, pixels, decodes with our reader (qr-decode), cross-talk fit and correction, tile tracking, dedup and receiver; simulated screen and camera. The camera mixes the three channels through a 3x3 matrix, scales them with a white balance that shifts mid-transfer (red up 12%, blue down 14% over 10 frames from frame 24), shares colour over 2x2 pixels and adds per-pixel and per-8x8-block noise as a JPEG-like stand-in (it is not a JPEG codec). The camera is sharp, level and in sync with the display, so these rates are an upper bound for the code and decode chain, not a prediction for a phone. Goodput is file bytes divided by simulated camera time until the receiver verified the file, start-up included: Colour waits for its first beacon (one in 12 frames), the monochrome receiver is told where its tiles are and pays no wait.`,
    ''
  );
  parts.push(
    table(
      ['Scenario', 'Frames', 'Goodput', 'Receiving from', 'Plane decodes per second needed', 'Decode time per camera frame', 'Fits, drift refits, rescales'],
      rows.map(({ scenario, result }) => [
        scenario.name,
        cell(result, String(result.cameraFrames)),
        cell(result, `${result.goodputKBps} KB/s`),
        cell(result, result.startFrames > 0 ? `frame ${result.startFrames}` : 'n/a'),
        String(result.decodesPerSecond),
        `${result.decodeMsPerFrame} ms`,
        scenario.mode === 'colour' ? `${result.fits}, ${result.driftRefits}, ${result.rescales}` : 'n/a',
      ])
    ),
    ''
  );
  parts.push(
    'The harsh camera sends each channel 45% of the others and keeps 55% of its own: where the raw channels stop decoding (next table). The mild one keeps 76 to 80%. The colour-blind row is a camera whose three channels see the same mixture: the patch is rejected, colour is given up and the transfer finishes from the monochrome beacons alone, so its goodput is the beacon rate (a 12 KB file, not the size above). Goodput is the same on the three cameras because every tile read succeeded on all of them: at this noise level the correction decides whether colour reads at all (next table) and, once it reads, the noise costs nothing here. The bench does not sweep noise, blur or tilt, which would cost reads.',
    ''
  );
  parts.push('### Where the correction matters', '');
  parts.push(
    'One v20 tile (three codes of 300 characters) through the harsh camera at several cross-talk strengths, four noise draws each. "Raw" splits the camera channels with no correction; "corrected" fits the model from a beacon patch first. Counts are channel codes that decoded to the right text.',
    ''
  );
  parts.push(table(['Cross-talk', 'Raw channels', 'Corrected channels'], correction), '');
  parts.push('### What this proves and what it does not (#1147)', '');
  parts.push(
    table(
      ['Criterion', 'Bench result', 'Status'],
      [
        [
          'Colour at least 200 KB/s at 1080p/30 fps with simulated cross-talk, white balance shift and JPEG noise',
          cell(colour, `${colour.goodputKBps} KB/s on the harsh camera`),
          colour.verified && colour.goodputKBps >= 200 ? 'Met in the simulation only. The simulated camera captures every frame and the decoder keeps up.' : 'Not met in the simulation.',
        ],
        [
          'At least 1.8x the matching monochrome profile',
          mono.verified && colour.verified ? `${ratio.toFixed(2)}x (${colour.goodputKBps} against ${mono.goodputKBps} KB/s, harsh camera)` : 'did not finish',
          ratio >= 1.8 ? 'Met in the simulation only.' : 'Not met in the simulation.',
        ],
        ['At least 200 KB/s on a recent iPhone and a recent Android', 'Not measured. No phone was used.', 'Not met. Open: the items are in the device checklist, and the profile stays off until they pass.'],
        ['If colour fails to decode, the transfer still completes from the mono beacons', 'Tested twice in `tests/colourTransfer.test.ts`: a decoder that reads no colour, and a camera that cannot separate the channels.', 'Met, tested.'],
      ]
    ),
    ''
  );
  parts.push(
    `Decode cost. A tile costs three plane decodes, so Colour needs ${colour.decodesPerSecond} plane decodes per second at 30 fps here (a 4-tile frame is 12 decodes; the issue's 360 to 720 per second is the same figure at 30 and 60 fps), against ${mono.decodesPerSecond} for monochrome. The time column is our reader plus the channel correction on this machine, single thread, loaded: ${colour.decodeMsPerFrame} ms per camera frame is about ${coresNeeded} cores' worth at 30 fps. Goodput above assumes the decoder keeps up with the camera; on a device that cannot, the rate falls by the same factor and the receiver should report its tier.`,
    ''
  );
  parts.push(
    'Not measured at all: a real phone camera (its true cross-talk, gamma, auto white balance and auto exposure, which are not linear and not constant), real JPEG or video compression, glare, focus and rolling shutter on colour, how often a camera holds 4 px modules on a colour channel, decoding in browser workers, heat, and the sender screen (an OLED or a laptop panel has its own primaries and gamut). The model is linear in the coded values and not gamma-aware. The 200 KB/s device criterion is therefore **not measured**. See [the device checklist](TRANSFER_DEVICE_CHECKLIST.md#colour-layer-1147).',
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const bytes = args.includes('--quick') ? 300_000 : 1_000_000;
  const scenarios: Scenario[] = [
    { name: 'Mono Fast, clean camera', mode: 'mono', channel: CLEAN_CHANNEL, bytes },
    { name: 'Colour, clean camera', mode: 'colour', channel: CLEAN_CHANNEL, bytes },
    { name: 'Mono Fast, mild camera', mode: 'mono', channel: MILD_CHANNEL, bytes },
    { name: 'Colour, mild camera', mode: 'colour', channel: MILD_CHANNEL, bytes },
    { name: 'Mono Fast, harsh camera', mode: 'mono', channel: REFERENCE_CHANNEL, bytes },
    { name: 'Colour, harsh camera', mode: 'colour', channel: REFERENCE_CHANNEL, bytes },
    { name: 'Colour, colour-blind camera (falls back to beacons)', mode: 'colour', channel: COLOUR_BLIND_CHANNEL, bytes: 12_000 },
  ];
  const rows: Row[] = [];
  for (const scenario of scenarios) {
    const started = Date.now();
    const result = await runColourTransfer({ mode: scenario.mode, bytes: scenario.bytes, channel: scenario.channel, maxFrames: 2400, fps: FPS });
    rows.push({ scenario, result });
    process.stdout.write(`${scenario.name}: ${result.verified ? `${result.goodputKBps} KB/s in ${result.cameraFrames} frames` : 'did not finish'}, ${result.state}, ${result.decodeMsPerFrame} ms/frame (${Math.round((Date.now() - started) / 1000)} s)\n`);
  }
  const correction = await benchCorrection();
  if (args.includes('--write')) {
    const report = fs.readFileSync(REPORT_PATH, 'utf8').replace(/\r\n/g, '\n');
    fs.writeFileSync(REPORT_PATH, splice(report, render(rows, correction, bytes)));
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, REPORT_PATH).split(path.sep).join('/')}\n`);
  }
}

await main();
