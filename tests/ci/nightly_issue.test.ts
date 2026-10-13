import { describe, expect, it } from 'vitest';
import { NIGHTLY_MARKER, NIGHTLY_TITLE, syncNightlyIssue } from '../../scripts/ci/nightly_issue.js';

const RUN_URL = 'https://github.com/fderuiter/QRCraftly-web/actions/runs/2';

function fakeGh(openIssues: { number: number; body: string }[]) {
  const calls: string[][] = [];
  const gh = (args: string[]): string => {
    calls.push(args);
    return args[1] === 'list' ? JSON.stringify(openIssues) : '';
  };
  return { gh, calls };
}

const quiet = () => {};

describe('scripts/ci/nightly_issue.js', () => {
  it('opens one assigned, labelled issue when the nightly run fails', () => {
    const { gh, calls } = fakeGh([{ number: 7, body: '<!-- dependency-audit -->' }]);
    expect(syncNightlyIssue({ outcome: 'failure', runUrl: RUN_URL, gh, log: quiet })).toBe('opened');
    const create = calls.find(args => args[1] === 'create');
    expect(create).toBeDefined();
    expect(create).toContain(NIGHTLY_TITLE);
    expect(create).toContain('fderuiter');
    expect(create?.join(' ')).toContain(NIGHTLY_MARKER);
    expect(create?.join(' ')).toContain(RUN_URL);
  });

  it('comments on the open alert while the nightly run keeps failing', () => {
    const { gh, calls } = fakeGh([{ number: 9, body: `${NIGHTLY_MARKER}\nfailing` }]);
    expect(syncNightlyIssue({ outcome: 'failure', runUrl: RUN_URL, gh, log: quiet })).toBe('commented');
    expect(calls.at(-1)?.slice(0, 3)).toEqual(['issue', 'comment', '9']);
  });

  it('closes the alert when the nightly run passes again, and does nothing otherwise', () => {
    const open = fakeGh([{ number: 9, body: NIGHTLY_MARKER }]);
    expect(syncNightlyIssue({ outcome: 'success', runUrl: RUN_URL, gh: open.gh, log: quiet })).toBe('closed');
    expect(open.calls.at(-1)?.slice(0, 3)).toEqual(['issue', 'close', '9']);

    const none = fakeGh([]);
    expect(syncNightlyIssue({ outcome: 'success', runUrl: RUN_URL, gh: none.gh, log: quiet })).toBe('none');
    expect(syncNightlyIssue({ outcome: 'cancelled', runUrl: RUN_URL, gh: none.gh, log: quiet })).toBe('none');
    expect(none.calls).toHaveLength(1);
  });
});
