import { execFileSync, execSync, type ExecFileSyncOptions } from 'child_process';
import fs from 'fs';

const WINDOWS_CMD_EXECUTABLES = new Set(['npx', 'npm', 'pnpm', 'yarn', 'tsc', 'wrangler']);

/**
 * Resolves the executable name for the current platform.
 * On Windows, npm/pnpm/npx binaries require .cmd extension.
 */
export function resolveCommand(command: string): string {
  if (process.platform === 'win32') {
    if (WINDOWS_CMD_EXECUTABLES.has(command)) {
      return `${command}.cmd`;
    }
  }
  return command;
}

/**
 * Executes a binary file synchronously with platform resolution and UTF-8 output normalization.
 */
export function execBinary(
  file: string,
  args: string[] = [],
  options: ExecFileSyncOptions = {}
): string {
  const resolved = resolveCommand(file);
  const isWin = process.platform === 'win32';
  const opts: ExecFileSyncOptions = {
    encoding: 'utf8',
    shell: isWin,
    ...options,
  };

  const output = execFileSync(resolved, args, opts);
  return typeof output === 'string' ? output.replace(/\r\n/g, '\n') : (output as unknown as string);
}

/**
 * Runs a real executable (node, git, bash, shellcheck) without a shell on every platform,
 * so no argument is ever parsed by a shell. Use execBinary for package-manager shims
 * (`pnpm`, `npx`) that need `.cmd` resolution on Windows.
 */
export function execFile(file: string, args: string[] = [], options: ExecFileSyncOptions = {}): string {
  const output = execFileSync(file, args, { encoding: 'utf8', ...options, shell: false });
  return typeof output === 'string' ? output.replace(/\r\n/g, '\n') : (output as unknown as string);
}

let cachedBash: string | null = null;

/**
 * Resolves the bash executable for the current platform with caching and defensive path quoting.
 */
export function resolveBash(): string {
  if (cachedBash) {
    return cachedBash;
  }

  // Check PATH first
  try {
    execSync('bash --version', { stdio: 'ignore' });
    cachedBash = 'bash';
    return 'bash';
  } catch (_e) {}

  if (process.platform === 'win32') {
    const sysDrive = process.env.SystemDrive || '';
    const progFiles = process.env.ProgramFiles || (sysDrive ? `${sysDrive}\\Program Files` : '');
    const progFilesX86 = process.env['ProgramFiles(x86)'] || (sysDrive ? `${sysDrive}\\Program Files (x86)` : '');
    const localAppData = process.env.LOCALAPPDATA || '';

    const candidatePaths = [
      progFiles ? `${progFiles}\\Git\\bin\\bash.exe` : '',
      progFiles ? `${progFiles}\\Git\\usr\\bin\\bash.exe` : '',
      progFilesX86 ? `${progFilesX86}\\Git\\bin\\bash.exe` : '',
      localAppData ? `${localAppData}\\Programs\\Git\\bin\\bash.exe` : '',
    ].filter(Boolean);

    for (const candidate of candidatePaths) {
      try {
        if (fs.existsSync(candidate)) {
          cachedBash = candidate.includes(' ') ? `"${candidate}"` : candidate;
          return cachedBash;
        }
      } catch (_e) {}
    }
  }

  cachedBash = 'bash';
  return 'bash';
}

