import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execBinary, resolveBash } from '../utils/execHelper';

const repoRoot = process.cwd();
const SCRIPT = path.join(repoRoot, 'scripts/ci/release_preview.sh');
const WORKFLOW = fs.readFileSync(path.join(repoRoot, '.github/workflows/release-preview.yml'), 'utf8');
const RULE = '-'.repeat(60);

/** The shape `node scripts/release_engine.js --dry-run` prints. */
function dryRunOutput(groups: string): string {
  return [
    '',
    ' Release Engine',
    '   Latest tag:      v0.12.0',
    '   Current version: 0.12.0',
    '   Bump type:       patch',
    '   Next version:    v0.12.1',
    '   Commits:         2 since v0.12.0',
    '',
    RULE,
    '## [0.12.1] - 2026-10-12',
    groups,
    RULE,
    '',
    'Dry run complete -- no files modified.',
    '',
  ].join('\n');
}

describe('Weekly release preview (scripts/ci/release_preview.sh)', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  function preview(dryRun: string): string {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-preview-'));
    const input = path.join(tmp, 'dry-run.txt');
    const summary = path.join(tmp, 'summary.md');
    fs.writeFileSync(input, dryRun);
    execBinary(resolveBash(), [SCRIPT], {
      env: { ...process.env, RELEASE_PREVIEW_INPUT: input, GITHUB_STEP_SUMMARY: summary },
      stdio: 'pipe',
    });
    return fs.readFileSync(summary, 'utf8');
  }

  it('writes the next version, the changelog and that a release is due when there are fixes', () => {
    const summary = preview(dryRunOutput('\n### Bug Fixes\n- fix(scanner): handle empty frames (`abc1234`)'));
    expect(summary).toContain('## Release preview: v0.12.1');
    expect(summary).toContain('| Latest tag | `v0.12.0` |');
    expect(summary).toContain('| Release due | Yes');
    expect(summary).toContain('#### [0.12.1] - 2026-10-12');
    expect(summary).toContain('##### Bug Fixes\n- fix(scanner): handle empty frames (`abc1234`)');
    expect(summary).toContain('Nothing was tagged or published.');
  });

  it('says no release is due when only maintenance landed', () => {
    const summary = preview(dryRunOutput('\n### Maintenance\n- docs: reword the README (`abc1234`)'));
    expect(summary).toContain('| Release due | No');
  });

  it('fails when the dry-run output cannot be read', () => {
    expect(() => preview('something else entirely\n')).toThrow();
  });
});

describe('release-preview.yml', () => {
  it('runs weekly and on demand', () => {
    expect(WORKFLOW).toMatch(/^\s+schedule:\s*\n\s+- cron: '[^']+'/m);
    expect(WORKFLOW).toMatch(/^\s+workflow_dispatch:/m);
  });

  it('can only read the repository: no write token, PR or tag', () => {
    expect(WORKFLOW).toMatch(/^permissions:\s*\n\s+contents: read\s*$/m);
    expect(WORKFLOW).not.toMatch(/:\s*write\b/);
    expect(WORKFLOW).not.toMatch(/release:prepare|git push|gh pr create|gh release/);
  });

  it('fetches the tags the dry run counts from', () => {
    expect(WORKFLOW).toContain('fetch-depth: 0');
    expect(WORKFLOW).toContain('bash scripts/ci/release_preview.sh');
  });
});
