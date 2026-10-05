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
 * Scanner decode benchmark (#1103): `pnpm run bench:scanner [options]`.
 *
 * Runs every decoder strategy over the generated corpus (`tests/utils/scannerCorpus.ts`)
 * and prints, per strategy, the decode rate and the p50 / p95 / max time per frame.
 *
 * Options:
 *   --ref <git-ref>   Benchmark the decoder (`src/packages/optical-scanner/lib/decodeSync.ts`)
 *                     at a git ref instead of the working tree. Repeat to compare refs
 *                     side by side; `--ref WORKTREE` names the working tree explicitly.
 *   --filter <text>   Only fixtures whose id contains the text (e.g. `noise`, `no-code`).
 *   --by-category     Also print one row per corpus category.
 *   --budget <ms>     Exit non-zero when any camera frame takes longer (default: report only).
 *   --no-zxing        Skip the zxing-wasm rows (they always use the working tree's reader).
 *   --no-qr-decode    Skip the rows for our Rust decoder (#1178, always the working tree's module).
 *
 * Timing depends on the machine, so this is not a CI gate: run it on demand or from the
 * manual / nightly "Scanner benchmark" workflow. `decodeSync.ts` must keep importing only
 * `jsqr`, so an older copy can be loaded from a ref.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import jsQR from 'jsqr';
import { execBinary } from './utils/execHelper.js';
import { generateCorpus, type CorpusFrame } from '../tests/utils/scannerCorpus.ts';
import * as reader from '../src/packages/optical-scanner/reader.ts';
import { qrReader } from '../tests/fixtures/qrReader.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECODER_PATH = 'src/packages/optical-scanner/lib/decodeSync.ts';
const CACHE_DIR = path.join(REPO_ROOT, 'node_modules', '.cache', 'bench-scanner');
const WORKTREE = 'WORKTREE';
/** Camera frames a rotating decoder may use before a fixture counts as missed. */
const CAMERA_FRAMES = 4;

/** The decoder exports a strategy may use; older refs have only some of them. */
interface DecoderModule {
  decodeRgbaFrame?: (data: Uint8ClampedArray, width: number, height: number) => string | null;
  decodeRgbaCode?: (data: Uint8ClampedArray, width: number, height: number) => { text: string } | null;
  decodeCameraFrame?: (data: Uint8ClampedArray, width: number, height: number, pass: string) => string | null;
  cameraStrategyFor?: (sequenceId: number) => string;
}

interface FrameRun {
  /** Time of every decode call made for the fixture (one per camera frame). */
  times: number[];
  decoded: string | null;
}

interface Strategy {
  name: string;
  run(frame: CorpusFrame): FrameRun | Promise<FrameRun>;
}

interface Options {
  refs: string[];
  filter?: string;
  byCategory: boolean;
  budget?: number;
  zxing: boolean;
  qrDecode: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { refs: [], byCategory: false, zxing: true, qrDecode: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ref') options.refs.push(argv[++i]);
    else if (arg === '--filter') options.filter = argv[++i];
    else if (arg === '--by-category') options.byCategory = true;
    else if (arg === '--budget') options.budget = Number(argv[++i]);
    else if (arg === '--no-zxing') options.zxing = false;
    else if (arg === '--no-qr-decode') options.qrDecode = false;
    else if (arg === '--') continue;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.refs.length === 0) options.refs.push(WORKTREE);
  return options;
}

function timed<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

async function loadDecoder(ref: string): Promise<DecoderModule> {
  if (ref === WORKTREE) {
    return import(pathToFileURL(path.join(REPO_ROOT, DECODER_PATH)).href);
  }
  const source = execBinary('git', ['show', `${ref}:${DECODER_PATH}`], { cwd: REPO_ROOT });
  const dir = path.join(CACHE_DIR, ref.replace(/[^a-zA-Z0-9._-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'decodeSync.ts');
  fs.writeFileSync(file, source);
  return import(`${pathToFileURL(file).href}?ref=${encodeURIComponent(ref)}`);
}

async function timedAsync<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
}

/** Copies a region of an RGBA frame, downscaled (nearest pixel) so its longest side is at most `max`. */
function cutRegion(
  frame: CorpusFrame,
  region: { x: number; y: number; width: number; height: number },
  max: number
): { data: Uint8ClampedArray; width: number; height: number } {
  const scale = Math.min(1, max / Math.max(region.width, region.height));
  const width = Math.round(region.width * scale);
  const height = Math.round(region.height * scale);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = region.y + Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      const from = (sy * frame.width + region.x + Math.floor(x / scale)) * 4;
      data.set(frame.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  return { data, width, height };
}

/**
 * The zxing-wasm reader rows (ADR 0023), using the working tree's reader seam. The camera row
 * mirrors the engine: odd frames cut the centre square at native resolution (up to 1280 px), even
 * frames take the whole frame downscaled to 1280 px.
 */
async function zxingStrategies(): Promise<Strategy[]> {
  const wasm = fs.readFileSync(path.join(REPO_ROOT, 'node_modules/zxing-wasm/dist/reader/zxing_reader.wasm'));
  (globalThis as { ImageData?: unknown }).ImageData ??= class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number
    ) {}
  };
  if (!(await reader.installZxing(await WebAssembly.compile(wasm)))) throw new Error('zxing-wasm failed to instantiate');
  const decode = (image: { data: Uint8ClampedArray; width: number; height: number }) =>
    reader.decodeWithZxing(image.data, image.width, image.height) as Promise<{ text: string } | null>;
  return [
    {
      name: 'zxing-wasm (whole frame)',
      run: async (frame) => {
        const { value, ms } = await timedAsync(() => decode(frame));
        return { times: [ms], decoded: value?.text ?? null };
      },
    },
    {
      name: 'zxing-wasm camera rotation (region, whole frame)',
      run: async (frame) => {
        const times: number[] = [];
        const side = Math.min(frame.width, frame.height);
        const regions = [
          { x: Math.floor((frame.width - side) / 2), y: Math.floor((frame.height - side) / 2), width: side, height: side },
          { x: 0, y: 0, width: frame.width, height: frame.height },
        ];
        for (const region of regions) {
          const image = cutRegion(frame, region, 1280);
          const { value, ms } = await timedAsync(() => decode(image));
          times.push(ms);
          if (value) return { times, decoded: value.text };
        }
        return { times, decoded: null };
      },
    },
  ];
}

/** Our Rust decoder (#1178), shadowing jsQR: its default pass, and every pass in one call. */
function qrDecodeStrategies(): Strategy[] {
  const row = (name: string, options: Parameters<typeof qrReader.read>[3]): Strategy => ({
    name,
    run: (frame) => {
      const { value, ms } = timed(() => qrReader.read(frame.data, frame.width, frame.height, options));
      return { times: [ms], decoded: value[0]?.text ?? null };
    },
  });
  return [row('qr-decode (default pass)', {}), row('qr-decode (inverted, global and half passes)', { inverted: true, global: true, half: true })];
}

function strategiesFor(decoder: DecoderModule): Strategy[] {
  const strategies: Strategy[] = [
    {
      name: 'one jsQR pass (full frame, dontInvert)',
      run: (frame) => {
        const { value, ms } = timed(() => jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' }));
        return { times: [ms], decoded: value?.data ?? null };
      },
    },
  ];
  const { decodeCameraFrame, cameraStrategyFor, decodeRgbaCode } = decoder;
  // Newer refs return the rich `decodeRgbaCode` result only.
  const decodeRgbaFrame =
    decoder.decodeRgbaFrame ??
    (decodeRgbaCode && ((data: Uint8ClampedArray, width: number, height: number) => decodeRgbaCode(data, width, height)?.text ?? null));
  if (decodeRgbaFrame) {
    strategies.push({
      name: 'multi-pass (decodeRgbaFrame)',
      run: (frame) => {
        const { value, ms } = timed(() => decodeRgbaFrame(frame.data, frame.width, frame.height));
        return { times: [ms], decoded: value };
      },
    });
  }
  if (decodeCameraFrame && cameraStrategyFor) {
    strategies.push({
      name: `camera rotation (decodeCameraFrame, <= ${CAMERA_FRAMES} frames)`,
      run: (frame) => {
        const times: number[] = [];
        for (let sequenceId = 1; sequenceId <= CAMERA_FRAMES; sequenceId++) {
          const { value, ms } = timed(() => decodeCameraFrame(frame.data, frame.width, frame.height, cameraStrategyFor(sequenceId)));
          times.push(ms);
          if (value) return { times, decoded: value };
        }
        return { times, decoded: null };
      },
    });
  }
  return strategies;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

interface Row {
  label: string;
  decoded: number;
  total: number;
  times: number[];
  framesToDecode: number[];
}

function formatTable(rows: Row[]): string {
  const header = ['strategy', 'decoded', 'rate', 'frames', 'p50 ms', 'p95 ms', 'max ms'];
  const body = rows.map((row) => {
    const sorted = [...row.times].sort((a, b) => a - b);
    const frames = row.framesToDecode.length
      ? (row.framesToDecode.reduce((a, b) => a + b, 0) / row.framesToDecode.length).toFixed(2)
      : '-';
    return [
      row.label,
      `${row.decoded}/${row.total}`,
      row.total ? `${Math.round((row.decoded / row.total) * 100)}%` : '-',
      frames,
      percentile(sorted, 50).toFixed(1),
      percentile(sorted, 95).toFixed(1),
      (sorted.at(-1) ?? 0).toFixed(1),
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  return [line(header), `|${widths.map((w) => '-'.repeat(w + 2)).join('|')}|`, ...body.map(line)].join('\n');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const corpus = [...generateCorpus(options.filter)];
  const withCode = corpus.filter((f) => f.expected !== null).length;
  console.log(`Scanner benchmark: ${corpus.length} fixtures (${withCode} with a code, ${corpus.length - withCode} without)\n`);

  let overBudget = 0;
  for (const ref of options.refs) {
    const decoder = await loadDecoder(ref);
    const rows: Row[] = [];
    const categoryRows: Row[] = [];
    const strategies = strategiesFor(decoder);
    if (options.zxing && ref === options.refs[0]) strategies.push(...(await zxingStrategies()));
    if (options.qrDecode && ref === options.refs[0]) strategies.push(...qrDecodeStrategies());
    for (const strategy of strategies) {
      const row: Row = { label: strategy.name, decoded: 0, total: withCode, times: [], framesToDecode: [] };
      const byCategory = new Map<string, Row>();
      const slowest: Array<{ id: string; ms: number }> = [];
      for (const frame of corpus) {
        const result = await strategy.run(frame);
        row.times.push(...result.times);
        const max = Math.max(...result.times);
        slowest.push({ id: frame.id, ms: max });
        if (options.budget !== undefined && strategy.name.startsWith('camera') && max > options.budget) overBudget += 1;
        let cat = byCategory.get(frame.category);
        if (!cat) {
          cat = { label: `  ${frame.category}`, decoded: 0, total: 0, times: [], framesToDecode: [] };
          byCategory.set(frame.category, cat);
        }
        cat.times.push(...result.times);
        if (frame.expected !== null) {
          cat.total += 1;
          if (result.decoded === frame.expected) {
            row.decoded += 1;
            cat.decoded += 1;
            row.framesToDecode.push(result.times.length);
            cat.framesToDecode.push(result.times.length);
          }
        }
      }
      rows.push(row);
      if (options.byCategory) {
        categoryRows.push({ ...row, label: strategy.name }, ...byCategory.values());
      }
      slowest.sort((a, b) => b.ms - a.ms);
      console.log(
        `[${ref}] ${strategy.name}: slowest ${slowest
          .slice(0, 3)
          .map((s) => `${s.id} ${s.ms.toFixed(0)} ms`)
          .join(', ')}`
      );
    }
    console.log(`\n### ${ref === WORKTREE ? 'Working tree' : ref}\n`);
    console.log(formatTable(options.byCategory ? categoryRows : rows));
    console.log('');
  }
  console.log('"frames" is the mean number of camera frames (decode calls) a decoded fixture needed.');
  if (options.budget !== undefined) {
    console.log(`Camera frames over the ${options.budget} ms budget: ${overBudget}`);
    if (overBudget > 0) process.exitCode = 1;
  }
}

await main();
