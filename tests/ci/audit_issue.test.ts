import { describe, expect, it } from 'vitest';
import { MARKER, TITLE, summarizeAudit, syncAuditIssue } from '../../scripts/ci/audit_issue.js';

const RUN_URL = 'https://github.com/fderuiter/QRCraftly-web/actions/runs/1';

const REPORT = JSON.stringify({
  advisories: {
    '1': {
      module_name: 'low-pkg',
      severity: 'low',
      title: 'Minor thing',
      url: 'https://example.com/1',
      vulnerable_versions: '<1.0.0',
      patched_versions: '>=1.0.0',
    },
    '2': {
      module_name: 'bad|pkg',
      severity: 'critical',
      title: 'Remote code execution',
      url: 'https://example.com/2',
      vulnerable_versions: '<2.0.0',
      patched_versions: '>=2.0.0',
    },
  },
  metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 1 } },
});

function fakeGh(openIssues: { number: number; body: string }[]) {
  const calls: string[][] = [];
  const gh = (args: string[]): string => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return JSON.stringify(openIssues);
    return '';
  };
  return { gh, calls };
}

const quiet = () => {};

describe('summarizeAudit', () => {
  it('lists advisories worst first, with totals and escaped cells', () => {
    const summary = summarizeAudit(REPORT);
    expect(summary).toContain('Vulnerabilities: 1 critical, 1 low.');
    expect(summary.indexOf('Remote code execution')).toBeLessThan(summary.indexOf('Minor thing'));
    expect(summary).toContain('| bad\\|pkg | critical | [Remote code execution](https://example.com/2) | <2.0.0 | >=2.0.0 |');
  });

  it('escapes backslashes before pipes so a cell cannot break out of the table', () => {
    const report = JSON.stringify({ advisories: { '1': { module_name: 'a\\|b', severity: 'high', title: 't' } } });
    expect(summarizeAudit(report)).toContain('| a\\\\\\|b | high |');
  });

  it('caps the table at 50 rows', () => {
    const advisories = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [String(i), { module_name: `pkg-${i}`, severity: 'moderate', title: 't' }])
    );
    const summary = summarizeAudit(JSON.stringify({ advisories, metadata: { vulnerabilities: { moderate: 60 } } }));
    expect(summary.split(/\r?\n/).filter(line => line.startsWith('| pkg-'))).toHaveLength(50);
    expect(summary).toContain('10 more advisories are in the run log.');
  });

  it('says so when the report is not JSON', () => {
    expect(summarizeAudit('ERR_PNPM_AUDIT_BAD_RESPONSE')).toContain('could not be read');
    expect(summarizeAudit(null)).toContain('could not be read');
  });
});

describe('syncAuditIssue', () => {
  it('opens a labelled, assigned alert with the marker when the audit fails', () => {
    const { gh, calls } = fakeGh([{ number: 7, body: 'an unrelated issue' }]);
    const result = syncAuditIssue({ outcome: 'failure', runUrl: RUN_URL, gh, readReport: () => REPORT, log: quiet });

    expect(result).toBe('opened');
    const create = calls.find(args => args[1] === 'create');
    expect(create).toBeDefined();
    const args = create ?? [];
    expect(args[args.indexOf('--title') + 1]).toBe(TITLE);
    const body = args[args.indexOf('--body') + 1];
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('Remote code execution');
    expect(body).toContain(RUN_URL);
    expect(args[args.indexOf('--assignee') + 1]).toBe('fderuiter');
    const labels = args.flatMap((arg, i) => (arg === '--label' ? [args[i + 1]] : []));
    expect(labels).toEqual(['bug', 'area:ci', 'priority:P1']);
  });

  it('comments on the open alert instead of opening a second one', () => {
    const { gh, calls } = fakeGh([{ number: 42, body: `${MARKER}\nold` }]);
    const result = syncAuditIssue({ outcome: 'failure', runUrl: RUN_URL, gh, readReport: () => REPORT, log: quiet });

    expect(result).toBe('commented');
    expect(calls.some(args => args[1] === 'create')).toBe(false);
    const comment = calls.find(args => args[1] === 'comment') ?? [];
    expect(comment[2]).toBe('42');
    expect(comment[comment.indexOf('--body') + 1]).toContain(RUN_URL);
  });

  it('closes the open alert as completed when the audit passes again', () => {
    const { gh, calls } = fakeGh([{ number: 42, body: `${MARKER}\nold` }]);
    const result = syncAuditIssue({ outcome: 'success', runUrl: RUN_URL, gh, log: quiet });

    expect(result).toBe('closed');
    const close = calls.find(args => args[1] === 'close') ?? [];
    expect(close.slice(2, 5)).toEqual(['42', '--reason', 'completed']);
    expect(close[close.indexOf('--comment') + 1]).toContain('Audit passing again');
  });

  it('does nothing when the audit passes and no alert is open', () => {
    const { gh, calls } = fakeGh([]);
    expect(syncAuditIssue({ outcome: 'success', runUrl: RUN_URL, gh, log: quiet })).toBe('none');
    expect(calls.map(args => args[1])).toEqual(['list']);
  });

  it('does not touch GitHub when the audit was cancelled or skipped', () => {
    const { gh, calls } = fakeGh([]);
    expect(syncAuditIssue({ outcome: 'cancelled', runUrl: RUN_URL, gh, log: quiet })).toBe('none');
    expect(syncAuditIssue({ outcome: '', runUrl: RUN_URL, gh, log: quiet })).toBe('none');
    expect(calls).toHaveLength(0);
  });
});
