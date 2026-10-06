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
 * GPU conformance and timing for the optical modem's decode kernel (#1164):
 * `pnpm run bench:optical-gpu [--chromium <path>] [--reps <n>]`.
 *
 * Simulated frames from `src/packages/optical-modem` go through the reference kernel in Node and
 * through the WebGL 2 kernel in a headless browser, and the two are compared byte for byte; the
 * decoded blocks are compared too. Chromium's default headless GL is SwiftShader, a software
 * rasterizer, so this proves the shader's arithmetic on one implementation and says nothing about a
 * phone GPU's speed or rounding. The timing it prints is for that software path and the machine it
 * ran on, and is labelled so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { BASE_CSP_PATTERN } from './csp_hash_injector.js';
import {
  MODEM_PROFILES,
  compareGrids,
  decodeModemFrame,
  encodeModemFrame,
  frameCapacity,
  loadOpticalModem,
  runReferenceKernel,
  simulateCapture,
  type ChannelPreset,
  type KernelUniforms,
  type SampledGrid,
} from '../src/packages/optical-modem/index.ts';
import type { WireUniforms } from './utils/opticalGpuPage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE_ENTRY = path.join(root, 'scripts', 'utils', 'opticalGpuPage.ts');
const SESSION = 20261005;
const PITCH = 4;
const PRESETS: ChannelPreset[] = ['studio', 'typical', 'poor'];
/** Camera pixels per cell for each profile: comfortable, and where the profile starts to struggle. */
const CAMERA_PX: Record<number, number[]> = { 2: [5, 3.5], 3: [5, 4], 4: [6, 5] };

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function bundlePage(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    root,
    build: { write: false, minify: false, target: 'esnext', lib: { entry: PAGE_ENTRY, formats: ['iife'], name: 'opticalGpuPage', fileName: 'page' } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ('output' in r ? r.output : []));
  const chunk = outputs.find((o) => o.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('The page bundle was not produced');
  return chunk.code;
}

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
const fromBase64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, 'base64'));
const wire = (u: KernelUniforms): WireUniforms => ({ cols: u.cols, dataRows: u.dataRows, rowOffset: u.rowOffset, homography: Array.from(u.homography), palette: Array.from(u.palette) });
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const percentile95 = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * 0.95))];

