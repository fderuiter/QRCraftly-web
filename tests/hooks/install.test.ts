import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execBinary } from '../utils/execHelper';
import { HOOKS_PATH, installHooks, isCi } from '../../scripts/hooks/install.js';

const root = process.cwd();
const INSTALL_SCRIPT = path.join(root, 'scripts', 'hooks', 'install.js');

// Inside a git hook, git exports GIT_DIR and friends; left in place, the git calls
// below would configure the repository being committed to instead of the temp repo.
const inheritedGitEnv = Object.keys(process.env).filter((key) => key.startsWith('GIT_'));
const savedGitEnv = new Map(inheritedGitEnv.map((key) => [key, process.env[key]]));

/** The environment without CI markers, so the install is not skipped. */
function localEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CI;
  return env;
}

function hooksPath(cwd: string): string {
  try {
    return execBinary('git', ['config', '--local', 'core.hooksPath'], { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

describe('scripts/hooks/install.js', () => {
  let tmp: string;

  beforeAll(() => {
    for (const key of inheritedGitEnv) delete process.env[key];
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-install-'));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [key, value] of savedGitEnv) process.env[key] = value;
  });

  function newRepo(name: string): string {
    const repo = path.join(tmp, name);
    fs.mkdirSync(repo);
    execBinary('git', ['init', '--quiet'], { cwd: repo, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    return repo;
  }

  it('sets core.hooksPath to .githooks', () => {
    const repo = newRepo('plain');
    expect(installHooks({ cwd: repo, env: localEnv() })).toEqual({ installed: true, reason: 'core.hooksPath is .githooks' });
    expect(hooksPath(repo)).toBe(HOOKS_PATH);
  });

  it('sets core.hooksPath when run as the prepare script', () => {
    const repo = newRepo('prepare');
    const output = execBinary(process.execPath, [INSTALL_SCRIPT], { cwd: repo, shell: false, env: localEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    expect(output).toContain('git hooks installed');
    expect(hooksPath(repo)).toBe('.githooks');
  });

  it('skips quietly without .git', () => {
    const dir = path.join(tmp, 'tarball');
    fs.mkdirSync(dir);
    expect(installHooks({ cwd: dir, env: localEnv() })).toEqual({ installed: false, reason: 'no .git here' });
    const output = execBinary(process.execPath, [INSTALL_SCRIPT], { cwd: dir, shell: false, env: localEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    expect(output).toBe('');
  });

  it('skips under CI', () => {
    const repo = newRepo('ci');
    expect(installHooks({ cwd: repo, env: { ...localEnv(), CI: 'true' } })).toEqual({ installed: false, reason: 'CI is set' });
    const output = execBinary(process.execPath, [INSTALL_SCRIPT], { cwd: repo, shell: false, env: { ...localEnv(), CI: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(output).toBe('');
    expect(hooksPath(repo)).toBe('');
  });

  it('reads CI the way CI providers set it', () => {
    expect(isCi({ CI: 'true' })).toBe(true);
    expect(isCi({ CI: '1' })).toBe(true);
    expect(isCi({ CI: 'false' })).toBe(false);
    expect(isCi({ CI: '0' })).toBe(false);
    expect(isCi({})).toBe(false);
  });
});

describe('.githooks/pre-commit', () => {
  const hook = fs.readFileSync(path.join(root, '.githooks', 'pre-commit'), 'utf8');

  it('is a POSIX sh script that stops on the first failure', () => {
    const lines = hook.split(/\r?\n/);
    expect(lines[0]).toBe('#!/bin/sh');
    expect(lines).toContain('set -eu');
  });

  it('runs the staged-file checks, then the same whole-repo checks in the same order', () => {
    const commands = hook.split(/\r?\n/).filter((line) => line.trim() !== '' && !line.startsWith('#') && !line.startsWith('set '));
    expect(commands).toEqual([
      'node scripts/hooks/staged.js',
      'pnpm run validate:duplication',
      'pnpm run typecheck',
      'pnpm test --run',
    ]);
  });

  it('is executable in git', () => {
    const mode = execBinary('git', ['ls-files', '--stage', '--', '.githooks/pre-commit'], { cwd: root, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    expect(mode.startsWith('100755')).toBe(true);
  });

  it('is wired to pnpm install through the prepare script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.prepare).toBe('node scripts/hooks/install.js');
  });
});
