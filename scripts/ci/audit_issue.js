/**
 * Turns the nightly dependency audit result into one GitHub issue, replacing the
 * SMTP failure email (GitHub issue #1184).
 *
 * - Audit failed, no alert open: opens "Dependency audit failing", assigned to
 *   the owner, with a summary of `pnpm audit --json` and the run link.
 * - Audit failed, alert already open: comments on it with the new summary.
 * - Audit passed, alert open: comments "Audit passing again" and closes it.
 * - Anything else (passed with no alert, cancelled, skipped): does nothing.
 *
 * The alert is found by a hidden marker in its body, so renaming the issue is safe.
 * Inputs come from the step's `env:` block: AUDIT_OUTCOME (`success` or
 * `failure`), RUN_URL, and GH_TOKEN for the gh CLI.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execBinary } from '../utils/execHelper.js';
import { findOpenAlert as findAlert, runGh, syncAlertIssue } from './alert_issue.js';

export { runGh };

export const MARKER = '<!-- dependency-audit -->';
export const TITLE = 'Dependency audit failing';
const LABELS = ['bug', 'area:ci', 'priority:P1'];
const MAX_ROWS = 50;
const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info'];

/**
 * @typedef {{ module_name?: string, severity?: string, title?: string, url?: string,
 *   vulnerable_versions?: string, patched_versions?: string }} Advisory
 */

/**
 * Escapes text for a Markdown table cell.
 * @param {unknown} value
 * @returns {string}
 */
function cell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .trim();
}

/**
 * Builds the Markdown summary of a `pnpm audit --json` report.
 * @param {string | null} reportJson
 * @returns {string}
 */
export function summarizeAudit(reportJson) {
  /** @type {{ advisories?: Record<string, Advisory>, metadata?: { vulnerabilities?: Record<string, number> } }} */
  let report;
  try {
    report = JSON.parse(reportJson ?? '');
  } catch {
    return 'The audit report could not be read. The run log has the details.';
  }

  const counts = report.metadata?.vulnerabilities ?? {};
  const totals = SEVERITY_ORDER.filter(level => (counts[level] ?? 0) > 0)
    .map(level => `${counts[level]} ${level}`)
    .join(', ');

  const advisories = Object.values(report.advisories ?? {}).sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity ?? 'info') - SEVERITY_ORDER.indexOf(b.severity ?? 'info')
  );
  if (advisories.length === 0) {
    return 'The audit failed without listing any advisories. The run log has the details.';
  }

  const rows = advisories
    .slice(0, MAX_ROWS)
    .map(
      a =>
        `| ${cell(a.module_name)} | ${cell(a.severity)} | ${a.url ? `[${cell(a.title)}](${cell(a.url)})` : cell(a.title)} | ${cell(a.vulnerable_versions)} | ${cell(a.patched_versions)} |`
    );
  const more =
    advisories.length > MAX_ROWS ? `\n\n${advisories.length - MAX_ROWS} more advisories are in the run log.` : '';

  return [
    `Vulnerabilities: ${totals || 'none counted'}.`,
    '',
    '| Package | Severity | Advisory | Vulnerable | Patched |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n') + more;
}

/**
 * Runs `pnpm audit --json` and returns its stdout, even when it exits non-zero.
 * @returns {string | null}
 */
function readAuditReport() {
  try {
    return execBinary('pnpm', ['audit', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const stdout = /** @type {{ stdout?: unknown }} */ (error).stdout;
    return typeof stdout === 'string' ? stdout : null;
  }
}

/**
 * Finds the open audit alert's number, or null.
 * @param {(args: string[]) => string} gh
 * @param {string} [marker] Hidden marker that identifies the alert issue.
 * @returns {number | null}
 */
export function findOpenAlert(gh, marker = MARKER) {
  return findAlert(gh, marker);
}

/**
 * Opens, updates or closes the alert issue for one audit outcome.
 * @param {{ outcome: string, runUrl: string, gh?: (args: string[]) => string,
 *   readReport?: () => string | null, log?: (message: string) => void }} options
 * @returns {'opened' | 'commented' | 'closed' | 'none'}
 */
export function syncAuditIssue({ outcome, runUrl, gh = runGh, readReport = readAuditReport, log = console.log }) {
  // Read the report only for a failure, and only once.
  let summary = null;
  const failureSummary = () => (summary ??= summarizeAudit(readReport()));
  return syncAlertIssue({
    outcome,
    runUrl,
    gh,
    log,
    copy: {
      name: 'Audit',
      marker: MARKER,
      title: TITLE,
      labels: LABELS,
      closeBody: runLine => `Audit passing again.\n\n${runLine}`,
      commentBody: runLine => `The nightly dependency audit is still failing.\n\n${failureSummary()}\n\n${runLine}`,
      openBody: runLine =>
        [
          'The nightly `pnpm audit --audit-level=moderate` found at least one moderate or higher vulnerability.',
          '',
          failureSummary(),
          '',
          runLine,
          '',
          'Update or override the affected packages. The next passing run closes this issue.',
        ].join('\n'),
    },
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  syncAuditIssue({ outcome: process.env.AUDIT_OUTCOME ?? '', runUrl: process.env.RUN_URL ?? '' });
}