function table(header: string[], rows: (string | number)[][]): string {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** A homography that maps a `cols` x `rows` cell grid onto the middle `fill` of a `width` x `height` frame. */
function fillHomography(cols: number, rows: number, width: number, height: number, fill: number): number[] {
  const scale = Math.min((width * fill) / cols, (height * fill) / rows);
  return [scale, 0, (width - cols * scale) / 2, 0, scale, (height - rows * scale) / 2, 0, 0, 1].map(Math.fround);
}

async function main(): Promise<void> {
  const reps = Number(argument('--reps') ?? 20);
  const executablePath = argument('--chromium') ?? process.env.OPTICAL_CHROMIUM_PATH;
  const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const bundle = await bundlePage();
  // The reference kernel runs in the modem module, in Node and in the page.
  await loadOpticalModem();
  const moduleBase64 = fs.readFileSync(path.join(root, 'src', 'wasm', 'modem.wasm')).toString('base64');
  // The site's own policy, without the inline-script allowance that production replaces with hashes.
  const strictCsp = BASE_CSP_PATTERN.replace("script-src 'self' 'unsafe-inline'", "script-src 'self'");
  const cspPage = await browser.newPage();
  const violations: string[] = [];
  await cspPage.route('https://qrcraftly.test/**', (route) => {
    const isScript = route.request().url().endsWith('/page.js');
    return route.fulfill({
      status: 200,
      contentType: isScript ? 'text/javascript' : 'text/html',
      headers: { 'Content-Security-Policy': strictCsp },
      body: isScript ? bundle : '<!doctype html><title>csp</title><script src="/page.js"></script>',
    });
  });
  cspPage.on('console', (message) => {
    if (/content security policy/i.test(message.text())) violations.push(message.text());
  });
  await cspPage.goto('https://qrcraftly.test/');
  const underCsp = await cspPage.evaluate((base64) => window.opticalGpu.init(base64), moduleBase64);
  process.stdout.write(
    `Under the site's CSP (script-src 'self' 'wasm-unsafe-eval', no 'unsafe-eval', no blob: or data: scripts): ${underCsp.ok ? `kernel built, self-test ${underCsp.selfTest.exact ? 'exact' : 'MISMATCH'}` : `no kernel (${underCsp.reason})`}, ${violations.length} policy violations.\n`
  );
  if (!underCsp.ok || !underCsp.selfTest.exact || violations.length > 0) process.exitCode = 1;
  await cspPage.close();
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle });
  const init = await page.evaluate((base64) => window.opticalGpu.init(base64), moduleBase64);
  if (!init.ok) {
    process.stdout.write(`No GPU kernel in this browser: ${init.reason}\n`);
    await browser.close();
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Renderer: ${init.renderer ?? 'hidden by the browser'}\n`);
  process.stdout.write(`Self-test on noise frames: ${init.selfTest.exact ? 'bit for bit equal' : 'MISMATCH'} over ${init.selfTest.cells} cells ${JSON.stringify(init.selfTest.difference)}\n\n`);

  const rows: (string | number)[][] = [];
  let totalCells = 0;
  let totalMismatch = 0;
  let blockMismatch = 0;
  for (const profile of MODEM_PROFILES) {
    const capacity = frameCapacity(profile);
    for (const preset of PRESETS) {
      for (const px of CAMERA_PX[profile.id]) {
        const payload = Uint8Array.from({ length: capacity.payloadBytes }, (_, i) => (i * 37 + profile.id * 11 + 3) & 255);
        const capture = simulateCapture(encodeModemFrame(profile, payload, SESSION, profile.id, PITCH), preset, { pixelsPerCell: px, cellPitch: PITCH, seed: profile.id });
        let uniforms: KernelUniforms | null = null;
        const reference = decodeModemFrame(capture, {
          sampleGrid: (_image, u) => {
            uniforms = u;
            return null;
          },
        });
        if (!uniforms || !reference.ok) {
          rows.push([`P${profile.id}`, preset, px, 'frame not found by the CPU stage', '-', '-', '-']);
          continue;
        }
        const u: KernelUniforms = uniforms;
        const out = await page.evaluate(([w, h, pixels, un]) => window.opticalGpu.run(w, h, pixels, un), [capture.width, capture.height, toBase64(new Uint8Array(capture.data.buffer)), wire(u)] as const);
        if (!out) throw new Error('The GPU kernel returned nothing');
        const gpu: SampledGrid = { symbols: fromBase64(out.symbols), confidence: fromBase64(out.confidence), means: fromBase64(out.means) };
        const diff = compareGrids(runReferenceKernel(capture, u), gpu);
        const viaGpu = decodeModemFrame(capture, { sampleGrid: () => gpu });
        const sameBlocks =
          viaGpu.ok && viaGpu.blocks.length === reference.blocks.length && viaGpu.blocks.every((block, b) => (block === null ? reference.blocks[b] === null : reference.blocks[b] !== null && block.every((v, i) => v === reference.blocks[b]?.[i])));
        totalCells += diff.cells;
        totalMismatch += diff.symbolMismatches + diff.confidenceMismatches + diff.meanMismatches;
        if (!sameBlocks) blockMismatch++;
        rows.push([`P${profile.id} ${profile.name}`, preset, px, diff.cells, `${diff.symbolMismatches} / ${diff.confidenceMismatches} / ${diff.meanMismatches}`, `${reference.blocksOk} of ${reference.blocks.length}`, sameBlocks ? 'same' : 'DIFFERENT']);
      }
    }
  }
  process.stdout.write(`${table(['Profile', 'Channel', 'Camera px per cell', 'Cells', 'Mismatches: symbol / confidence / mean', 'Blocks repaired (CPU)', 'Blocks via GPU'], rows)}\n\n`);
  process.stdout.write(`Total: ${totalCells} cells, ${totalMismatch} mismatching values, ${blockMismatch} frames with different blocks.\n\n`);

  // Negative control: the same frame with the GPU's homography nudged by 0.4 pixel. If the comparison
  // could not see a difference, "0 mismatches" above would mean nothing.
  {
    const profile = MODEM_PROFILES[1];
    const capacity = frameCapacity(profile);
    const capture = simulateCapture(encodeModemFrame(profile, new Uint8Array(capacity.payloadBytes).fill(7), SESSION, 1, PITCH), 'typical', { pixelsPerCell: 5, cellPitch: PITCH, seed: 1 });
    let uniforms: KernelUniforms | null = null;
    decodeModemFrame(capture, {
      sampleGrid: (_image, u) => {
        uniforms = u;
        return null;
      },
    });
    if (uniforms) {
      const u: KernelUniforms = uniforms;
      const nudged = { ...wire(u), homography: wire(u).homography.map((v, i) => (i === 2 ? Math.fround(v + 0.4) : v)) };
      const out = await page.evaluate(([w, h, pixels, un]) => window.opticalGpu.run(w, h, pixels, un), [capture.width, capture.height, toBase64(new Uint8Array(capture.data.buffer)), nudged] as const);
      if (out) {
        const diff = compareGrids(runReferenceKernel(capture, u), { symbols: fromBase64(out.symbols), confidence: fromBase64(out.confidence), means: fromBase64(out.means) });
        process.stdout.write(`Negative control (GPU homography nudged by 0.4 px): ${diff.meanMismatches} of ${diff.cells} cells differ, as they must.\n\n`);
        if (diff.meanMismatches === 0) process.exitCode = 1;
      }
    }
  }

  const timing: (string | number)[][] = [];
  const geometries = [
    { name: 'P3 grid', cols: 120, rows: 49 },
    { name: 'issue grid 512 x 270 data rows', cols: 512, rows: 270 },
  ];
  for (const g of geometries) {
    const width = 1920;
    const height = 1080;
    const palette = Array.from({ length: 24 }, (_, i) => (i * 53) & 255);
    const uniforms: WireUniforms = { cols: g.cols, dataRows: g.rows, rowOffset: 9, homography: fillHomography(g.cols, g.rows + 18, width, height, 0.8), palette };
    const gpuTimes = await page.evaluate(([w, h, un, n]) => window.opticalGpu.time(w, h, un, n), [width, height, uniforms, reps] as const);
    const data = new Uint8ClampedArray(width * height * 4);
    let state = 12345;
    for (let i = 0; i < data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[i] = i % 4 === 3 ? 255 : state >>> 24;
    }
    const cpuTimes: number[] = [];
    const cpuUniforms: KernelUniforms = { ...uniforms, homography: Float32Array.from(uniforms.homography), palette: Int32Array.from(uniforms.palette) };
    for (let r = 0; r < Math.max(3, Math.floor(reps / 4)); r++) {
      const start = performance.now();
      runReferenceKernel({ width, height, data }, cpuUniforms);
      cpuTimes.push(performance.now() - start);
    }
    timing.push([g.name, g.cols * g.rows, `${median(gpuTimes).toFixed(1)} ms`, `${percentile95(gpuTimes).toFixed(1)} ms`, `${median(cpuTimes).toFixed(1)} ms`]);
  }
  process.stdout.write(`${table(['Grid (1920 x 1080 frame, 8 colours)', 'Cells', 'WebGL 2 on SwiftShader, median', 'p95', 'Reference kernel in Node, median'], timing)}\n`);
  await browser.close();
  if (!init.selfTest.exact || totalMismatch > 0 || blockMismatch > 0) process.exitCode = 1;
}

void main();
