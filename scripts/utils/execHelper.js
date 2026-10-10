import { execFileSync, execSync, spawnSync } from 'child_process';
import fs from 'fs';

const WINDOWS_CMD_EXECUTABLES = new Set(['npx', 'npm', 'pnpm', 'yarn', 'tsc', 'wrangler', 'depcruise']);
let cachedBash = null;

/**
 * Resolves the executable name for the current platform.
 * On Windows, npm/pnpm/npx binaries require .cmd extension.
 *
 * @param {string} command - Command name (e.g. 'npx', 'pnpm')
 * @returns {string} Platform-resolved command name
 */
export function resolveCommand(command) {
  if (process.platform === 'win32') {
    if (WINDOWS_CMD_EXECUTABLES.has(command)) {
      return `${command}.cmd`;
    }
  }
  return command;
}

/**
 * Executes a binary file synchronously with platform resolution and UTF-8 output normalization.
 *
 * @param {string} file - Binary/command name or path
 * @param {string[]} [args=[]] - Arguments array
 * @param {import('child_process').ExecFileSyncOptions} [options={}] - Node child_process options
 * @returns {string} Normalized standard output with LF line endings
 */
export function execBinary(file, args = [], options = {}) {
  const resolved = resolveCommand(file);
  const isWin = process.platform === 'win32';
  const opts = {
    encoding: 'utf8',
    shell: isWin,
    ...options,
  };

  const output = execFileSync(resolved, args, opts);
  return typeof output === 'string' ? output.replace(/\r\n/g, '\n') : output;
}

/**
 * Runs a binary synchronously and returns its exit status instead of throwing, for
 * interactive tools that inherit the terminal (`stdio: 'inherit'`).
 *
 * @param {string} file - Binary/command name or path
 * @param {string[]} [args=[]] - Arguments array
 * @param {import('child_process').SpawnSyncOptions} [options={}] - Node child_process options
 * @returns {import('child_process').SpawnSyncReturns<string | Buffer>} The spawn result
 */
export function spawnBinary(file, args = [], options = {}) {
  return spawnSync(resolveCommand(file), args, options);
}

/**
 * Executes a shell command synchronously with UTF-8 decoding and LF output normalization.
 *
 * @param {string} command - Command string to execute
 * @param {import('child_process').ExecSyncOptions} [options={}] - Node child_process options
 * @returns {string} Normalized standard output with LF line endings
 */
export function execShell(command, options = {}) {
  const opts = {
    encoding: 'utf8',
    ...options,
  };

  const output = execSync(command, opts);
  return typeof output === 'string' ? output.replace(/\r\n/g, '\n') : output;
}

/**
 * Resolves the bash executable for the current platform with caching.
 *
 * @returns {string} Bash executable command or path
 */
export function resolveBash() {
  if (cachedBash) {
    return cachedBash;
  }

  // Check PATH first
  try {
    execSync('bash --version', { stdio: 'ignore' });
    cachedBash = 'bash';
    return 'bash';
  } catch {
    // bash is not on PATH; fall through to platform-specific locations below.
  }

  if (process.platform === 'win32') {
    const sysDrive = process.env.SystemDrive || '';
    const progFiles = process.env.ProgramFiles || (sysDrive ? `${sysDrive}\\Program Files` : '');
    const progFilesX86 = process.env['ProgramFiles(x86)'] || (sysDrive ? `${sysDrive}\\Program Files (x86)` : '');
    const localAppData = process.env.LOCALAPPDATA || '';

    const fsCandidates = [
      progFiles ? `${progFiles}\\Git\\bin\\bash.exe` : '',
      progFiles ? `${progFiles}\\Git\\usr\\bin\\bash.exe` : '',
      progFilesX86 ? `${progFilesX86}\\Git\\bin\\bash.exe` : '',
      localAppData ? `${localAppData}\\Programs\\Git\\bin\\bash.exe` : '',
    ].filter(Boolean);

    for (const candidate of fsCandidates) {
      if (fs.existsSync(candidate)) {
        cachedBash = candidate.includes(' ') ? `"${candidate}"` : candidate;
        return cachedBash;
      }
    }
  }

  cachedBash = 'bash';
  return 'bash';
}
