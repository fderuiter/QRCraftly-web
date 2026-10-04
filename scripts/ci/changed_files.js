/**
 * Lists the files a CI run should scan, replacing the third-party
 * tj-actions/changed-files action (GitHub issue #1183).
 *
 * - pull_request: files changed between the base branch and HEAD.
 * - push: files changed between the pushed `before` commit and HEAD.
 * - Anything else, or any failure to compute a diff: every tracked file.
 *   The fallback scans more, never less, so the secret scanner fails safe.
 *
 * Deleted files are left out (there is nothing to scan). Paths are POSIX and
 * NUL-split, so names with spaces or newlines survive.
 *
 * In GitHub Actions it writes `files` (a JSON array, or empty to mean "scan
 * everything") and `any_changed` (`true`/`false`) to $GITHUB_OUTPUT. Inputs come from the step's `env:` block:
 * EVENT_NAME, BASE_REF and BEFORE_SHA.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execBinary } from '../utils/execHelper.js';

const ZERO_SHA = /^0+$/;
const MAX_ENV_LIST = 100_000;

/**
 * Runs git and returns stdout, or null when git exits non-zero.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string | null}
 */
function git(args, cwd) {
  try {
    return execBinary('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * Splits NUL-separated git output into POSIX paths.
 * @param {string} output
 * @returns {string[]}
 */
function splitNul(output) {
  return output
    .split('\0')
    .filter(Boolean)
    .map(file => file.replace(/\\/g, '/'));
}

/**
 * Every tracked file in the work tree.
 * @param {string} cwd
 * @returns {string[]}
 */
function allTrackedFiles(cwd) {
  const output = git(['ls-files', '-z'], cwd);
  return output === null ? [] : splitNul(output);
}

/**
 * Files added, copied, modified or renamed in `range`, or null if git can't diff it.
 * @param {string} range
 * @param {string} cwd
 * @returns {string[] | null}
 */
function diffFiles(range, cwd) {
  const output = git(['diff', '--name-only', '-z', '--diff-filter=ACMR', range], cwd);
  return output === null ? null : splitNul(output);
}

/**
 * Whether `ref` names a commit that exists locally.
 * @param {string} ref
 * @param {string} cwd
 * @returns {boolean}
 */
function commitExists(ref, cwd) {
  return git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd) !== null;
}

/**
 * Works out which files to scan.
 * @param {{ cwd?: string, eventName?: string, baseRef?: string, beforeSha?: string }} options
 * @returns {{ files: string[], mode: 'pull_request' | 'push' | 'all' }}
 */
export function computeChangedFiles({ cwd = process.cwd(), eventName = '', baseRef = '', beforeSha = '' } = {}) {
  if (eventName === 'pull_request' && baseRef) {
    const base = `origin/${baseRef}`;
    if (!commitExists(base, cwd)) {
      git(['fetch', '--no-tags', 'origin', `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`], cwd);
    }
    if (commitExists(base, cwd)) {
      const files = diffFiles(`${base}...HEAD`, cwd);
      if (files !== null) return { files, mode: 'pull_request' };
    }
  }

  if (eventName === 'push' && beforeSha && !ZERO_SHA.test(beforeSha) && commitExists(beforeSha, cwd)) {
    const files = diffFiles(`${beforeSha}..HEAD`, cwd);
    if (files !== null) return { files, mode: 'push' };
  }

  return { files: allTrackedFiles(cwd), mode: 'all' };
}

/**
 * Formats the step outputs. `files` is left empty when every tracked file should
 * be scanned, or when the list would not fit in one environment variable (Linux
 * caps a single one at 128 KiB); the secret scanner then lists the tracked files
 * itself.
 * @param {string[]} files
 * @param {'pull_request' | 'push' | 'all'} mode
 * @returns {string}
 */
export function formatOutputs(files, mode) {
  const json = JSON.stringify(files);
  const list = mode === 'all' || json.length > MAX_ENV_LIST ? '' : json;
  return `files=${list}\nany_changed=${files.length > 0}\n`;
}

function main() {
  const { files, mode } = computeChangedFiles({
    eventName: process.env.EVENT_NAME,
    baseRef: process.env.BASE_REF,
    beforeSha: process.env.BEFORE_SHA,
  });

  console.log(`Changed files (${mode}): ${files.length}`);
  for (const file of files) console.log(`  ${file}`);

  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    fs.appendFileSync(outputPath, formatOutputs(files, mode), 'utf8');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main();
}
