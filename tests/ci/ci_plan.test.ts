import { describe, expect, it } from 'vitest';
import { approvalIsTrusted, awaitsApproval, formatPlan, isDocsOnlyFile, isGatedPullRequest, planRun, QUICK } from '../../scripts/ci/ci_plan.js';
import { SAMPLE_ROUTES, sampleUrls } from '../../scripts/ci/lighthouse_sample.js';

const SHA = 'a'.repeat(40);
const API = 'https://api.github.com/repos/o/r/';

/**
 * A fetch stand-in that answers GitHub API paths from a table and records every call.
 * Paths missing from the table answer 404.
 */
function fakeFetch(routes: Record<string, unknown>, calls: string[] = []): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    if (!(path in routes)) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[path]), { status: 200 });
  };
}

const labeled = (login: string, type = 'User', name = 'ci-approved') => ({ event: 'labeled', label: { name }, actor: { login, type } });
const EVENTS = 'issues/7/events?per_page=100&page=1';

describe('scripts/ci/ci_plan.js', () => {
  it('runs Chromium E2E and sampled Lighthouse on a ready pull request', () => {
    expect(planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: ['src/App.tsx'] })).toEqual({
      runChecks: true,
      codeChanged: true,
      unitTests: true,
      e2e: 'pr',
      lighthouse: 'sample',
    });
  });

  it('skips unit tests, E2E and Lighthouse on a draft pull request', () => {
    const plan = planRun({ eventName: 'pull_request', isDraft: 'true', changedFiles: ['src/App.tsx'] });
    expect(plan).toEqual({ runChecks: true, codeChanged: true, unitTests: false, e2e: 'none', lighthouse: 'none' });
  });

  it('treats Markdown the build does not read as docs only', () => {
    expect(isDocsOnlyFile('README.md')).toBe(true);
    expect(isDocsOnlyFile('docs/adr/0050-ci-tiers-for-a-private-repository.md')).toBe(true);
    expect(isDocsOnlyFile('docs/public/SCALING.md')).toBe(false);
    expect(isDocsOnlyFile('docs/SECURITY.md')).toBe(false);
    expect(isDocsOnlyFile('src/App.tsx')).toBe(false);

    const plan = planRun({ eventName: 'pull_request', isDraft: 'false', changedFiles: ['README.md', 'docs/RUST.md'] });
    expect(plan).toEqual({ runChecks: true, codeChanged: false, unitTests: true, e2e: 'none', lighthouse: 'none' });
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
      e2e: 'none',
      lighthouse: 'none',
    });
  });

  it('holds Stitch PRs until a maintainer adds the ci-approved label', () => {
    const stitch = { eventName: 'pull_request', author: 'google-labs-stitch[bot]', headRef: 'stitch/fix-toast' };
    expect(awaitsApproval({ ...stitch, labels: '["bug"]' })).toBe(true);
    expect(awaitsApproval({ ...stitch, labels: '' })).toBe(true);
    expect(awaitsApproval({ ...stitch, labels: '["ci-approved"]' })).toBe(false);
    expect(awaitsApproval({ eventName: 'pull_request', author: 'someone', headRef: 'stitch/x', labels: '[]' })).toBe(true);
  });

  it('runs the quick tier, the same as a draft, while a bot PR waits', () => {
    expect(QUICK).toEqual({ runChecks: true, codeChanged: true, unitTests: false, e2e: 'none', lighthouse: 'none' });
    expect(planRun({ eventName: 'pull_request', isDraft: 'true', changedFiles: ['src/App.tsx'] })).toEqual(QUICK);
    expect(isGatedPullRequest({ eventName: 'pull_request', author: 'google-labs-stitch[bot]', headRef: 'feature' })).toBe(true);
    expect(isGatedPullRequest({ eventName: 'pull_request', author: 'fderuiter', headRef: 'claude/x' })).toBe(false);
    expect(isGatedPullRequest({ eventName: 'merge_group', author: 'google-labs-stitch[bot]', headRef: 'stitch/x' })).toBe(false);
  });

  it('counts ci-approved only when an admin or maintainer added it', async () => {
    const base = { token: 't', repo: 'o/r', prNumber: '7' };
    const admin = fakeFetch({
      [EVENTS]: [labeled('fderuiter')],
      'collaborators/fderuiter/permission': { permission: 'admin', role_name: 'admin' },
    });
    expect(await approvalIsTrusted({ ...base, fetchImpl: admin })).toEqual({ trusted: true, reason: 'added by fderuiter (admin)' });

    const maintainer = fakeFetch({ [EVENTS]: [labeled('m')], 'collaborators/m/permission': { permission: 'write', role_name: 'maintain' } });
    expect((await approvalIsTrusted({ ...base, fetchImpl: maintainer })).trusted).toBe(true);

    const writer = fakeFetch({ [EVENTS]: [labeled('w')], 'collaborators/w/permission': { permission: 'write', role_name: 'write' } });
    expect(await approvalIsTrusted({ ...base, fetchImpl: writer })).toEqual({ trusted: false, reason: 'added by w, whose role is write' });
  });

  it('judges the newest ci-approved event and ignores other labels', async () => {
    const calls: string[] = [];
    const fetchImpl = fakeFetch(
      {
        [EVENTS]: [labeled('fderuiter'), labeled('google-labs-stitch[bot]', 'Bot', 'stitch:ready'), labeled('google-labs-stitch[bot]', 'Bot')],
        'collaborators/fderuiter/permission': { permission: 'admin', role_name: 'admin' },
      },
      calls,
    );
    expect(await approvalIsTrusted({ token: 't', repo: 'o/r', prNumber: '7', fetchImpl })).toEqual({
      trusted: false,
      reason: 'google-labs-stitch[bot] is a bot',
    });
    expect(calls).toHaveLength(1);
  });

  it('fails closed on missing input, a missing event or an API error', async () => {
    const never = fakeFetch({});
    expect((await approvalIsTrusted({ token: '', repo: 'o/r', prNumber: '7', fetchImpl: never })).trusted).toBe(false);
    expect((await approvalIsTrusted({ token: 't', repo: 'o/r', prNumber: '', fetchImpl: never })).trusted).toBe(false);
    expect((await approvalIsTrusted({ token: 't', repo: 'o/r', prNumber: '7 ', fetchImpl: never })).trusted).toBe(false);
    expect(await approvalIsTrusted({ token: 't', repo: 'o/r', prNumber: '7', fetchImpl: never })).toEqual({
      trusted: false,
      reason: 'GET issues/7/events?per_page=100&page=1 returned 404',
    });
    const noLabel = fakeFetch({ [EVENTS]: [labeled('fderuiter', 'User', 'bug')] });
    expect(await approvalIsTrusted({ token: 't', repo: 'o/r', prNumber: '7', fetchImpl: noLabel })).toEqual({
      trusted: false,
      reason: 'no ci-approved label event found',
    });
    const unknownUser = fakeFetch({ [EVENTS]: [labeled('ghost')] });
    expect((await approvalIsTrusted({ token: 't', repo: 'o/r', prNumber: '7', fetchImpl: unknownUser })).trusted).toBe(false);
  });

  it('reads further pages of events when the first one is full', async () => {
    const filler = Array.from({ length: 100 }, () => ({ event: 'commented', actor: { login: 'x', type: 'User' } }));
    const fetchImpl = fakeFetch({
      [EVENTS]: filler,
      'issues/7/events?per_page=100&page=2': [labeled('fderuiter')],
      'collaborators/fderuiter/permission': { permission: 'admin', role_name: 'admin' },
    });
    expect((await approvalIsTrusted({ token: 't', repo: 'o/r', prNumber: '7', fetchImpl })).trusted).toBe(true);
  });

  it('fails closed when the events run past the pages it reads', async () => {
    const full = [...Array.from({ length: 99 }, () => ({ event: 'commented', actor: { login: 'x', type: 'User' } })), labeled('fderuiter')];
    const routes: Record<string, unknown> = { 'collaborators/fderuiter/permission': { permission: 'admin', role_name: 'admin' } };
    for (let page = 1; page <= 10; page += 1) routes[`issues/7/events?per_page=100&page=${page}`] = full;
    expect(await approvalIsTrusted({ token: 't', repo: 'o/r', prNumber: '7', fetchImpl: fakeFetch(routes) })).toEqual({
      trusted: false,
      reason: 'more than 1000 issue events',
    });
  });

  it('never holds people, Claude branches or non-PR runs', () => {
    expect(awaitsApproval({ eventName: 'pull_request', author: 'fderuiter', headRef: 'claude/project-thread-x', labels: '[]' })).toBe(false);
    expect(awaitsApproval({ eventName: 'merge_group', author: '', headRef: 'stitch/x' })).toBe(false);
    expect(awaitsApproval({ eventName: 'schedule' })).toBe(false);
  });

  it('runs the ready-PR tier on a merge-queue group', () => {
    expect(planRun({ eventName: 'merge_group', isDraft: '', changedFiles: null })).toEqual({
      runChecks: true,
      codeChanged: true,
      unitTests: true,
      e2e: 'pr',
      lighthouse: 'sample',
    });
  });

  it('runs the PR tier on a manual run unless full is asked for', () => {
    expect(planRun({ eventName: 'workflow_dispatch', fullInput: 'false' }).e2e).toBe('pr');
    expect(planRun({ eventName: 'workflow_dispatch', fullInput: 'true' }).e2e).toBe('full');
  });

  it('writes one output per line', () => {
    expect(formatPlan({ runChecks: true, codeChanged: false, unitTests: true, e2e: 'none', lighthouse: 'none' })).toBe(
      'run_checks=true\ncode_changed=false\nunit_tests=true\ne2e=none\nlighthouse=none\n',
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
