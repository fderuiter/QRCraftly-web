import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execBinary } from '../utils/execHelper';
import {
  COLLAPSE_AFTER_ROWS,
  buildSummary,
  capBytes,
  changedFilesTable,
  escapeCell,
  toRanges,
  uncoveredLines,
} from '../../scripts/ci/coverage_summary.js';

const SCRIPT = path.resolve(__dirname, '../../scripts/ci/coverage_summary.js');
const THRESHOLDS = { statements: 80, branches: 72, functions: 85, lines: 80 };

function metric(covered: number, total: number) {
  return { covered, total, skipped: 0, pct: total === 0 ? 100 : Math.round((covered / total) * 10000) / 100 };
}

function fileSummary(lines: [number, number], branches: [number, number]) {
  return {
    lines: metric(...lines),
    statements: metric(...lines),
    functions: metric(1, 1),
    branches: metric(...branches),
  };
}

/** Three statements on lines 1-3; the second and third never ran. */
function fileDetail() {
  return {
    statementMap: {
      '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
      '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
      '2': { start: { line: 3, column: 0 }, end: { line: 3, column: 5 } },
      '3': { start: { line: 7, column: 0 }, end: { line: 7, column: 5 } },
    },
    s: { '0': 4, '1': 0, '2': 0, '3': 0 },
  };
}

describe('scripts/ci/coverage_summary.js', () => {
  let tmp: string;
  let coverageDir: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-summary-'));
    coverageDir = path.join(tmp, 'coverage');
    fs.mkdirSync(coverageDir);
    const root = tmp;
    const a = path.join(root, 'src', 'utils', 'a.ts');
    const odd = path.join(root, 'src', 'utils', 'my file_*[x]|y.ts');
    fs.writeFileSync(
      path.join(coverageDir, 'coverage-summary.json'),
      JSON.stringify({
        total: {
          lines: metric(81, 100),
          statements: metric(79, 100),
          functions: metric(90, 100),
          branches: metric(72, 100),
        },
        [a]: fileSummary([1, 4], [0, 2]),
        [odd]: fileSummary([4, 4], [2, 2]),
      }),
    );
    fs.writeFileSync(path.join(coverageDir, 'coverage-final.json'), JSON.stringify({ [a]: fileDetail() }));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('builds the totals table with floors and pass or fail marks', () => {
    const md = buildSummary({ coverageDir, root: tmp, thresholds: THRESHOLDS, changed: null });
    expect(md).toContain('| Lines | 81.00% | 81 / 100 | 80% | ✅ |');
    expect(md).toContain('| Statements | 79.00% | 79 / 100 | 80% | ❌ |');
    expect(md).toContain('| Branches | 72.00% | 72 / 100 | 72% | ✅ |');
    expect(md).not.toContain('Changed files');
  });

  it('lists only changed files that are in the coverage data, with uncovered ranges', () => {
    const md = buildSummary({
      coverageDir,
      root: tmp,
      thresholds: THRESHOLDS,
      changed: ['src/utils/a.ts', 'src/components/NotCovered.tsx', 'README.md'],
    });
    expect(md).toContain('### Changed files');
    expect(md).toContain('| src/utils/a.ts | 25.00% | 0.00% | 2-3, 7 |');
    expect(md).not.toContain('NotCovered');
    expect(md).not.toContain('README');
  });

  it('says so when no changed file is in scope', () => {
    const md = buildSummary({ coverageDir, root: tmp, thresholds: THRESHOLDS, changed: ['README.md'] });
    expect(md).toContain('_No changed file is in the coverage scope._');
  });

  it('escapes paths with spaces and Markdown characters', () => {
    const md = buildSummary({
      coverageDir,
      root: tmp,
      thresholds: THRESHOLDS,
      changed: ['src/utils/my file_*[x]|y.ts'],
    });
    expect(md).toContain('| src/utils/my file\\_\\*\\[x\\]\\|y.ts | 100.00% | 100.00% | - |');
    expect(escapeCell('<b>&`#~')).toBe('&lt;b&gt;&amp;\\`\\#\\~');
  });

  it('folds the changed-files table past the row limit', () => {
    const summaries: Record<string, ReturnType<typeof fileSummary>> = {};
    const files: string[] = [];
    for (let i = 0; i <= COLLAPSE_AFTER_ROWS; i++) {
      const file = `src/f${i}.ts`;
      files.push(file);
      summaries[file] = fileSummary([1, 1], [1, 1]);
    }
    const folded = changedFilesTable(files, summaries, {});
    expect(folded.startsWith(`<details><summary>${COLLAPSE_AFTER_ROWS + 1} changed files</summary>`)).toBe(true);
    const flat = changedFilesTable(files.slice(1), summaries, {});
    expect(flat.startsWith('<details>')).toBe(false);
  });

  it('collapses line numbers into ranges and applies the line rule', () => {
    expect(toRanges([1, 2, 3, 5, 8, 9])).toBe('1-3, 5, 8-9');
    expect(toRanges([])).toBe('');
    expect(uncoveredLines(undefined)).toEqual([]);
    const shared = {
      statementMap: {
        '0': { start: { line: 4 }, end: { line: 4 } },
        '1': { start: { line: 4 }, end: { line: 4 } },
      },
      s: { '0': 0, '1': 2 },
    };
    expect(uncoveredLines(shared)).toEqual([]);
  });

  it('caps the summary at the byte limit', () => {
    const text = Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(50)}`).join('\n');
    const capped = capBytes(text, 2000);
    expect(Buffer.byteLength(capped, 'utf8')).toBeLessThanOrEqual(2000);
    expect(capped).toContain('Truncated');
    expect(capBytes('short', 2000)).toBe('short');
  });

  it('prints a note and exits 0 when coverage files are missing', () => {
    const summaryFile = path.join(tmp, 'missing-summary.md');
    execBinary('node', [SCRIPT], {
      env: { ...process.env, COVERAGE_DIR: path.join(tmp, 'nope'), GITHUB_STEP_SUMMARY: summaryFile, EVENT_NAME: 'push' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('No coverage report was found');
  });

  it('appends the totals to the step summary file when run as a script', () => {
    const summaryFile = path.join(tmp, 'summary.md');
    fs.writeFileSync(summaryFile, 'earlier step\n');
    execBinary('node', [SCRIPT], {
      env: { ...process.env, COVERAGE_DIR: coverageDir, GITHUB_STEP_SUMMARY: summaryFile, EVENT_NAME: 'push' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const written = fs.readFileSync(summaryFile, 'utf8');
    expect(written.startsWith('earlier step\n## Coverage')).toBe(true);
    expect(written).toContain('| Functions | 90.00% | 90 / 100 | 85% | ✅ |');
  });
});
