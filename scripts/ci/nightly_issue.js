/**
 * Turns the nightly full-tier CI result on main (ADR 0050) into one GitHub issue,
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
import { runGh, syncAlertIssue } from './alert_issue.js';

export const NIGHTLY_MARKER = '<!-- nightly-ci -->';
export const NIGHTLY_TITLE = 'Nightly CI failing';
const LABELS = ['bug', 'area:ci', 'priority:P1'];

/**
 * Opens, updates or closes the nightly alert issue for one outcome.
 * @param {{ outcome: string, runUrl: string, gh?: (args: string[]) => string, log?: (message: string) => void }} options
 * @returns {'opened' | 'commented' | 'closed' | 'none'}
 */
export function syncNightlyIssue({ outcome, runUrl, gh = runGh, log = console.log }) {
  return syncAlertIssue({
    outcome,
    runUrl,
    gh,
    log,
    copy: {
      name: 'Nightly',
      marker: NIGHTLY_MARKER,
      title: NIGHTLY_TITLE,
      labels: LABELS,
      closeBody: runLine => `Nightly CI passing again.\n\n${runLine}`,
      commentBody: runLine => `The nightly full-tier CI run on main is still failing.\n\n${runLine}`,
      openBody: runLine =>
        [
          'The nightly full-tier CI run on `main` failed (E2E on all four Playwright projects and Lighthouse on every page, ADR 0050).',
          'Pull requests only run Chromium E2E and sampled Lighthouse, so this is where a Firefox, WebKit or per-page regression first shows up.',
          '',
          runLine,
          '',
          'Fix it before the next merge. The next passing nightly run closes this issue.',
        ].join('\n'),
    },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  syncNightlyIssue({ outcome: process.env.CI_OUTCOME ?? '', runUrl: process.env.RUN_URL ?? '' });
}
