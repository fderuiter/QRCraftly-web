import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'node:crypto';
import { OPTICAL_PROBE_MARKER, WASM_MODULE_BUDGETS_KB, checkWasmModuleBudgets, getFiles, isOwnWasmModule, measurePageLoads, verifyBundleSize } from '../scripts/check-bundle-size.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMP_TEST_DIR = path.resolve(__dirname, './temp_bundle_size_test');

describe('Bundle Size Verification Script Tests', () => {
  beforeEach(() => {
    if (fs.existsSync(TEMP_TEST_DIR)) {
      fs.rmSync(TEMP_TEST_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEMP_TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEMP_TEST_DIR)) {
      fs.rmSync(TEMP_TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should recursively get all file paths in a directory', () => {
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'file1.txt'), 'Hello');
    
    const subDir = path.join(TEMP_TEST_DIR, 'subdir');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(subDir, 'file2.txt'), 'World');

    const files = getFiles(TEMP_TEST_DIR);
    expect(files).toHaveLength(2);
    expect(files.some(f => f.endsWith('file1.txt'))).toBe(true);
    expect(files.some(f => f.endsWith('file2.txt'))).toBe(true);
  });

  it('should verify gzipped bundle size limit checks within limit', () => {
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'file1.js'), 'Short text content.');
    
    const result = verifyBundleSize(TEMP_TEST_DIR, 10); // 10 KB limit
    expect(result.exceeds).toBe(false);
    expect(result.reports).toHaveLength(1);
    expect(result.totalRawSize).toBeGreaterThan(0);
    expect(result.totalGzipSize).toBeGreaterThan(0);
  });

  it('should detect when gzipped size exceeds the specified limit', () => {
    // Write 5 KB of text to exceed a 1 KB limit (with compression, it will still exceed 1 KB)
    const bulkyContent = 'A'.repeat(5000);
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'heavy.js'), bulkyContent);

    const result = verifyBundleSize(TEMP_TEST_DIR, 0.01); // 10 bytes limit
    // Verify results
    expect(result.exceeds).toBe(true);
  });

  it('counts only JavaScript and CSS toward the site total, not pre-rendered HTML', () => {
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'page.html'), 'H'.repeat(5000));
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'app.js'), 'console.log(1);');

    const result = verifyBundleSize(TEMP_TEST_DIR, 1);
    expect(result.exceeds).toBe(false);
    expect(result.reports).toHaveLength(2);
    expect(verifyBundleSize(TEMP_TEST_DIR, 1).totalRawSize).toBe('console.log(1);'.length);
  });

  it('leaves the experimental optical probe chunk out of the site total (#1162)', () => {
    fs.mkdirSync(path.join(TEMP_TEST_DIR, 'assets'));
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'app.js'), 'console.log(1);');
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'assets', 'chunk-AbC123.js'), `const marker = '${OPTICAL_PROBE_MARKER}';${'P'.repeat(9000)}`);

    const result = verifyBundleSize(TEMP_TEST_DIR, 1);
    expect(result.exceeds).toBe(false);
    expect(result.totalRawSize).toBe('console.log(1);'.length);
    expect(result.reports).toHaveLength(2);
  });

  it('budgets the lazily loaded wasm reader separately from the site total (ADR 0023)', () => {
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'app.js'), 'console.log(1);');
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'reader.wasm'), 'B'.repeat(5000));

    const result = verifyBundleSize(TEMP_TEST_DIR, 1, 10);
    expect(result.exceeds).toBe(false);
    expect(result.wasmGzipSize).toBeGreaterThan(0);
    expect(result.wasmExceeds).toBe(false);
    expect(result.reports).toHaveLength(2);

    expect(verifyBundleSize(TEMP_TEST_DIR, 1, 0.01).wasmExceeds).toBe(true);
  });

  it('gives each Rust module its own line, outside the reader budget (#1182)', () => {
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'selftest.Bb9Mx2Pu.wasm'), randomBytes(20_000));
    const result = verifyBundleSize(TEMP_TEST_DIR, 1, 1);
    expect(result.wasmGzipSize).toBe(0);
    expect(isOwnWasmModule('assets/static/selftest.Bb9Mx2Pu.wasm')).toBe(true);
    expect(isOwnWasmModule('selftest.wasm')).toBe(true);
    expect(isOwnWasmModule('assets/static/zxing_reader.Bb9Mx2Pu.wasm')).toBe(false);
    expect(isOwnWasmModule('selftester.wasm')).toBe(false);
  });

  it('measures committed Rust modules against their budgets and flags any without one (#1182)', () => {
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'small.wasm'), 'A'.repeat(100));
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'big.wasm'), randomBytes(5000));
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'stray.wasm'), 'C');
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'small.wasm.sha256'), 'not a module');
    const result = checkWasmModuleBudgets(TEMP_TEST_DIR, { small: 1, big: 1 });
    expect(result.modules.map((m) => [m.name, m.exceeds])).toEqual([['big', true], ['small', false]]);
    expect(result.unbudgeted).toEqual(['stray']);
  });

  it('keeps every committed Rust module within its budget', () => {
    const result = checkWasmModuleBudgets();
    expect(result.unbudgeted).toEqual([]);
    expect(result.modules.map((m) => m.name).sort()).toEqual(Object.keys(WASM_MODULE_BUDGETS_KB).sort());
    expect(result.modules.filter((m) => m.exceeds)).toEqual([]);
  });

  it('leaves generated share images and example pictures out of the site total (#1030)', () => {
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'app.js'), 'console.log(1);');
    fs.mkdirSync(path.join(TEMP_TEST_DIR, 'og'), { recursive: true });
    fs.mkdirSync(path.join(TEMP_TEST_DIR, 'examples'), { recursive: true });
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'og', 'wifi.png'), randomBytes(5000));
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'examples', 'wifi.svg'), randomBytes(5000));

    expect(verifyBundleSize(TEMP_TEST_DIR, 1).exceeds).toBe(false);
  });

  it('measures the first load of a page from its HTML, stylesheet and startup scripts only (#1106)', () => {
    const assets = path.join(TEMP_TEST_DIR, 'assets');
    fs.mkdirSync(path.join(assets, 'entries'), { recursive: true });
    fs.mkdirSync(path.join(assets, 'chunks'), { recursive: true });
    fs.mkdirSync(path.join(TEMP_TEST_DIR, 'about'), { recursive: true });
    fs.writeFileSync(
      path.join(TEMP_TEST_DIR, 'index.html'),
      '<link rel="stylesheet" href="/assets/s.css"><script src="/assets/entries/home.js"></script>'
    );
    fs.writeFileSync(path.join(TEMP_TEST_DIR, 'about', 'index.html'), '<script src="/assets/entries/about.js"></script>');
    fs.writeFileSync(path.join(assets, 's.css'), 'body{}');
    fs.writeFileSync(path.join(assets, 'entries', 'home.js'), 'import"../chunks/shared.js";const l=()=>import("../chunks/lazy.js");');
    fs.writeFileSync(path.join(assets, 'entries', 'about.js'), 'console.log("about");');
    fs.writeFileSync(path.join(assets, 'chunks', 'shared.js'), Math.random().toString(36).repeat(400));
    fs.writeFileSync(path.join(assets, 'chunks', 'lazy.js'), Math.random().toString(36).repeat(4000));

    const loads = measurePageLoads(TEMP_TEST_DIR);
    expect(loads.map((load) => load.page)).toEqual(['index.html', 'about/index.html']);
    // html + css + entry + shared chunk; the lazily imported chunk is not part of it.
    expect(loads[0].files).toBe(4);
    expect(loads[1].files).toBe(2);
    expect(loads[0].gzipSize).toBeGreaterThan(loads[1].gzipSize);
  });
});
