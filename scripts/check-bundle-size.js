import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { walkFiles } from './utils/sourceFiles.js';

const require = createRequire(import.meta.url);
// The service worker generator already knows how to follow a page's startup assets.
const { readAssetReferences, readWorkerReferences } = require('./generate_sw.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.resolve(__dirname, '../dist/client');
const WASM_DIR = path.resolve(__dirname, '../src/wasm');
// The code one visitor downloads to open one page (#1106): its HTML, the CSS and the scripts it
// loads at startup (static imports, not lazy chunks or workers). The worst page is the number that
// matters for load time, so this is the budget that catches JavaScript bloat.
export const MAX_PAGE_FIRST_LOAD_KB = 260;
// The same first load plus the Rust modules the page fetches as soon as it opens (#1594). Generator
// pages fetch the QR encoder (11.2 KB) and the decoder behind the scannability check (29.3 KB),
// which took them from 255 KB of code to 296 KB on 2026-10-24. WebAssembly compiles off the main
// thread while streaming, so it does not hold up the first paint the way scripts do; it gets this
// separate line, set about 4% above the measured worst page like the code budget, instead of a
// higher code budget that would let scripts grow into the room.
export const MAX_PAGE_FIRST_LOAD_WITH_WASM_KB = 308;
// Tools that start their workers only when the visitor starts a scan or a transfer, so none of
// the modules their startup scripts can reach is fetched on open. e2e/startup-wasm.spec.ts checks
// this list and the rule in {@link readStartupWasm} against what a browser really fetches.
export const ON_DEMAND_WASM_PAGES = [
  'file-transfer/index.html',
  'file-transfer/receive/index.html',
  'qr-code-checker/index.html',
  'qr-code-scanner/index.html',
];
// A loose backstop on the JavaScript and CSS in dist/client, so shipped code cannot grow unseen.
// Pre-rendered HTML is left out: every new page adds some, and the per-page budget already
// bounds each page's own HTML. Measured at 563 KB on 2026-10-03.
export const MAX_GZIPPED_SIZE_KB = 650;
/** Gzipped budget in KB for the pure TypeScript link safety engine (@/packages/link-safety). */
export const MAX_LINK_SAFETY_GZIPPED_SIZE_KB = 6;

/**
 * Gzipped budget in KB for each of our own Rust modules in `src/wasm/` (#1182, ADR 0033). Each
 * module's issue sets its line; a module without one fails the check.
 */
export const WASM_MODULE_BUDGETS_KB = {
  selftest: 4,
  'qr-encode': 20,
  'qr-decode': 32,
  'prism-fec': 10,
  'fountain-bcur': 40,
  // 40 KB under #1198; 48 KB since #1161 added the strict fiducial search (ADR 0047), about 45 KB;
  // 52 KB since slanted tear cuts (ADR 0049) took it to about 49.2 KB. It loads only for file transfer.
  modem: 52,
  'excel-parse': 30,
  // About 4.3 KB under #1556. Only the Scannability Worker and the on-demand pixel check fetch it.
  'optical-sim': 6,
};

/**
 * Whether a file is one of our own Rust modules, as committed (`selftest.wasm`) or as emitted with
 * a content hash (`selftest.Bb9Mx2Pu.wasm` by pages, `selftest-Bb9Mx2Pu.wasm` by worker bundles).
 * @param {string} relativePath
 * @param {string[]} [modules]
 * @returns {boolean}
 */
export function isOwnWasmModule(relativePath, modules = Object.keys(WASM_MODULE_BUDGETS_KB)) {
  const base = relativePath.split('/').pop() ?? '';
  return modules.some((name) => base === `${name}.wasm` || ((base.startsWith(`${name}.`) || base.startsWith(`${name}-`)) && /^[\w-]+\.wasm$/.test(base.slice(name.length + 1))));
}

/**
 * Measures each committed Rust module against its own budget. These are the exact bytes the site
 * ships, so the check needs no build.
 * @param {string} [wasmDir]
 * @param {Record<string, number>} [budgets]
 * @returns {{ modules: Array<{name: string, rawSize: number, gzipSize: number, limitBytes: number, exceeds: boolean}>, unbudgeted: string[] }}
 */
export function checkWasmModuleBudgets(wasmDir = WASM_DIR, budgets = WASM_MODULE_BUDGETS_KB) {
  const modules = [];
  const unbudgeted = [];
  const files = fs.existsSync(wasmDir) ? fs.readdirSync(wasmDir).filter((file) => file.endsWith('.wasm')).sort() : [];
  for (const file of files) {
    const name = file.slice(0, -'.wasm'.length);
    const budget = budgets[name];
    if (budget === undefined) {
      unbudgeted.push(name);
      continue;
    }
    const content = fs.readFileSync(path.join(wasmDir, file));
    const gzipSize = zlib.gzipSync(content).length;
    const limitBytes = budget * 1024;
    modules.push({ name, rawSize: content.length, gzipSize, limitBytes, exceeds: gzipSize > limitBytes });
  }
  return { modules, unbudgeted };
}

// The experimental optical channel probe (#1162) carries this string, so its chunk can be told apart
// whatever the bundler names it. Keep it in step with `PROBE_CHUNK_MARKER` in
// src/pages/dev-sandbox/optical-probe/ProbeApp.tsx.
export const OPTICAL_PROBE_MARKER = 'qrcraftly-optical-probe-chunk';

/**
 * Whether a file is the experimental optical channel probe (#1162). It is a measuring tool behind
 * the `VITE_OPTICAL_MODEM` flag, loaded only by its own unlinked page, so it stays out of the
 * site-total ceiling. It is never part of a page's first load, which is measured separately.
 * @param {string} relativePath
 * @param {Buffer} content
 * @returns {boolean}
 */
export function isOpticalProbe(relativePath, content) {
  return /\.m?js$/.test(relativePath) && content.includes(OPTICAL_PROBE_MARKER);
}

/**
 * Whether a file is shipped JavaScript or CSS, the only files the site-total ceiling counts.
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isShippedCode(relativePath) {
  return /\.(?:m?js|css)$/.test(relativePath);
}

/**
 * Whether a file is a share image or example picture. Visitors fetch one only when a crawler or
 * a page asks for it, so these never count toward the site total.
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isGeneratedMedia(relativePath) {
  return relativePath.startsWith('og/') || relativePath.startsWith('examples/');
}

/**
 * Names the Rust module a built `.wasm` file is, whatever hash the bundler gave it.
 * @param {string} relativePath
 * @returns {string | undefined}
 */
export function wasmModuleName(relativePath) {
  return Object.keys(WASM_MODULE_BUDGETS_KB).find((name) => isOwnWasmModule(relativePath, [name]));
}

/**
 * Follows a page's static imports from its HTML.
 * @param {string} distDir
 * @param {string} page POSIX path of the page's HTML, relative to `distDir`.
 * @returns {Set<string>} The HTML, stylesheets and startup scripts, relative to `distDir`.
 */
export function readStartupFiles(distDir, page) {
  const loaded = new Set();
  const queue = [page];
  while (queue.length > 0) {
    const next = queue.pop();
    if (loaded.has(next) || !fs.existsSync(path.join(distDir, next))) continue;
    loaded.add(next);
    if (next.endsWith('.css')) continue;
    for (const ref of readAssetReferences(next, fs.readFileSync(path.join(distDir, next), 'utf8'))) queue.push(ref);
  }
  return loaded;
}

/**
 * The Rust modules a page fetches as soon as it opens (#1594): those its startup scripts load
 * themselves and those the workers they start load, unless the page is in
 * {@link ON_DEMAND_WASM_PAGES}. A module is counted once even when two copies are reachable.
 * @param {string} distDir
 * @param {string} page POSIX path of the page's HTML, relative to `distDir`.
 * @param {Set<string>} [startupFiles] The page's startup files, if already read.
 * @returns {Map<string, string>} Module name to the built file measured for it.
 */
export function readStartupWasm(distDir, page, startupFiles = readStartupFiles(distDir, page)) {
  const modules = new Map();
  if (ON_DEMAND_WASM_PAGES.includes(page)) return modules;
  const read = (relativePath) => fs.readFileSync(path.join(distDir, relativePath), 'utf8');
  const add = (relativePath) => {
    const name = wasmModuleName(relativePath);
    if (name && !modules.has(name) && fs.existsSync(path.join(distDir, relativePath))) modules.set(name, relativePath);
  };
  for (const file of [...startupFiles].sort()) {
    if (!file.endsWith('.js')) continue;
    for (const ref of readWorkerReferences(file, read(file))) {
      if (ref.endsWith('.wasm')) add(ref);
      else if (fs.existsSync(path.join(distDir, ref))) {
        for (const workerRef of readWorkerReferences(ref, read(ref))) if (workerRef.endsWith('.wasm')) add(workerRef);
      }
    }
  }
  return modules;
}

/**
 * Measures the first load of every page: the gzipped size of its HTML plus every stylesheet and
 * script it loads at startup, found by following static imports, and separately the Rust modules
 * it fetches on open ({@link readStartupWasm}).
 * @param {string} distDir
 * @returns {Array<{page: string, files: number, gzipSize: number, wasm: string[], wasmGzipSize: number, totalGzipSize: number}>} Pages, largest total first.
 */
export function measurePageLoads(distDir) {
  const gzipOf = (relativePath) => zlib.gzipSync(fs.readFileSync(path.join(distDir, relativePath))).length;
  const posix = (file) => path.relative(distDir, file).split(path.sep).join('/');
  const pages = getFiles(distDir).map(posix).filter((file) => file.endsWith('.html'));
  return pages
    .map((page) => {
      const loaded = readStartupFiles(distDir, page);
      let gzipSize = 0;
      for (const file of loaded) gzipSize += gzipOf(file);
      const wasm = readStartupWasm(distDir, page, loaded);
      let wasmGzipSize = 0;
      for (const file of wasm.values()) wasmGzipSize += gzipOf(file);
      return { page, files: loaded.size, gzipSize, wasm: [...wasm.keys()].sort(), wasmGzipSize, totalGzipSize: gzipSize + wasmGzipSize };
    })
    .sort((a, b) => b.totalGzipSize - a.totalGzipSize);
}

/**
 * Finds the vendor chunk that `manualChunks` in vite.config.ts splits React into (#1594), and
 * whether React's renderer leaked back into Vike's client entry, which changes on every release.
 * @param {string} distDir
 * @returns {{ vendor: string | null, entryHasReact: boolean }} POSIX paths relative to `distDir`.
 */
export function checkVendorChunk(distDir) {
  const posix = (file) => path.relative(distDir, file).split(path.sep).join('/');
  const files = getFiles(path.join(distDir, 'assets')).map(posix);
  const vendor = files.find((file) => /^assets\/chunks\/vendor\.[\w-]+\.js$/.test(file)) ?? null;
  const hasRenderer = (file) => fs.readFileSync(path.join(distDir, file), 'utf8').includes('hydrateRoot');
  const entryHasReact = files.filter((file) => /^assets\/entries\/entry-client-routing\.[\w-]+\.js$/.test(file)).some(hasRenderer);
  return { vendor: vendor && hasRenderer(vendor) ? vendor : null, entryHasReact };
}

/**
 * Recursively gets all file paths in a directory.
 * @param {string} dir 
 * @returns {string[]}
 */
export const getFiles = (dir) => walkFiles(dir);

/**
 * Calculates raw and gzipped sizes of all files in a directory.
 * Only JavaScript and CSS count toward the limit; our own `.wasm` modules have their own lines
 * ({@link WASM_MODULE_BUDGETS_KB}), any other `.wasm` is listed in `unbudgetedWasm`, and every file
 * is still listed in `reports`.
 * @param {string} distDir 
 * @param {number} limitKb 
 * @returns {{totalRawSize: number, totalGzipSize: number, limitBytes: number, unbudgetedWasm: string[], reports: Array<{path: string, rawSize: number, gzipSize: number}>, exceeds: boolean}}
 */
export function verifyBundleSize(distDir, limitKb) {
  const limitBytes = limitKb * 1024;
  const files = getFiles(distDir);
  let totalGzipSize = 0;
  let totalRawSize = 0;
  const unbudgetedWasm = [];
  const reports = [];

  for (const file of files) {
    const relativePath = path.relative(distDir, file);
    const content = fs.readFileSync(file);
    const gzipped = zlib.gzipSync(content);
    reports.push({
      path: relativePath,
      rawSize: content.length,
      gzipSize: gzipped.length
    });
    const posixPath = relativePath.split(path.sep).join('/');
    if (posixPath.endsWith('.wasm') && !isOwnWasmModule(posixPath)) {
      unbudgetedWasm.push(posixPath);
      continue;
    }
    if (isGeneratedMedia(posixPath) || isOpticalProbe(posixPath, content) || !isShippedCode(posixPath)) continue;
    totalRawSize += content.length;
    totalGzipSize += gzipped.length;
  }

  return {
    totalRawSize,
    totalGzipSize,
    limitBytes,
    unbudgetedWasm,
    reports,
    exceeds: totalGzipSize > limitBytes
  };
}

/**
 * Measures the standalone gzipped bundle size of `@/packages/link-safety`.
 * Confirms the package operates purely via TypeScript and remains under 6 KB gzipped.
 * @param {number} [limitKb]
 * @returns {Promise<{ rawSize: number, gzipSize: number, limitBytes: number, exceeds: boolean }>}
 */
export async function verifyLinkSafetyBundleSize(limitKb = MAX_LINK_SAFETY_GZIPPED_SIZE_KB) {
  const { build } = await import('vite');
  const entry = path.resolve(__dirname, '../src/packages/link-safety/index.ts');
  const srcDir = path.resolve(__dirname, '../src');

  const res = await build({
    configFile: false,
    resolve: { alias: { '@': srcDir } },
    build: {
      target: 'esnext',
      lib: { entry, formats: ['es'], fileName: 'index' },
      write: false,
      minify: 'esbuild',
    },
  });

  const output = Array.isArray(res) ? res[0].output : res.output;
  const code = output[0].code;
  const gzipSize = zlib.gzipSync(code).length;
  const limitBytes = limitKb * 1024;

  return {
    rawSize: code.length,
    gzipSize,
    limitBytes,
    exceeds: gzipSize > limitBytes,
  };
}

export async function runCheck() {
  try {
    const result = verifyBundleSize(DIST_DIR, MAX_GZIPPED_SIZE_KB);
    
    console.log('Calculating Gzipped sizes for client distribution files...\n');
    console.log(
      `${'File Path'.padEnd(65)} | ${'Raw Size'.padStart(10)} | ${'Gzip Size'.padStart(10)}`
    );
    console.log('-'.repeat(91));

    for (const report of result.reports) {
      console.log(
        `${report.path.padEnd(65)} | ${(report.rawSize / 1024).toFixed(2).padStart(7)} KB | ${(report.gzipSize / 1024).toFixed(2).padStart(7)} KB`
      );
    }

    console.log('-'.repeat(91));

    const vendorChunk = checkVendorChunk(DIST_DIR);
    if (!vendorChunk.vendor || vendorChunk.entryHasReact) {
      console.error(
        `\n❌ ERROR: React is not in its own vendor chunk (vendor: ${vendorChunk.vendor ?? 'none'}, React in the client entry: ${vendorChunk.entryHasReact}). Fix: check that manualChunks and the vendor chunk name plugin in vite.config.ts still match the module ids Vite passes.`
      );
      process.exit(1);
    }
    console.log(`\nVendor chunk: ${vendorChunk.vendor}`);

    const pageLoads = measurePageLoads(DIST_DIR);
    const kb = (bytes) => (bytes / 1024).toFixed(2).padStart(7);
    console.log('\nFirst load per page (gzipped): code is HTML + startup scripts + CSS; WebAssembly is the Rust modules fetched on open\n');
    console.log(`${'Page'.padEnd(40)} | ${'files'.padStart(5)} | ${'code'.padStart(10)} | ${'wasm'.padStart(10)} | ${'total'.padStart(10)} | modules`);
    for (const load of pageLoads) {
      console.log(
        `${('/' + load.page.replace(/index\.html$/, '').replace(/\.html$/, '')).padEnd(40)} | ${String(load.files).padStart(5)} | ${kb(load.gzipSize)} KB | ${kb(load.wasmGzipSize)} KB | ${kb(load.totalGzipSize)} KB | ${load.wasm.join(', ') || '-'}`
      );
    }
    const worstCode = [...pageLoads].sort((a, b) => b.gzipSize - a.gzipSize)[0];
    const worstTotal = pageLoads[0];
    console.log(
      `\nWorst page first load: ${worstCode ? kb(worstCode.gzipSize).trim() : '0'} KB of code (budget ${MAX_PAGE_FIRST_LOAD_KB}.00 KB), ${worstTotal ? kb(worstTotal.totalGzipSize).trim() : '0'} KB with WebAssembly (budget ${MAX_PAGE_FIRST_LOAD_WITH_WASM_KB}.00 KB)`
    );
    if (worstCode && worstCode.gzipSize > MAX_PAGE_FIRST_LOAD_KB * 1024) {
      console.error(
        `\n❌ ERROR: The first load of /${worstCode.page} (${kb(worstCode.gzipSize).trim()} KB gzipped) exceeds the ${MAX_PAGE_FIRST_LOAD_KB} KB per-page budget! Fix: lazy-load what the page does not need to draw, or move it out of the shared chunks.`
      );
      process.exit(1);
    }
    if (worstTotal && worstTotal.totalGzipSize > MAX_PAGE_FIRST_LOAD_WITH_WASM_KB * 1024) {
      console.error(
        `\n❌ ERROR: The first load of /${worstTotal.page} with WebAssembly (${kb(worstTotal.totalGzipSize).trim()} KB gzipped: ${worstTotal.wasm.join(', ')}) exceeds the ${MAX_PAGE_FIRST_LOAD_WITH_WASM_KB} KB budget! Fix: fetch the module when the feature first runs, or cut the page's code.`
      );
      process.exit(1);
    }

    console.log(
      `\nGrand Total Raw Size:     ${(result.totalRawSize / 1024).toFixed(2)} KB`
    );
    console.log(
      `Grand Total Gzipped Size: ${(result.totalGzipSize / 1024).toFixed(2)} KB`
    );
    console.log(`Max Allowed Gzipped Size: ${MAX_GZIPPED_SIZE_KB}.00 KB`);

    if (result.exceeds) {
      console.error(
        `\n❌ ERROR: Total Gzipped net transfer size of client-side assets (${(result.totalGzipSize / 1024).toFixed(2)} KB) exceeds the limit of ${MAX_GZIPPED_SIZE_KB} KB!`
      );
      process.exit(1);
    }

    if (result.unbudgetedWasm.length > 0) {
      console.error(
        `\n❌ ERROR: dist/client ships WebAssembly that is not one of our Rust modules: ${result.unbudgetedWasm.join(', ')}. Fix: build it from crates/ into src/wasm/ and add a line to WASM_MODULE_BUDGETS_KB in scripts/check-bundle-size.js.`
      );
      process.exit(1);
    }

    const own = checkWasmModuleBudgets();
    for (const module of own.modules) {
      console.log(
        `Rust module ${module.name}: ${(module.gzipSize / 1024).toFixed(2)} KB gzipped (budget ${(module.limitBytes / 1024).toFixed(2)} KB, not in the total)`
      );
    }
    if (own.unbudgeted.length > 0) {
      console.error(`\n❌ ERROR: src/wasm/ has modules without a budget: ${own.unbudgeted.join(', ')}. Fix: add a line to WASM_MODULE_BUDGETS_KB in scripts/check-bundle-size.js.`);
      process.exit(1);
    }
    const over = own.modules.find((module) => module.exceeds);
    if (over) {
      console.error(
        `\n❌ ERROR: The Rust module ${over.name} (${(over.gzipSize / 1024).toFixed(2)} KB gzipped) exceeds its ${(over.limitBytes / 1024).toFixed(2)} KB budget!`
      );
      process.exit(1);
    }

    const linkSafety = await verifyLinkSafetyBundleSize();
    console.log(
      `Package @/packages/link-safety: ${(linkSafety.gzipSize / 1024).toFixed(2)} KB gzipped (budget ${MAX_LINK_SAFETY_GZIPPED_SIZE_KB}.00 KB)`
    );
    if (linkSafety.exceeds) {
      console.error(
        `\n❌ ERROR: The link-safety package (${(linkSafety.gzipSize / 1024).toFixed(2)} KB gzipped) exceeds its ${MAX_LINK_SAFETY_GZIPPED_SIZE_KB}.00 KB budget!`
      );
      process.exit(1);
    }

    console.log(`\n✅ Every page is within its first-load budget and the site is within its ${MAX_GZIPPED_SIZE_KB} KB ceiling!`);
    process.exit(0);
  } catch (err) {
    console.error('Error running bundle size check:', err);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && (fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url));
if (isDirectRun) {
  runCheck();
}
