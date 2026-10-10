/**
 * Writes the unit-test coverage table to the run's summary page, replacing the
 * third-party davelosert/vitest-coverage-report-action (GitHub issue #1185).
 *
 * It reads the `json-summary` and `json` reports Vitest writes to `coverage/`
 * and appends Markdown to $GITHUB_STEP_SUMMARY:
 * - totals for lines, statements, functions and branches against the floors in
 *   `scripts/ci/coverage_thresholds.json` (the same file vite.config.ts reads);
 * - on pull requests, each changed source file with its line and branch
 *   percentages and its uncovered line ranges.
 *
 * It only informs. Vitest's own thresholds fail the job; this script exits 0
 * unless it crashes, and prints a note when there is no coverage to show.
 * It needs no GitHub token and no write permission. Inputs come from the step's
 * `env:` block: EVENT_NAME, BASE_REF and, for tests, COVERAGE_DIR and
 * GITHUB_STEP_SUMMARY.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeChangedFiles } from './changed_files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const THRESHOLDS_PATH = path.join(__dirname, 'coverage_thresholds.json');

/** GitHub rejects a step summary over 1 MiB. */
export const SUMMARY_LIMIT_BYTES = 1024 * 1024;
/** Changed-file tables longer than this are folded into a `<details>` block. */
export const COLLAPSE_AFTER_ROWS = 30;

const METRICS = /** @type {const} */ (['lines', 'statements', 'functions', 'branches']);

/**
 * @typedef {{ total: number, covered: number, pct: number | string }} Metric
 * @typedef {Record<'lines' | 'statements' | 'functions' | 'branches', Metric>} FileSummary
 * @typedef {{ start: { line: number }, end: { line: number } }} Span
 * @typedef {{ statementMap: Record<string, Span>, s: Record<string, number> }} FileCoverage
 */

/**
 * Reads and parses a JSON file, or returns null when it is missing.
 * @param {string} file
 * @returns {unknown}
 */
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Turns an absolute or relative path into a POSIX path relative to the repo.
 * @param {string} file
 * @param {string} root
 * @returns {string}
 */
export function toRepoPath(file, root = REPO_ROOT) {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file;
  return relative.split(path.sep).join('/').replace(/\\/g, '/');
}

/**
 * Escapes text for a Markdown table cell, so a path shows exactly as written.
 * @param {string} text
 * @returns {string}
 */
