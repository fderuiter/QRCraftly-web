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
 *                     side by side; `--ref WORKTREE` names the working tree explicitly. Refs from
 *                     before #1178 imported jsQR, which is no longer installed, so they do not load.
 *   --filter <text>   Only fixtures whose id contains the text (e.g. `noise`, `no-code`).
 *   --by-category     Also print one row per corpus category.
 *   --budget <ms>     Exit non-zero when any camera frame takes longer (default: report only).
 *   --corpus hard     Use the hard corpus from #1104 (`tests/utils/hardCorpus.ts`) instead. The
 *                     last zxing-wasm comparison on it is recorded in ADR 0036.
 *   --count <n>       Frames per subset of the hard corpus (default 60).
 *
 * Timing depends on the machine, so this is not a CI gate: run it on demand or from the
 * manual / nightly "Scanner benchmark" workflow. `decodeSync.ts` must keep importing nothing at
 * runtime (the reader is passed in), so an older copy can be loaded from a ref. Every ref runs with
 * the working tree's `src/wasm/qr-decode.wasm`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execBinary } from './utils/execHelper.js';
import { generateCorpus, type CorpusFrame } from '../tests/utils/scannerCorpus.ts';
import { generateHardCorpus } from '../tests/utils/hardCorpus.ts';
import { qrReader } from '../tests/fixtures/qrReader.ts';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DECODER_PATH = 'src/packages/optical-scanner/lib/decodeSync.ts';
// Node refuses to strip types from files under node_modules, so the copies from older refs live in the temp folder.
const CACHE_DIR = path.join(os.tmpdir(), 'qrcraftly-bench-scanner');
const WORKTREE = 'WORKTREE';
/** Camera frames a rotating decoder may use before a fixture counts as missed. */
const CAMERA_FRAMES = 4;

type Reader = typeof qrReader;

/** The decoder exports a strategy may use. */
interface DecoderModule {
  decodeRgbaCode?: (reader: Reader, data: Uint8ClampedArray, width: number, height: number) => { text: string } | null;
  decodeCameraFrame?: (reader: Reader, data: Uint8ClampedArray, width: number, height: number, pass: string) => string | null;
  cameraStrategyFor?: (sequenceId: number) => string;
}

interface FrameRun {
  /** Time of every decode call made for the fixture (one per camera frame). */
  times: number[];
  decoded: string | null;
}

interface Strategy {
  name: string;
  run(frame: CorpusFrame): FrameRun;
}

interface Options {
  refs: string[];
  filter?: string;
  byCategory: boolean;
  budget?: number;
  hard: boolean;
  count: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { refs: [], byCategory: false, hard: false, count: 60 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--ref') options.refs.push(argv[++i]);
    else if (arg === '--filter') options.filter = argv[++i];
    else if (arg === '--by-category') options.byCategory = true;
    else if (arg === '--budget') options.budget = Number(argv[++i]);
    else if (arg === '--corpus') {
      const corpus = argv[++i];
      if (corpus !== 'hard' && corpus !== 'generated') throw new Error(`Unknown corpus: ${corpus}`);
      options.hard = corpus === 'hard';
    } else if (arg === '--count') options.count = Number(argv[++i]);
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

function strategiesFor(decoder: DecoderModule): Strategy[] {
  const strategies: Strategy[] = [
    {
      name: 'one qr-decode pass (full frame, dark on light)',
      run: (frame) => {
        const { value, ms } = timed(() => qrReader.read(frame.data, frame.width, frame.height));
        return { times: [ms], decoded: value[0]?.text ?? null };
      },
    },
  ];
  const { decodeCameraFrame, cameraStrategyFor, decodeRgbaCode } = decoder;
  if (decodeRgbaCode) {
    strategies.push({
      name: 'multi-pass (decodeRgbaCode)',
      run: (frame) => {
        const { value, ms } = timed(() => decodeRgbaCode(qrReader, frame.data, frame.width, frame.height));
        return { times: [ms], decoded: value?.text ?? null };
      },
    });
  }
  if (decodeCameraFrame && cameraStrategyFor) {
    strategies.push({
      name: `camera rotation (decodeCameraFrame, <= ${CAMERA_FRAMES} frames)`,
      run: (frame) => {
        const times: number[] = [];
        for (let sequenceId = 1; sequenceId <= CAMERA_FRAMES; sequenceId++) {
          const { value, ms } = timed(() => decodeCameraFrame(qrReader, frame.data, frame.width, frame.height, cameraStrategyFor(sequenceId)));
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
  const corpus = options.hard ? [...generateHardCorpus(options.count, options.filter)] : [...generateCorpus(options.filter)];
  const withCode = corpus.filter((f) => f.expected !== null).length;
  console.log(`Scanner benchmark: ${corpus.length} fixtures (${withCode} with a code, ${corpus.length - withCode} without)\n`);

  let overBudget = 0;
  for (const ref of options.refs) {
    const decoder = await loadDecoder(ref);
    const rows: Row[] = [];
    const categoryRows: Row[] = [];
    for (const strategy of strategiesFor(decoder)) {
      const row: Row = { label: strategy.name, decoded: 0, total: withCode, times: [], framesToDecode: [] };
      const byCategory = new Map<string, Row>();
      const slowest: Array<{ id: string; ms: number }> = [];
      for (const frame of corpus) {
        const result = strategy.run(frame);
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
