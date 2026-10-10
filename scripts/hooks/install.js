/**
 * Installs the repository's git hooks (ADR 0044). `pnpm install` runs it
 * through the `prepare` script.
 *
 * It points `core.hooksPath` at `.githooks/`, so git runs the tracked
 * `.githooks/pre-commit`. It skips quietly, with exit code 0:
 * - under CI (`CI` set to anything but `0` or `false`), as the old hook installer did;
 * - when the directory has no `.git` (a tarball, Workers Builds, or an install
 *   inside a package);
 * - when git itself is missing or fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execBinary } from '../utils/execHelper.js';

export const HOOKS_PATH = '.githooks';

/**
 * Tells whether an environment marks a CI run.
 * @param {NodeJS.ProcessEnv} env
 * @returns {boolean}
 */
export function isCi(env) {
  const value = (env.CI ?? '').trim().toLowerCase();
  return value !== '' && value !== '0' && value !== 'false';
}

/**
 * Installs the hooks in a directory.
 *
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv }} options
 * @returns {{ installed: boolean, reason: string }}
 */
export function installHooks({ cwd, env = process.env }) {
  if (isCi(env)) return { installed: false, reason: 'CI is set' };
  if (!fs.existsSync(path.join(cwd, '.git'))) return { installed: false, reason: 'no .git here' };
  try {
    execBinary('git', ['config', 'core.hooksPath', HOOKS_PATH], {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return { installed: false, reason: 'git config failed' };
  }
  return { installed: true, reason: `core.hooksPath is ${HOOKS_PATH}` };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const { installed, reason } = installHooks({ cwd: process.cwd() });
  if (installed) console.log(`git hooks installed: ${reason}.`);
}
