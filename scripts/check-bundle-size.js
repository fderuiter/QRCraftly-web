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
// What one visitor downloads to open one page (#1106): its HTML, the CSS and the scripts it loads
// at startup (static imports, not lazy chunks, workers or the wasm reader). The worst page is the
// number that matters for load time, so this is the budget that catches JavaScript bloat.
export const MAX_PAGE_FIRST_LOAD_KB = 260;
// A loose backstop on the JavaScript and CSS in dist/client, so shipped code cannot grow unseen.
// Pre-rendered HTML is left out: every new page adds some, and the per-page budget already
// bounds each page's own HTML. Measured at 563 KB on 2026-10-03.
export const MAX_GZIPPED_SIZE_KB = 650;
// The scanner's zxing-wasm reader (ADR 0023) is fetched only when someone scans and is never
// precached, so it has its own budget instead of counting against the site's.
export const MAX_LAZY_WASM_GZIPPED_SIZE_KB = 450;

/**
 * Whether a file is the lazily loaded WebAssembly reader, budgeted separately.
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isLazyWasm(relativePath) {
  return relativePath.endsWith('.wasm');
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
 * Only JavaScript and CSS count toward the limit; the lazily loaded `.wasm` reader has its own
 * budget, and every file is still listed in `reports`.
 * @param {string} distDir 
 * @param {number} limitKb 
 * @param {number} [wasmLimitKb]
 * @returns {{totalRawSize: number, totalGzipSize: number, limitBytes: number, wasmGzipSize: number, wasmLimitBytes: number, reports: Array<{path: string, rawSize: number, gzipSize: number}>, exceeds: boolean, wasmExceeds: boolean}}
 */
export function verifyBundleSize(distDir, limitKb, wasmLimitKb = MAX_LAZY_WASM_GZIPPED_SIZE_KB) {
  const limitBytes = limitKb * 1024;
  const wasmLimitBytes = wasmLimitKb * 1024;
  const files = getFiles(distDir);
  let totalGzipSize = 0;
  let totalRawSize = 0;
  let wasmGzipSize = 0;
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
    if (isLazyWasm(posixPath)) {
      wasmGzipSize += gzipped.length;
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
    wasmGzipSize,
    wasmLimitBytes,
    reports,
    exceeds: totalGzipSize > limitBytes,
    wasmExceeds: wasmGzipSize > wasmLimitBytes
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

    console.log(
      `Lazy WebAssembly Gzipped: ${(result.wasmGzipSize / 1024).toFixed(2)} KB (budget ${MAX_LAZY_WASM_GZIPPED_SIZE_KB}.00 KB, not in the total)`
    );
    if (result.wasmExceeds) {
      console.error(
        `\n❌ ERROR: The lazily loaded WebAssembly (${(result.wasmGzipSize / 1024).toFixed(2)} KB gzipped) exceeds its ${MAX_LAZY_WASM_GZIPPED_SIZE_KB} KB budget!`
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
