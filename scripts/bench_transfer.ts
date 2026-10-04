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
 *   2. Optical: real QR frames of a droplet, degraded the way a phone camera degrades them
 *      (blur, noise, dim screen, tilt, rolling-shutter tear) at 720p and 1080p, decoded with
 *      jsQR. Reports the decode rate and an estimated throughput with its spec tier.
 *
 * The optical part is a Node-side estimate. It cannot see a real screen, lens or shutter, so
 * `docs/TRANSFER_DEVICE_CHECKLIST.md` lists what to measure on phones.
 *
 * Options:
 *   --quick          Small K and few frames (seconds); what the regression guard uses.
 *   --max-k <n>      Largest K for the codec part (default 10000; 50000 takes minutes).
 *   --no-optical     Codec part only.
 *   --write          Write `docs/TRANSFER_BENCHMARK.md` and, with --baseline, the baseline file.
 *   --baseline       Also refresh `tests/fixtures/transfer-baseline.json` (overhead only, quick trials).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jsQR from 'jsqr';
import QRCode from 'qrcode';
import {
  FountainEncoder,
  TRANSFER_DENSITY_PROFILES,
  prismSymbolSize,
  resolveFountainSymbolSize,
  type TransferDensity,
} from '../src/packages/optical-transfer/index.ts';
import { renderCorpusFrame } from '../tests/utils/scannerCorpus.ts';
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
      const encoder = new FountainEncoder(message, { blockSize });
      for (const condition of conditions) {
        let decoded = 0;
        let modules = 0;
        let modulePx = 0;
        const times: number[] = [];
        for (let i = 0; i < frames; i++) {
          const text = encoder.dropletStringForIndex(i * 3 + 1);
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
          const result = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' });
          times.push(performance.now() - started);
          if (result?.data === text) decoded += 1;
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

const READING_NOTES = `## Reading these numbers

- The coding overhead is the part a better code can improve. It is the "Frames needed" column, and it is the number to compare when a new code lands (#1141).
- Decode time grows much faster than K. A decoder that peels most blocks and then falls back to Gaussian elimination is cheap at 1,000 blocks and slow at 50,000. A large file needs either bigger blocks (a smaller K) or a faster decoder.
- The optical estimate is bounded by how many frames per second one JavaScript decode can handle, so a single code per frame cannot reach the upper tiers on its own. That is the case for multi-code frames (#1142) and a faster decoder.
- jsQR alone fails on the tilted rows. The shipped scanner tries several strategies, so these rows measure the simulator's floor, not the app's.
`;

function table(headers: string[], body: Array<Array<string | number>>): string {
  const line = (cells: Array<string | number>) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...body.map(line)].join('\n');
}

function formatSeconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(1)} ms`;
}

/** Payload bytes per frame at each density: the old `ur:bytes/` framing against Prism. */
function capacityRows(): Array<Array<string | number>> {
  return (Object.keys(TRANSFER_DENSITY_PROFILES) as TransferDensity[]).map((density) => {
    const { errorCorrectionLevel, maxVersion } = TRANSFER_DENSITY_PROFILES[density];
    const old = resolveFountainSymbolSize(256 * 1024, errorCorrectionLevel, undefined, maxVersion).symbolSize;
    const prism = prismSymbolSize(errorCorrectionLevel, maxVersion);
    return [density, `${errorCorrectionLevel}, version ${maxVersion}`, `${old} B`, `${prism} B`, `${(prism / old).toFixed(2)}x`];
  });
}

function render(codec: CodecRow[], optical: OpticalRow[]): string {
  const parts: string[] = [];
  parts.push('# File transfer benchmark', '');
  parts.push(
    'Generated by `pnpm run bench:transfer --write`. Overhead numbers are seeded and repeatable. Decode times and the optical part depend on the machine and are estimates; see [the device checklist](TRANSFER_DEVICE_CHECKLIST.md) for what to measure on phones.',
    ''
  );
  parts.push('## Payload per frame', '');
  parts.push('Bytes of file data in each frame at every density, for a 256 KB file. `ur:bytes/` is the format before Prism (ADR 0014); Prism is the format since (ADR 0024).', '');
  parts.push(table(['Density', 'QR code', 'ur:bytes/', 'Prism', 'Gain'], capacityRows()), '');
  parts.push('## Codec through an erasure channel', '');
  parts.push(
    `Block size ${BLOCK_SIZE} bytes. "Frames needed" is the distinct frames that reached the decoder divided by K, so 1.00 would be a perfect code. "Shown" is what the sender had to display, which adds what the channel lost.`,
    ''
  );
  parts.push(
    table(
      ['Channel', 'K', 'Trials', 'Failed', 'Frames needed ÷ K (median)', 'p95', 'worst', 'Shown ÷ K (median)', 'Decode time (median)'],
      codec.map((r) => [r.channel, r.k, r.trials, r.failures, r.overheadMedian.toFixed(3), r.overheadP95.toFixed(3), r.overheadWorst.toFixed(3), r.transmittedMedian.toFixed(3), formatSeconds(r.decodeMsMedian)])
    ),
    ''
  );
  if (optical.length > 0) {
    parts.push('## Optical channel simulator', '');
    parts.push(
      'Real QR frames of one droplet each (error correction L), degraded and decoded with jsQR. The estimate is `min(fps, decode rate) × success rate × block size ÷ 1.1` (the 1.1 is the coding overhead). It ignores display tearing between refreshes beyond the rolling-shutter row, and a real camera adds exposure, focus hunting and dropped frames.',
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
  parts.push(READING_NOTES);
  return `${parts.join('\n')}\n`;
}

function main(): void {
  const args = process.argv.slice(2);
  const quick = args.includes('--quick');
  const maxKIndex = args.indexOf('--max-k');
  const maxK = maxKIndex >= 0 ? Number(args[maxKIndex + 1]) : quick ? 1000 : 10000;
  const ks = [10, 100, 1000, 10000, 50000].filter((k) => k <= maxK);

  const codec: CodecRow[] = [];
  for (const k of ks) {
    // Large K is slow, so only the clean-join and lossy channels run there.
    const channels = k >= 10000 ? ERASURE_CHANNELS.filter((c) => ['join', 'loss-30'].includes(c.name)) : ERASURE_CHANNELS;
    for (const channel of channels) {
      const row = benchCodec(k, BLOCK_SIZE, channel, codecTrials(k, quick));
      codec.push(row);
      process.stdout.write(`codec ${channel.name} K=${k}: ${row.overheadMedian.toFixed(3)} (p95 ${row.overheadP95.toFixed(3)}), ${formatSeconds(row.decodeMsMedian)}, ${row.failures} failed\n`);
    }
  }
  const optical = args.includes('--no-optical') ? [] : benchOptical(quick);
  for (const row of optical) {
    process.stdout.write(`optical ${row.condition} ${row.resolution} ${row.blockSize}B: ${Math.round(row.decodeRate * 100)}% ${row.decodeMsMedian} ms ${row.kbps60} KB/s (${row.tier60})\n`);
  }

  if (args.includes('--write')) {
    fs.writeFileSync(REPORT_PATH, render(codec, optical));
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, REPORT_PATH).split(path.sep).join('/')}\n`);
  }
  if (args.includes('--baseline')) {
    // The baseline always uses the quick trial counts, which is what the regression guard re-runs.
    const baseline: Record<string, { overheadMedian: number; overheadP95: number }> = {};
    for (const k of [10, 100, BASELINE_MAX_K]) {
      for (const channel of ERASURE_CHANNELS) {
        const row = benchCodec(k, BLOCK_SIZE, channel, codecTrials(k, true));
        baseline[`${channel.name}/${k}`] = { overheadMedian: row.overheadMedian, overheadP95: row.overheadP95 };
      }
    }
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    process.stdout.write(`wrote ${path.relative(REPO_ROOT, BASELINE_PATH).split(path.sep).join('/')}\n`);
  }
  if (codec.some((r) => r.failures > 0)) process.exitCode = 1;
}

main();
