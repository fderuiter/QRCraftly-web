import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execBinary } from '../utils/execHelper';
import { computeChangedFiles, formatOutputs } from '../../scripts/ci/changed_files.js';

function git(cwd: string, ...args: string[]): string {
  return execBinary('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function write(cwd: string, file: string, content: string): void {
  const full = path.join(cwd, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

describe('scripts/ci/changed_files.js', () => {
  let tmp: string;
  let origin: string;
  let repo: string;
  let baseSha: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'changed-files-'));
    origin = path.join(tmp, 'origin');
    repo = path.join(tmp, 'repo');

    fs.mkdirSync(origin);
    git(origin, 'init', '--quiet', '--initial-branch=main');
    git(origin, 'config', 'user.email', 'test@example.com');
    git(origin, 'config', 'user.name', 'Test');
    git(origin, 'config', 'commit.gpgsign', 'false');
    write(origin, 'keep.txt', 'keep\n');
    write(origin, 'edit.txt', 'one\n');
    write(origin, 'old-name.txt', 'rename me, the content stays the same\n');
    write(origin, 'gone.txt', 'delete me\n');
    git(origin, 'add', '-A');
    git(origin, 'commit', '--quiet', '-m', 'base');

    git(tmp, 'clone', '--quiet', origin, repo);
    git(repo, 'config', 'user.email', 'test@example.com');
    git(repo, 'config', 'user.name', 'Test');
    git(repo, 'config', 'commit.gpgsign', 'false');
    baseSha = git(repo, 'rev-parse', 'HEAD');

    git(repo, 'checkout', '--quiet', '-b', 'feature');
    write(repo, 'edit.txt', 'two\n');
    write(repo, 'dir/with space.txt', 'added\n');
    git(repo, 'mv', 'old-name.txt', 'new-name.txt');
    git(repo, 'rm', '--quiet', 'gone.txt');
    git(repo, 'add', '-A');
    git(repo, 'commit', '--quiet', '-m', 'change');
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const expectedChanges = ['dir/with space.txt', 'edit.txt', 'new-name.txt'];

  it('lists added, modified and renamed files for a pull request, not deleted ones', () => {
    const result = computeChangedFiles({ cwd: repo, eventName: 'pull_request', baseRef: 'main' });
    expect(result.mode).toBe('pull_request');
    expect([...result.files].sort()).toEqual(expectedChanges);
  });

  it('fetches the base branch when the checkout does not have it', () => {
    git(repo, 'update-ref', '-d', 'refs/remotes/origin/main');
    const result = computeChangedFiles({ cwd: repo, eventName: 'pull_request', baseRef: 'main' });
    expect(result.mode).toBe('pull_request');
    expect([...result.files].sort()).toEqual(expectedChanges);
  });

  it('diffs a push against the before commit', () => {
    const result = computeChangedFiles({ cwd: repo, eventName: 'push', beforeSha: baseSha });
    expect(result.mode).toBe('push');
    expect([...result.files].sort()).toEqual(expectedChanges);
  });

  it('falls back to every tracked file for a new branch push (all-zero before)', () => {
    const result = computeChangedFiles({ cwd: repo, eventName: 'push', beforeSha: '0'.repeat(40) });
    expect(result.mode).toBe('all');
    expect([...result.files].sort()).toEqual(['dir/with space.txt', 'edit.txt', 'keep.txt', 'new-name.txt']);
  });

  it('falls back to every tracked file when the before commit is unknown', () => {
    const result = computeChangedFiles({ cwd: repo, eventName: 'push', beforeSha: 'f'.repeat(40) });
    expect(result.mode).toBe('all');
    expect(result.files).toContain('keep.txt');
  });

  it('falls back to every tracked file when the base branch does not exist', () => {
    const result = computeChangedFiles({ cwd: repo, eventName: 'pull_request', baseRef: 'no-such-branch' });
    expect(result.mode).toBe('all');
    expect(result.files).toContain('keep.txt');
  });

  it('falls back to every tracked file for other events', () => {
    const result = computeChangedFiles({ cwd: repo, eventName: 'workflow_dispatch' });
    expect(result.mode).toBe('all');
    expect(result.files).toHaveLength(4);
  });
});

describe('formatOutputs', () => {
  it('writes the JSON list and any_changed for a diff', () => {
    expect(formatOutputs(['a.txt', 'b c.txt'], 'push')).toBe('files=["a.txt","b c.txt"]\nany_changed=true\n');
  });

  it('reports no changes for an empty diff', () => {
    expect(formatOutputs([], 'pull_request')).toBe('files=[]\nany_changed=false\n');
  });

  it('leaves files empty when scanning everything, so the scanner lists tracked files itself', () => {
    expect(formatOutputs(['a.txt'], 'all')).toBe('files=\nany_changed=true\n');
  });

  it('leaves files empty when the list is too big for one environment variable', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `some/long/directory/path/file-${i}.ts`);
    expect(formatOutputs(many, 'push')).toBe('files=\nany_changed=true\n');
  });
});