export function escapeCell(text) {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([\\`*_[\]#~|])/g, '\\$1');
}

/**
 * Formats a percentage the way Vitest prints it.
 * @param {number | string} pct
 * @returns {string}
 */
function formatPct(pct) {
  return typeof pct === 'number' ? `${pct.toFixed(2)}%` : String(pct);
}

/**
 * Collapses a sorted list of line numbers into ranges such as `3-5, 9`.
 * @param {number[]} lines
 * @returns {string}
 */
export function toRanges(lines) {
  /** @type {string[]} */
  const ranges = [];
  let start = -1;
  let prev = -1;
  for (const line of lines) {
    if (line === prev + 1 && start !== -1) {
      prev = line;
      continue;
    }
    if (start !== -1) ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = line;
    prev = line;
  }
  if (start !== -1) ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(', ');
}

/**
 * Lines whose statements never ran, using Istanbul's rule that a line is
 * covered when any statement starting on it ran.
 * @param {FileCoverage | undefined} file
 * @returns {number[]}
 */
export function uncoveredLines(file) {
  if (!file) return [];
  /** @type {Map<number, boolean>} */
  const lines = new Map();
  for (const [id, span] of Object.entries(file.statementMap)) {
    const line = span.start.line;
    const hit = (file.s[id] ?? 0) > 0;
    lines.set(line, (lines.get(line) ?? false) || hit);
  }
  return [...lines.entries()]
    .filter(([, hit]) => !hit)
    .map(([line]) => line)
    .sort((a, b) => a - b);
}

/**
 * The totals table.
 * @param {FileSummary} total
 * @param {Partial<Record<string, number>>} thresholds
 * @returns {string}
 */
export function totalsTable(total, thresholds) {
  const rows = ['| Metric | Coverage | Covered / total | Floor | Status |', '| --- | ---: | ---: | ---: | :---: |'];
  for (const metric of METRICS) {
    const value = total[metric];
    const floor = thresholds[metric];
    const pct = typeof value.pct === 'number' ? value.pct : 100;
    const status = floor === undefined ? '' : pct >= floor ? '✅' : '❌';
    const floorText = floor === undefined ? '-' : `${floor}%`;
    const name = metric[0].toUpperCase() + metric.slice(1);
    rows.push(`| ${name} | ${formatPct(value.pct)} | ${value.covered} / ${value.total} | ${floorText} | ${status} |`);
  }
  return rows.join('\n');
}

/**
 * The changed-files table, folded when it has many rows.
 * @param {string[]} changed POSIX paths relative to the repo root
 * @param {Record<string, FileSummary>} summaries keyed by repo path
 * @param {Record<string, FileCoverage>} details keyed by repo path
 * @returns {string}
 */
export function changedFilesTable(changed, summaries, details) {
  const files = changed.filter(file => summaries[file]).sort();
  if (files.length === 0) return '_No changed file is in the coverage scope._';
  const rows = ['| File | Lines | Branches | Uncovered lines |', '| --- | ---: | ---: | --- |'];
  for (const file of files) {
    const summary = summaries[file];
    const ranges = toRanges(uncoveredLines(details[file]));
    rows.push(
      `| ${escapeCell(file)} | ${formatPct(summary.lines.pct)} | ${formatPct(summary.branches.pct)} | ${ranges || '-'} |`,
    );
  }
  const table = rows.join('\n');
  if (files.length <= COLLAPSE_AFTER_ROWS) return table;
  return `<details><summary>${files.length} changed files</summary>\n\n${table}\n\n</details>`;
}

/**
 * Caps the text at `limit` bytes, cutting at a line end and saying so.
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
export function capBytes(text, limit = SUMMARY_LIMIT_BYTES) {
  if (Buffer.byteLength(text, 'utf8') <= limit) return text;
  const note = '\n\n_Truncated: the summary reached the 1 MiB step-summary limit._\n';
  const budget = limit - Buffer.byteLength(note, 'utf8');
  const lines = text.split(/\r?\n/);
  let out = '';
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (Buffer.byteLength(next, 'utf8') > budget) break;
    out = next;
  }
  return out + note;
}

/**
 * Builds the whole summary.
 * @param {{ coverageDir: string, root?: string, thresholds: Partial<Record<string, number>>, changed: string[] | null }} options
 * @returns {string}
 */
export function buildSummary({ coverageDir, root = REPO_ROOT, thresholds, changed }) {
  const summaryJson = /** @type {Record<string, FileSummary> | null} */ (
    readJson(path.join(coverageDir, 'coverage-summary.json'))
  );
  if (!summaryJson || !summaryJson.total) {
    return '## Coverage\n\n_No coverage report was found, so there is nothing to show. Check the test step above._\n';
  }
  const finalJson = /** @type {Record<string, FileCoverage> | null} */ (
    readJson(path.join(coverageDir, 'coverage-final.json'))
  ) ?? {};

  /** @type {Record<string, FileSummary>} */
  const summaries = {};
  for (const [file, value] of Object.entries(summaryJson)) {
    if (file !== 'total') summaries[toRepoPath(file, root)] = value;
  }
  /** @type {Record<string, FileCoverage>} */
  const details = {};
  for (const [file, value] of Object.entries(finalJson)) details[toRepoPath(file, root)] = value;

  const parts = ['## Coverage', '', totalsTable(summaryJson.total, thresholds), ''];
  if (changed) {
    parts.push('### Changed files', '', changedFilesTable(changed, summaries, details), '');
  }
  return capBytes(parts.join('\n'));
}

function main() {
  const coverageDir = path.resolve(process.env.COVERAGE_DIR || path.join(REPO_ROOT, 'coverage'));
  const thresholds = /** @type {Partial<Record<string, number>>} */ (readJson(THRESHOLDS_PATH) ?? {});
  const eventName = process.env.EVENT_NAME ?? '';
  let changed = null;
  if (eventName === 'pull_request') {
    const result = computeChangedFiles({ eventName, baseRef: process.env.BASE_REF ?? '' });
    changed = result.mode === 'pull_request' ? result.files : null;
  }

  const markdown = buildSummary({ coverageDir, thresholds, changed });
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    fs.appendFileSync(summaryPath, `${markdown}\n`, 'utf8');
  } else {
    console.log(markdown);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main();
}
