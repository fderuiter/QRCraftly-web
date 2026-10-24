/**
 * The open, comment and close cycle shared by CI's alert issues (#1618): the dependency
 * audit (audit_issue.js) and the nightly run (nightly_issue.js) pass only their copy.
 *
 * - Failed, no alert open: opens the alert, assigned to the owner, with its labels.
 * - Failed, alert open: comments on it.
 * - Passed, alert open: closes it as completed, with a comment.
 * - Anything else (passed with no alert, cancelled, skipped): does nothing.
 *
 * The alert is found by a hidden marker in its body, so renaming the issue is safe.
 */

import { execBinary } from '../utils/execHelper.js';

/** Who every alert issue is assigned to. */
export const ASSIGNEE = 'fderuiter';

/**
 * Runs the gh CLI and returns stdout.
 * @param {string[]} args
 * @returns {string}
 */
export function runGh(args) {
  return execBinary('gh', args, { stdio: ['ignore', 'pipe', 'inherit'] });
}

/**
 * Finds the open alert issue's number, or null.
 * @param {(args: string[]) => string} gh
 * @param {string} marker Hidden marker that identifies the alert issue.
 * @returns {number | null}
 */
export function findOpenAlert(gh, marker) {
  const issues = JSON.parse(gh(['issue', 'list', '--state', 'open', '--limit', '500', '--json', 'number,body']));
  /** @type {{ number: number, body?: string }[]} */
  const list = Array.isArray(issues) ? issues : [];
  const match = list.find(issue => typeof issue.body === 'string' && issue.body.includes(marker));
  return match ? match.number : null;
}

/**
 * @typedef {object} AlertCopy
 * @property {string} name What failed, in log lines (for example "Audit").
 * @property {string} marker Hidden marker written into the issue body.
 * @property {string} title Title of a new alert.
 * @property {string[]} labels Labels of a new alert.
 * @property {(runLine: string) => string} openBody Body of a new alert, after the marker.
 * @property {(runLine: string) => string} commentBody Comment while it keeps failing.
 * @property {(runLine: string) => string} closeBody Comment when it passes again.
 */

/**
 * Opens, updates or closes one alert issue for one outcome.
 * @param {{ outcome: string, runUrl: string, copy: AlertCopy, gh?: (args: string[]) => string,
 *   log?: (message: string) => void }} options
 * @returns {'opened' | 'commented' | 'closed' | 'none'}
 */
export function syncAlertIssue({ outcome, runUrl, copy, gh = runGh, log = console.log }) {
  if (outcome !== 'success' && outcome !== 'failure') {
    log(`${copy.name} outcome "${outcome}": nothing to do.`);
    return 'none';
  }

  const existing = findOpenAlert(gh, copy.marker);
  const runLine = runUrl ? `Run: ${runUrl}` : 'Run link unavailable.';

  if (outcome === 'success') {
    if (existing === null) {
      log(`${copy.name} passed and no alert is open.`);
      return 'none';
    }
    gh(['issue', 'close', String(existing), '--reason', 'completed', '--comment', copy.closeBody(runLine)]);
    log(`${copy.name} passed: closed #${existing}.`);
    return 'closed';
  }

  if (existing !== null) {
    gh(['issue', 'comment', String(existing), '--body', copy.commentBody(runLine)]);
    log(`${copy.name} failed: commented on #${existing}.`);
    return 'commented';
  }

  const body = `${copy.marker}\n${copy.openBody(runLine)}`;
  const args = ['issue', 'create', '--title', copy.title, '--body', body, '--assignee', ASSIGNEE];
  for (const label of copy.labels) args.push('--label', label);
  gh(args);
  log(`${copy.name} failed: opened a new alert issue.`);
  return 'opened';
}
