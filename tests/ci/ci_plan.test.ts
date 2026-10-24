import { describe, expect, it } from 'vitest';
import { formatPlan, isDocsOnlyFile, isSlowTestTrigger, planRun } from '../../scripts/ci/ci_plan.js';
import { SAMPLE_ROUTES, sampleUrls } from '../../scripts/ci/lighthouse_sample.js';

const SHA = 'a'.repeat(40);

describe('scripts/ci/ci_plan.js', () => {
  it('runs Chromium E2E and sampled Lighthouse on a ready pull request', () => {
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: ['src/App.tsx'] })).toEqual({
      runChecks: true,
      codeChanged: true,
      unitTests: true,
      slowTests: false,
      e2e: 'pr',
      lighthouse: 'sample',
    });
  });

  it('skips unit tests, E2E and Lighthouse on a draft pull request', () => {
    const plan = planRun({ eventName: 'pull_request', isDraft: 'true', changedFiles: ['src/App.tsx'] });
    expect(plan).toEqual({ runChecks: true, codeChanged: true, unitTests: false, slowTests: false, e2e: 'none', lighthouse: 'none' });
  });

  it('treats Markdown the build does not read as docs only', () => {
    expect(isDocsOnlyFile('README.md')).toBe(true);
    expect(isDocsOnlyFile('docs/adr/0050-ci-tiers-for-a-private-repository.md')).toBe(true);
    expect(isDocsOnlyFile('docs/public/SCALING.md')).toBe(false);
    expect(isDocsOnlyFile('docs/SECURITY.md')).toBe(false);
    expect(isDocsOnlyFile('src/App.tsx')).toBe(false);

    const plan = planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: ['README.md', 'docs/RUST.md'] });
    expect(plan).toEqual({ runChecks: true, codeChanged: false, unitTests: true, slowTests: false, e2e: 'none', lighthouse: 'none' });
  });

  it('runs everything when the diff is unknown or empty', () => {
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: null }).e2e).toBe('pr');
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: [] }).codeChanged).toBe(true);
  });

  it('runs the full tier for release branches and the full-e2e label', () => {
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', headRef: 'release/v1.2.0', changedFiles: ['package.json'] }).e2e).toBe('full');
    const labelled = planRun({ eventName: 'pull_request', isDraft: 'true', labels: '["bug","full-e2e"]', changedFiles: ['src/App.tsx'] });
    expect(labelled).toMatchObject({ e2e: 'full', lighthouse: 'full' });
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', labels: 'not json', changedFiles: ['src/App.tsx'] }).e2e).toBe('pr');
  });

  it('runs the nightly full tier only when main has moved', () => {
    expect(planRun({ eventName: 'schedule', headSha: SHA, lastNightlySha: 'b'.repeat(40) })).toMatchObject({ runChecks: true, e2e: 'full', lighthouse: 'full' });
    expect(planRun({ eventName: 'schedule', headSha: SHA, lastNightlySha: '' })).toMatchObject({ runChecks: true, e2e: 'full' });
    expect(planRun({ eventName: 'schedule', headSha: SHA, lastNightlySha: SHA })).toEqual({
      runChecks: false,
      codeChanged: false,
      unitTests: false,
      slowTests: false,
      e2e: 'none',
      lighthouse: 'none',
    });
  });

  it('runs the ready-PR tier on a merge-queue group', () => {
    expect(planRun({ eventName: 'merge_group', isDraft: '', changedFiles: null })).toEqual({
      runChecks: true,
      codeChanged: true,
      unitTests: true,
      slowTests: false,
      e2e: 'pr',
      lighthouse: 'sample',
    });
  });

  it('runs the slow tests on the full tier and on ready pull requests that touch what they cover (#1608)', () => {
    expect(planRun({ eventName: 'schedule', headSha: SHA, lastNightlySha: '' }).slowTests).toBe(true);
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', headRef: 'release/v1.2.0', changedFiles: ['package.json'] }).slowTests).toBe(true);
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: ['src/packages/optical-modem/lib/tear.ts'] }).slowTests).toBe(true);
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: ['src/App.tsx', 'crates/modem/src/lib.rs'] }).slowTests).toBe(true);
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: null }).slowTests).toBe(true);
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: ['src/App.tsx'] }).slowTests).toBe(false);
    expect(planRun({ eventName: 'pull_request', isDraft: 'true', changedFiles: ['src/packages/optical-modem/lib/tear.ts'] }).slowTests).toBe(false);

    expect(isSlowTestTrigger('tests/colourTransfer.slow.test.ts')).toBe(true);
    expect(isSlowTestTrigger('src/wasm/modem.wasm')).toBe(true);
    expect(isSlowTestTrigger('src/wasm/modem.wasm.sha256')).toBe(false);
    expect(isSlowTestTrigger('src/packages/optical-modemx/a.ts')).toBe(false);
  });

  it('runs the PR tier on a manual run unless full is asked for', () => {
    expect(planRun({ eventName: 'workflow_dispatch', fullInput: 'false' }).e2e).toBe('pr');
    expect(planRun({ eventName: 'workflow_dispatch', fullInput: 'true' }).e2e).toBe('full');
  });

  it('writes one output per line', () => {
    expect(formatPlan({ runChecks: true, codeChanged: false, unitTests: true, slowTests: false, e2e: 'none', lighthouse: 'none' })).toBe(
      'run_checks=true\ncode_changed=false\nunit_tests=true\nslow_tests=false\ne2e=none\nlighthouse=none\n',
    );
  });
});

describe('scripts/ci/lighthouse_sample.js', () => {
  const urls = ['/', '/about', ...SAMPLE_ROUTES.slice(1), '/text-qr-code'].map(route => `http://localhost${route}`);

  it('keeps one page of each template, in the sample order', () => {
    const { kept, missing } = sampleUrls(urls);
    expect(missing).toEqual([]);
    expect(kept).toEqual(SAMPLE_ROUTES.map(route => `http://localhost${route}`));
  });

  it('reports sampled routes that are no longer pre-rendered', () => {
    expect(sampleUrls(['http://localhost/', 'http://localhost/guides/']).missing).toEqual(
      SAMPLE_ROUTES.filter(route => route !== '/' && route !== '/guides'),
    );
  });
});
