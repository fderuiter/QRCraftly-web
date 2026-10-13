/**
 * Turns the nightly full-tier CI result on main (ADR 0049) into one GitHub issue,
 * the same way scripts/ci/audit_issue.js handles the dependency audit.
 *
 * - Nightly failed, no alert open: opens "Nightly CI failing", assigned to the owner.
 * - Nightly failed, alert already open: comments on it with the run link.
 * - Nightly passed, alert open: comments "Nightly CI passing again" and closes it.
 * - Anything else: does nothing.
 *
 * Inputs come from the step's `env:` block: CI_OUTCOME (`success` or `failure`),
 * RUN_URL, and GH_TOKEN for the gh CLI.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { findOpenAlert, runGh } from './audit_issue.js';

export const NIGHTLY_MARKER = '<!-- nightly-ci -->';
export const NIGHTLY_TITLE = 'Nightly CI failing';
const LABELS = ['bug', 'area:ci', 'priority:P1'];
const ASSIGNEE = 'fderuiter';

/**
 * Opens, updates or closes the nightly alert issue for one outcome.
 * @param {{ outcome: string, runUrl: string, gh?: (args: string[]) => string, log?: (message: string) => void }} options
 * @returns {'opened' | 'commented' | 'closed' | 'none'}
 */
export function syncNightlyIssue({ outcome, runUrl, gh = runGh, log = console.log }) {
  if (outcome !== 'success' && outcome !== 'failure') {
    log(`Nightly outcome "${outcome}": nothing to do.`);
    return 'none';
  }

  const existing = findOpenAlert(gh, NIGHTLY_MARKER);
  const runLine = runUrl ? `Run: ${runUrl}` : 'Run link unavailable.';

  if (outcome === 'success') {
    if (existing === null) return 'none';
    gh(['issue', 'close', String(existing), '--reason', 'completed', '--comment', `Nightly CI passing again.\n\n${runLine}`]);
    log(`Nightly passed: closed #${existing}.`);
    return 'closed';
  }

  if (existing !== null) {
    gh(['issue', 'comment', String(existing), '--body', `The nightly full-tier CI run on main is still failing.\n\n${runLine}`]);
    log(`Nightly failed: commented on #${existing}.`);
    return 'commented';
  }

  const body = [
    NIGHTLY_MARKER,
    'The nightly full-tier CI run on `main` failed (E2E on all four Playwright projects and Lighthouse on every page, ADR 0049).',
    'Pull requests only run Chromium E2E and sampled Lighthouse, so this is where a Firefox, WebKit or per-page regression first shows up.',
    '',
    runLine,
    '',
    'Fix it before the next merge. The next passing nightly run closes this issue.',
  ].join('\n');
  const args = ['issue', 'create', '--title', NIGHTLY_TITLE, '--body', body, '--assignee', ASSIGNEE];
  for (const label of LABELS) args.push('--label', label);
  gh(args);
  log('Nightly failed: opened a new alert issue.');
  return 'opened';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  syncNightlyIssue({ outcome: process.env.CI_OUTCOME ?? '', runUrl: process.env.RUN_URL ?? '' });
}
