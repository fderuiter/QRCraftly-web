/**
 * Runs the pre-commit checks on the staged files (ADR 0044). It replaced
 * the old staged-file runner; the rules live in `scripts/hooks/staged.config.js`.
 *
 * - Reads the staged files (added, copied, modified, renamed) from git, NUL-split.
 * - Fully staged files go to each command as they are; a fixer that changes
 *   one is followed by `git add -- <file>` so the commit gets the fix.
 * - Partly staged files (staged and unstaged changes in the same file) are
 *   never rewritten: fixers run in their read-only `check` form on them, and
 *   a failure says which file needs `git add -p` or a manual fix.
 * - Commands get their arguments as arrays, never as a shell string, and file
 *   lists are split into chunks that stay under the Windows command-line limit.
 * - The run stops at the first failing command with a summary and exit code 1.
 *
 * Usage: node scripts/hooks/staged.js [--config <file>] [--max-arg-length <n>]
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execBinary } from '../utils/execHelper.js';

/** Stays well under the 8191-character limit of the Windows command line. */
export const DEFAULT_MAX_ARG_LENGTH = 7000;

/** How many file names a failure summary lists before it shortens the list. */
const SUMMARY_FILE_LIMIT = 10;

/**
 * Splits NUL-separated git output into paths.
 * @param {string} output
 * @returns {string[]}
 */
export function splitNul(output) {
  return output.split('\0').filter(Boolean);
}

/**
 * Splits file names into chunks whose command line stays under a limit.
 * A file name longer than the limit on its own still gets a chunk of its own.
 *
 * @param {string[]} files File arguments.
 * @param {number} baseLength Length of the command and its fixed arguments.
 * @param {number} maxLength Maximum length of one command line.
 * @returns {string[][]}
 */
