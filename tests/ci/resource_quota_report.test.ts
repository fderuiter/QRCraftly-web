import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { walkFiles } from '../../scripts/utils/sourceFiles.js';

const SCRIPT = '../../scripts/resource-quota-report.js';

describe('scripts/resource-quota-report.js', () => {
  it('writes nothing when imported', async () => {
    const write = vi.spyOn(fs, 'writeFileSync');
    try {
      vi.resetModules();
      await import(SCRIPT);
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it('flags the file count at 90% of the ceiling and not just under it', async () => {
    const { MAX_FILES, buildQuotaReport } = await import(SCRIPT);
    const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `f${i}`, size: 1 }));
    const at = buildQuotaReport(files(MAX_FILES * 0.9));
    expect(at.warning).toBe(true);
    expect(at.markdown).toMatch(/\*\*File Count\*\* \| 18000 \| 20000 \| 90\.00% \| ⚠️ WARNING/);
    expect(at.markdown).toContain('within 10% of a Workers Static Assets hard ceiling');
    const under = buildQuotaReport(files(MAX_FILES * 0.9 - 1));
    expect(under.warning).toBe(false);
    expect(under.markdown).toContain('✅ Resource usage is well within limits.');
  });

  it('flags the largest file at 90% of the size ceiling and not just under it', async () => {
    const { MAX_FILE_SIZE_BYTES, buildQuotaReport } = await import(SCRIPT);
    const big = Math.ceil(MAX_FILE_SIZE_BYTES * 0.9);
    const at = buildQuotaReport([
      { path: 'small.js', size: 10 },
      { path: 'dist/client/big.wasm', size: big },
    ]);
    expect(at).toMatchObject({ warning: true, maxFileName: 'dist/client/big.wasm', totalSize: big + 10, fileCount: 2 });
    expect(at.markdown).toMatch(/\*\*Max File Size\*\* \| 22\.50 MB \| 25 MB \| 90\.00% \| ⚠️ WARNING/);
    expect(at.markdown).toContain('`dist/client/big.wasm`');
    expect(buildQuotaReport([{ path: 'big.wasm', size: big - 1 }]).warning).toBe(false);
  });

  it('reports an empty build without dividing by nothing', async () => {
    const { buildQuotaReport } = await import(SCRIPT);
    const empty = buildQuotaReport([]);
    expect(empty).toMatchObject({ fileCount: 0, maxFileSize: 0, warning: false });
    expect(empty.markdown).toContain('`N/A`');
  });

  it('never names Cloudflare Pages', () => {
    const source = fs.readFileSync(path.resolve(__dirname, SCRIPT), 'utf8');
    expect(source).not.toMatch(/Pages/);
  });
});

describe('scripts/utils/sourceFiles.js walkFiles', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-files-'));
    fs.mkdirSync(path.join(tmp, 'a/b'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'node_modules'));
    fs.writeFileSync(path.join(tmp, 'top.js'), '');
    fs.writeFileSync(path.join(tmp, 'a/b/deep.css'), '');
    fs.writeFileSync(path.join(tmp, 'node_modules/dep.js'), '');
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const names = (files: string[]) => files.map((f) => path.relative(tmp, f).split(path.sep).join('/')).sort();

  it('lists every file under the root', () => {
    expect(names(walkFiles(tmp))).toEqual(['a/b/deep.css', 'node_modules/dep.js', 'top.js']);
  });

  it('filters by extension and skips excluded directories', () => {
    expect(names(walkFiles(tmp, { exts: ['.js'], excludeDirs: ['node_modules'] }))).toEqual(['top.js']);
  });

  it('gives an empty list for a missing root', () => {
    expect(walkFiles(path.join(tmp, 'missing'))).toEqual([]);
  });
});
