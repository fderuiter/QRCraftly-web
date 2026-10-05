import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
// The service worker generator already knows how to follow a page's startup assets.
const { readAssetReferences } = require('./generate_sw.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.resolve(__dirname, '../dist/client');
const WASM_DIR = path.resolve(__dirname, '../src/wasm');
// What one visitor downloads to open one page (#1106): its HTML, the CSS and the scripts it loads
// at startup (static imports, not lazy chunks, workers or WebAssembly modules). The worst page is the
// number that matters for load time, so this is the budget that catches JavaScript bloat.
export const MAX_PAGE_FIRST_LOAD_KB = 260;
// A loose backstop on the JavaScript and CSS in dist/client, so shipped code cannot grow unseen.
// Pre-rendered HTML is left out: every new page adds some, and the per-page budget already
// bounds each page's own HTML. Measured at 563 KB on 2026-10-03.
export const MAX_GZIPPED_SIZE_KB = 650;

/**
 * Gzipped budget in KB for each of our own Rust modules in `src/wasm/` (#1182, ADR 0033). Each
 * module's issue sets its line; a module without one fails the check.
 */
export const WASM_MODULE_BUDGETS_KB = {
  selftest: 4,
  'qr-encode': 20,
  'qr-decode': 32,
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
 * Measures the first load of every page: the gzipped size of its HTML plus every stylesheet and
 * script it loads at startup, found by following static imports.
 * @param {string} distDir
 * @returns {Array<{page: string, files: number, gzipSize: number}>} Pages, largest first.
 */
export function measurePageLoads(distDir) {
  const gzipOf = (relativePath) => zlib.gzipSync(fs.readFileSync(path.join(distDir, relativePath))).length;
  const posix = (file) => path.relative(distDir, file).split(path.sep).join('/');
  const pages = getFiles(distDir).map(posix).filter((file) => file.endsWith('.html'));
  return pages
    .map((page) => {
      const loaded = new Set();
      const queue = [page];
      while (queue.length > 0) {
        const next = queue.pop();
        if (loaded.has(next) || !fs.existsSync(path.join(distDir, next))) continue;
        loaded.add(next);
        if (next.endsWith('.css')) continue;
        for (const ref of readAssetReferences(next, fs.readFileSync(path.join(distDir, next), 'utf8'))) queue.push(ref);
      }
      let gzipSize = 0;
      for (const file of loaded) gzipSize += gzipOf(file);
      return { page, files: loaded.size, gzipSize };
    })
    .sort((a, b) => b.gzipSize - a.gzipSize);
}

/**
 * Recursively gets all file paths in a directory.
 * @param {string} dir 
 * @returns {string[]}
 */
export function getFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results = results.concat(getFiles(fullPath));
    } else if (stat.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

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

export function runCheck() {
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

    const pageLoads = measurePageLoads(DIST_DIR);
    console.log('\nFirst load per page (HTML + startup scripts + CSS, gzipped):\n');
    for (const load of pageLoads) {
      console.log(
        `${('/' + load.page.replace(/index\.html$/, '').replace(/\.html$/, '')).padEnd(40)} | ${String(load.files).padStart(3)} files | ${(load.gzipSize / 1024).toFixed(2).padStart(7)} KB`
      );
    }
    const worstPage = pageLoads[0];
    console.log(
      `\nWorst page first load: ${worstPage ? (worstPage.gzipSize / 1024).toFixed(2) : '0'} KB (budget ${MAX_PAGE_FIRST_LOAD_KB}.00 KB)`
    );
    if (worstPage && worstPage.gzipSize > MAX_PAGE_FIRST_LOAD_KB * 1024) {
      console.error(
        `\n❌ ERROR: The first load of /${worstPage.page} (${(worstPage.gzipSize / 1024).toFixed(2)} KB gzipped) exceeds the ${MAX_PAGE_FIRST_LOAD_KB} KB per-page budget!`
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
