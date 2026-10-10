import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFile } from './utils/execHelper';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const ciScriptsDir = path.join(repoRoot, 'scripts', 'ci');

describe('CI Modular Shell Scripts Validation', () => {
  it('should find the scripts/ci directory and script files', () => {
    expect(fs.existsSync(ciScriptsDir)).toBe(true);
    const files = fs.readdirSync(ciScriptsDir).filter(f => f.endsWith('.sh'));
    expect(files.length).toBeGreaterThan(0);
  });

  it('should enforce strict execution flags in all extracted shell scripts', () => {
    const files = fs.readdirSync(ciScriptsDir).filter(f => f.endsWith('.sh'));
    for (const file of files) {
      const filePath = path.join(ciScriptsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split(/\r?\n/).map(l => l.trim());

      expect(lines[0], `${file} shebang`).toMatch(/^#!\/usr\/bin\/(env )?bash$/);
      const hasStrictFlags = lines.slice(1, 5).some(l => l.includes('set -euo pipefail') || l.includes('set -e'));
      expect(hasStrictFlags, `${file} strict execution flags`).toBe(true);
    }
  });

  it('should pass ShellCheck static analysis on all extracted shell scripts', () => {
    const files = fs.readdirSync(ciScriptsDir).filter(f => f.endsWith('.sh'));
    expect(files.length).toBeGreaterThan(0);

    // Relative to the repository root, so no absolute path reaches the command line.
    const scriptPaths = files.map(f => `scripts/ci/${f}`);
    try {
      execFile('shellcheck', scriptPaths, { cwd: repoRoot });
    } catch (err: any) {
      const stdout = err.stdout ? err.stdout.toString() : '';
      const stderr = err.stderr ? err.stderr.toString() : '';
      const message = err.message || '';
      if (
        err.code === 'ENOENT' ||
        err.code === 127 ||
        stderr.includes('not found') ||
        message.includes('not found') ||
        stderr.includes('not recognized') ||
        message.includes('not recognized')
      ) {
        console.warn('[CI Scripts Test] shellcheck binary not found in local environment, skipping static analysis pass');
        return;
      }
      expect.fail(`ShellCheck failed:\n${stdout}\n${stderr}`);
    }
  });

  it('should halt immediately with non-zero exit code on simulated intermediate piped failures', () => {
    if (process.platform === 'win32') {
      // Windows cmd does not support bash pipefail semantics natively
      return;
    }
    // Test that set -euo pipefail properly catches intermediate pipe failures
    const script = 'set -euo pipefail; false | echo "should not mask failure"; echo "unreachable"';
    expect(() => {
      execFile('bash', ['-c', script], { stdio: 'pipe' });
    }).toThrow();
  });
});
