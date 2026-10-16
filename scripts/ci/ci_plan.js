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
 * - pull_request from a bot that opens PRs unasked (Google Labs Stitch): the quick
 *   tier only (static checks, the audit and the builds, as on a draft) until a
 *   maintainer adds the `ci-approved` label. A lint, type or build error turns `CI`
 *   red, so the bot fixes its own mistakes before anyone reviews the PR. The
 *   required `Stitch review` status stays pending until the label is added, so a
 *   bot PR with auto-merge on cannot merge unreviewed. The label counts only when
 *   someone with admin or maintain permission added it (`approvalIsTrusted`). It is
 *   read on the next push or ready-for-review event, so approving is "add the
 *   label, then update the branch".
 *
 * Inputs come from the step's `env:` block: EVENT_NAME, IS_DRAFT, HEAD_REF,
 * LABELS (JSON array of label names), AUTHOR, FULL_INPUT, BASE_REF, HEAD_SHA,
 * LAST_NIGHTLY_SHA, and GH_TOKEN, REPO and PR_NUMBER for the approval check. Outputs go to $GITHUB_OUTPUT: run_checks, code_changed,
 * unit_tests, e2e (none, pr or full), lighthouse (none, sample or full) and
 * awaiting_approval.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeChangedFiles } from './changed_files.js';

export const FULL_E2E_LABEL = 'full-e2e';
export const CI_APPROVED_LABEL = 'ci-approved';
/** Bots whose PRs wait for a maintainer before CI spends minutes on them. */
export const GATED_AUTHORS = ['google-labs-stitch[bot]'];
/** Branch prefixes those bots push to, in case the author is reported differently. */
export const GATED_BRANCH_PREFIXES = ['stitch/'];
/** Repository roles whose `ci-approved` label counts. */
export const APPROVER_ROLES = ['admin', 'maintain'];
/** Issue-event pages read when looking for who added the label (100 events each). */
const MAX_EVENT_PAGES = 10;

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

/**
 * Whether this run is a pull request from a bot that opens PRs unasked.
 * @param {{ eventName?: string, author?: string, headRef?: string }} input
 * @returns {boolean}
 */
export function isGatedPullRequest({ eventName = '', author = '', headRef = '' }) {
  if (eventName !== 'pull_request') return false;
  return GATED_AUTHORS.includes(author) || GATED_BRANCH_PREFIXES.some(prefix => headRef.startsWith(prefix));
}

/**
 * Whether this run is a gated bot PR that does not carry the `ci-approved` label.
 * `approvalIsTrusted` then checks who added a label that is there.
 * @param {{ eventName?: string, author?: string, headRef?: string, labels?: string }} input
 * @returns {boolean}
 */
export function awaitsApproval({ eventName = '', author = '', headRef = '', labels = '' }) {
  return isGatedPullRequest({ eventName, author, headRef }) && !parseLabels(labels).includes(CI_APPROVED_LABEL);
}

/**
 * Whether the newest `ci-approved` label on a PR was added by someone with an
 * approver role. Fails closed: a bot, an unknown user or any API error means no.
 * @param {{ token?: string, repo?: string, prNumber?: string, fetchImpl?: typeof fetch }} input
 * @returns {Promise<{ trusted: boolean, reason: string }>}
 */
export async function approvalIsTrusted({ token = '', repo = '', prNumber = '', fetchImpl = globalThis.fetch }) {
  if (!token || !repo || !/^\d+$/.test(prNumber)) return { trusted: false, reason: 'no token, repository or PR number' };
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' };
  /** @param {string} path */
  const get = async path => {
    const response = await fetchImpl(`https://api.github.com/repos/${repo}/${path}`, { headers });
    if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
    return response.json();
  };
  try {
    /** @type {string | null} */
    let approver = null;
    let approverIsBot = false;
    let readAll = false;
    for (let page = 1; page <= MAX_EVENT_PAGES; page += 1) {
      const events = await get(`issues/${prNumber}/events?per_page=100&page=${page}`);
      if (!Array.isArray(events) || events.length === 0) {
        readAll = true;
        break;
      }
      for (const event of events) {
        if (event?.event === 'labeled' && event.label?.name === CI_APPROVED_LABEL && typeof event.actor?.login === 'string') {
          approver = event.actor.login;
          approverIsBot = event.actor.type === 'Bot';
        }
      }
      if (events.length < 100) {
        readAll = true;
        break;
      }
    }
    // Events come oldest first, so an unread page could hold a newer label event.
    if (!readAll) return { trusted: false, reason: `more than ${MAX_EVENT_PAGES * 100} issue events` };
    if (!approver) return { trusted: false, reason: `no ${CI_APPROVED_LABEL} label event found` };
    if (approverIsBot) return { trusted: false, reason: `${approver} is a bot` };
    const permission = await get(`collaborators/${encodeURIComponent(approver)}/permission`);
    const role = typeof permission?.role_name === 'string' ? permission.role_name : permission?.permission;
    if (APPROVER_ROLES.includes(role)) return { trusted: true, reason: `added by ${approver} (${role})` };
    return { trusted: false, reason: `added by ${approver}, whose role is ${role ?? 'unknown'}` };
  } catch (error) {
    return { trusted: false, reason: error instanceof Error ? error.message : String(error) };
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
 * Static checks, the audit and the builds: what a draft or an unreviewed bot PR runs.
 * @type {CiPlan}
 */
export const QUICK = { runChecks: true, codeChanged: true, unitTests: false, e2e: 'none', lighthouse: 'none' };

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
  const pr = { eventName, author: process.env.AUTHOR, headRef: process.env.HEAD_REF, labels: process.env.LABELS };
  let awaiting = awaitsApproval(pr);
  if (!awaiting && isGatedPullRequest(pr)) {
    const { trusted, reason } = await approvalIsTrusted({
      token: process.env.GH_TOKEN,
      repo: process.env.REPO,
      prNumber: process.env.PR_NUMBER,
    });
    console.log(`The ${CI_APPROVED_LABEL} label ${trusted ? 'counts' : 'does not count'}: ${reason}.`);
    awaiting = !trusted;
  }
  const outputPath = process.env.GITHUB_OUTPUT;
  if (awaiting) {
    console.log(`CI plan for ${eventName}: quick checks only until a maintainer adds the ${CI_APPROVED_LABEL} label.`);
    if (outputPath) fs.appendFileSync(outputPath, `${formatPlan(QUICK)}awaiting_approval=true\n`, 'utf8');
    return;
  }

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
  if (outputPath) fs.appendFileSync(outputPath, `${formatPlan(plan)}awaiting_approval=false\n`, 'utf8');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  await main();
}