export function chunkFiles(files, baseLength, maxLength) {
  /** @type {string[][]} */
  const chunks = [];
  let current = [];
  let length = baseLength;
  for (const file of files) {
    const extra = file.length + 3; // a space and possible quotes
    if (current.length > 0 && length + extra > maxLength) {
      chunks.push(current);
      current = [];
      length = baseLength;
    }
    current.push(file);
    length += extra;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Runs git with an argument array and returns its stdout.
 * @param {string[]} args
 * @param {string} cwd
 * @returns {string}
 */
function git(args, cwd) {
  return execBinary('git', args, {
    cwd,
    shell: false,
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Turns a command's first entry into an executable and its leading arguments:
 * `node` is this Node binary, anything else is a package's Node `bin` script.
 *
 * @param {string} name
 * @param {string} root Repository root.
 * @returns {string[]}
 */
export function resolveExecutable(name, root) {
  if (name === 'node') return [process.execPath];
  const manifestPath = path.join(root, 'node_modules', name, 'package.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Cannot find the '${name}' package in node_modules. Run 'pnpm install'.`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
  if (typeof bin !== 'string') {
    throw new Error(`The '${name}' package has no '${name}' bin script.`);
  }
  return [process.execPath, path.join(root, 'node_modules', name, bin)];
}

/**
 * Hashes a file's content, or returns null when it cannot be read.
 * @param {string} file Absolute path.
 * @returns {string | null}
 */
function hashFile(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Formats a file list for a summary line.
 * @param {string[]} files
 * @returns {string}
 */
function listFiles(files) {
  const shown = files.slice(0, SUMMARY_FILE_LIMIT).join(', ');
  const more = files.length - SUMMARY_FILE_LIMIT;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

/**
 * Runs one command, once or once per chunk of files.
 *
 * @param {string[]} args The command (first entry resolved by resolveExecutable).
 * @param {string[] | null} files File arguments, or null for a run without files.
 * @param {{ root: string, maxArgLength: number }} options
 * @returns {{ ok: true } | { ok: false, status: number, files: string[] }}
 */
function runCommand(args, files, { root, maxArgLength }) {
  const [executable, ...leading] = [...resolveExecutable(args[0], root), ...args.slice(1)];
  const baseLength = [executable, ...leading].reduce((sum, part) => sum + part.length + 1, 0);
  const chunks = files === null ? [[]] : chunkFiles(files, baseLength, maxArgLength);
  for (const chunk of chunks) {
    try {
      execBinary(executable, [...leading, ...chunk], { cwd: root, shell: false, stdio: 'inherit' });
    } catch (error) {
      const status = typeof error?.status === 'number' ? error.status : 1;
      return { ok: false, status, files: chunk };
    }
  }
  return { ok: true };
}

/**
 * Runs the staged-file rules against a repository.
 *
 * @param {{
 *   root: string,
 *   rules: import('./staged.config.js').StagedRule[],
 *   maxArgLength?: number,
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 * }} options
 * @returns {number} The exit code: 0 when every command passed.
 */
export function runStaged({ root, rules, maxArgLength = DEFAULT_MAX_ARG_LENGTH, log = console.log, error = console.error }) {
  const staged = splitNul(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], root));
  if (staged.length === 0) {
    log('pre-commit: no staged files to check.');
    return 0;
  }
  const unstaged = new Set(splitNul(git(['diff', '--name-only', '-z'], root)));
  const partly = new Set(staged.filter(file => unstaged.has(file)));
  const runOptions = { root, maxArgLength };

  /**
   * Prints the failure summary and returns the exit code.
   * @param {string} ruleName
   * @param {string} label
   * @param {number} status
   * @param {string[]} files
   * @returns {number}
   */
  const fail = (ruleName, label, status, files) => {
    error('');
    error(`pre-commit: ${label} failed (exit code ${status}) in rule '${ruleName}'.`);
    if (files.length > 0) error(`  Files: ${listFiles(files)}`);
    const partFiles = files.filter(file => partly.has(file));
    for (const file of partFiles) {
      error(`  ${file} has unstaged changes, so it was checked, not fixed. Stage the fix with 'git add -p ${file}' or fix it by hand.`);
    }
    error('pre-commit: commit aborted. Fix the problem above, stage the files and commit again.');
    return 1;
  };

  for (const rule of rules) {
    const files = staged.filter(file => rule.match(file));
    if (files.length === 0) continue;
    log(`pre-commit: ${rule.name} (${files.length} file${files.length === 1 ? '' : 's'})`);

    for (const command of rule.commands) {
      log(`  > ${command.label}`);
      if (command.files === false) {
        const result = runCommand(command.run, null, runOptions);
        if (!result.ok) return fail(rule.name, command.label, result.status, []);
        continue;
      }
      if (!command.check) {
        const result = runCommand(command.run, files, runOptions);
        if (!result.ok) return fail(rule.name, command.label, result.status, result.files);
        continue;
      }

      const fullFiles = files.filter(file => !partly.has(file));
      const partFiles = files.filter(file => partly.has(file));
      if (fullFiles.length > 0) {
        const before = new Map(fullFiles.map(file => [file, hashFile(path.join(root, file))]));
        const result = runCommand(command.run, fullFiles, runOptions);
        const changed = fullFiles.filter(file => hashFile(path.join(root, file)) !== before.get(file));
        if (changed.length > 0) {
          for (const chunk of chunkFiles(changed, 20, maxArgLength)) {
            git(['add', '--', ...chunk], root);
          }
          log(`    re-staged after ${command.label}: ${listFiles(changed)}`);
        }
        if (!result.ok) return fail(rule.name, command.label, result.status, result.files);
      }
      if (partFiles.length > 0) {
        log(`    checking without fixing (partly staged): ${listFiles(partFiles)}`);
        const result = runCommand(command.check, partFiles, runOptions);
        if (!result.ok) return fail(rule.name, `${command.label} (check)`, result.status, result.files);
      }
    }
  }
  log('pre-commit: staged-file checks passed.');
  return 0;
}

/**
 * Reads `--name value` from the argument list.
 * @param {string[]} argv
 * @param {string} name
 * @returns {string | undefined}
 */
function option(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

async function main() {
  const argv = process.argv.slice(2);
  const root = git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
  const configOption = option(argv, '--config');
  const configPath = configOption
    ? path.resolve(process.cwd(), configOption)
    : path.join(path.dirname(fileURLToPath(import.meta.url)), 'staged.config.js');
  const { default: rules } = await import(pathToFileURL(configPath).href);
  const maxOption = option(argv, '--max-arg-length');
  const maxArgLength = maxOption ? Number(maxOption) : DEFAULT_MAX_ARG_LENGTH;
  if (!Number.isInteger(maxArgLength) || maxArgLength <= 0) {
    console.error(`pre-commit: --max-arg-length must be a positive integer, got '${maxOption}'.`);
    process.exit(1);
  }
  process.exitCode = runStaged({ root, rules, maxArgLength });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(err => {
    console.error(`pre-commit: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
