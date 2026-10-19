/**
 * Decides how much of main.yml a run does (ADR 0050). GitHub Actions minutes are
 * metered once the repository is private, so the expensive jobs (E2E on four
 * browsers, Lighthouse on every page) run in full only where they pay off.
 *
 * - pull_request, ready for review: Chromium E2E (with the CSP project) and
 *   Lighthouse on a sample of pages.
 * - pull_request, draft: static checks, the audit and the builds only, no unit
 *   tests, E2E or Lighthouse. Drafts cannot merge, the pre-commit hook already
 *   ran the unit tests, and marking the PR ready runs the next tier on the same
 *   commit.
 * - pull_request that only changes Markdown the build does not read: static
 *   validation and unit tests only (docs/public/ and docs/SECURITY.md are
 *   compiled into the /security page, so they count as code).
 * - pull_request from a release/ branch, or labelled `full-e2e`: the full tier.
 * - merge_group (the merge queue, ADR 0051): the ready-PR tier. Every PR in the
 *   group already passed its own PR run, so the group run checks only that the
 *   PRs still pass together on the newest main.
 * - schedule (nightly on main): the full tier, or nothing at all when main has
 *   not moved since the last successful nightly run.
 * - workflow_dispatch: the PR tier, or the full tier when `full` is true.
 *
 * Inputs come from the step's `env:` block: EVENT_NAME, IS_DRAFT, HEAD_REF,
 * LABELS (JSON array of label names), FULL_INPUT, BASE_REF, HEAD_SHA and
 * LAST_NIGHTLY_SHA. Outputs go to $GITHUB_OUTPUT: run_checks, code_changed,
 * unit_tests, e2e (none, pr or full) and lighthouse (none, sample or full).
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeChangedFiles } from './changed_files.js';

export const FULL_E2E_LABEL = 'full-e2e';

/**
 * Whether a change to this file can leave the built app and its tests untouched.
 * @param {string} file POSIX path relative to the repository root.
 * @returns {boolean}
 */
export function isDocsOnlyFile(file) {
  return file.endsWith('.md') && !file.startsWith('docs/public/') && file !== 'docs/SECURITY.md';
}

/**
 * Parses the LABELS input, tolerating an empty or malformed value.
 * @param {string | undefined} raw
 * @returns {string[]}
 */
function parseLabels(raw) {
  try {
    const labels = JSON.parse(raw || '[]');
    return Array.isArray(labels) ? labels.filter(label => typeof label === 'string') : [];
  } catch {
    return [];
  }
}

/** @type {CiPlan} */
const NOTHING = { runChecks: false, codeChanged: false, unitTests: false, e2e: 'none', lighthouse: 'none' };

/**
 * @typedef {{ runChecks: boolean, codeChanged: boolean, unitTests: boolean, e2e: 'none' | 'pr' | 'full', lighthouse: 'none' | 'sample' | 'full' }} CiPlan
 */

/** @type {CiPlan} */
const FULL = { runChecks: true, codeChanged: true, unitTests: true, e2e: 'full', lighthouse: 'full' };
/** @type {CiPlan} */
const PR = { runChecks: true, codeChanged: true, unitTests: true, e2e: 'pr', lighthouse: 'sample' };
/**
 * Static checks, the audit and the builds: what a draft runs.
 * @type {CiPlan}
 */
const QUICK = { runChecks: true, codeChanged: true, unitTests: false, e2e: 'none', lighthouse: 'none' };

/**
 * Works out the plan for one run.
 * @param {{ eventName?: string, isDraft?: string, headRef?: string, labels?: string, fullInput?: string, headSha?: string, lastNightlySha?: string, changedFiles?: string[] | null }} input
 *   `changedFiles` is the PR's diff, or null when it could not be computed.
 * @returns {CiPlan}
 */
export function planRun({ eventName = '', isDraft = '', headRef = '', labels = '', fullInput = '', headSha = '', lastNightlySha = '', changedFiles = null }) {
  if (eventName === 'schedule') {
    if (headSha && lastNightlySha === headSha) {
      return NOTHING;
    }
    return FULL;
  }

  if (eventName === 'workflow_dispatch') {
    return fullInput === 'true' ? FULL : PR;
  }

  if (eventName === 'merge_group') return PR;

  if (eventName !== 'pull_request') return FULL;

  if (changedFiles && changedFiles.length > 0 && changedFiles.every(isDocsOnlyFile)) {
    return { runChecks: true, codeChanged: false, unitTests: true, e2e: 'none', lighthouse: 'none' };
  }
  if (headRef.startsWith('release/') || parseLabels(labels).includes(FULL_E2E_LABEL)) return FULL;
  if (isDraft === 'true') return QUICK;
  return PR;
}

/**
 * Formats the step outputs.
 * @param {CiPlan} plan
 * @returns {string}
 */
export function formatPlan(plan) {
  return `run_checks=${plan.runChecks}\ncode_changed=${plan.codeChanged}\nunit_tests=${plan.unitTests}\ne2e=${plan.e2e}\nlighthouse=${plan.lighthouse}\n`;
}

async function main() {
  const eventName = process.env.EVENT_NAME;
  let changedFiles = null;
  if (eventName === 'pull_request') {
    const { files, mode } = computeChangedFiles({ eventName, baseRef: process.env.BASE_REF });
    changedFiles = mode === 'pull_request' ? files : null;
  }

  const plan = planRun({
    eventName,
    isDraft: process.env.IS_DRAFT,
    headRef: process.env.HEAD_REF,
    labels: process.env.LABELS,
    fullInput: process.env.FULL_INPUT,
    headSha: process.env.HEAD_SHA,
    lastNightlySha: process.env.LAST_NIGHTLY_SHA,
    changedFiles,
  });

  console.log(`CI plan for ${eventName}: ${JSON.stringify(plan)}`);
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) fs.appendFileSync(outputPath, formatPlan(plan), 'utf8');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  await main();
}
