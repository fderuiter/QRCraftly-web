import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execBinary, resolveBash } from '../utils/execHelper';

const repoRoot = process.cwd();
const SCRIPT = path.join(repoRoot, 'scripts/ci/install_playwright.sh');
const read = (file: string) => fs.readFileSync(path.join(repoRoot, file), 'utf8');

/** Stubs `sudo`, `timeout` and `pnpm` on PATH; `pnpm` fails the first `failures` times it runs. */
function stubBin(dir: string, failures: number) {
  const write = (name: string, body: string) => {
    fs.writeFileSync(path.join(dir, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
  };
  write('sudo', 'cat >/dev/null 2>&1 || true\necho "sudo $*" >>"$STUB_LOG"');
  // Drop `--kill-after=N SECONDS` and run the command, as the real timeout would when it finishes in time.
  write('timeout', 'shift 2\n"$@"');
  write(
    'pnpm',
    [
      'count=$(cat "$STUB_COUNT" 2>/dev/null || echo 0)',
      'echo $((count + 1)) >"$STUB_COUNT"',
      'echo "pnpm $*" >>"$STUB_LOG"',
      `[ "$count" -ge ${failures} ]`,
    ].join('\n')
  );
}

describe('Playwright install in CI (scripts/ci/install_playwright.sh)', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  function run(failures: number, attempts = 3) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'install-playwright-'));
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    stubBin(bin, failures);
    const log = path.join(tmp, 'log');
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      STUB_LOG: log,
      STUB_COUNT: path.join(tmp, 'count'),
      PLAYWRIGHT_INSTALL_ATTEMPTS: String(attempts),
    };
    let ok = true;
    try {
      execBinary(resolveBash(), [SCRIPT, 'chromium'], { env, stdio: 'pipe' });
    } catch {
      ok = false;
    }
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    return { ok, pnpm: calls.filter((c) => c.startsWith('pnpm ')) };
  }

  it('installs the system libraries, then the browsers', () => {
    const { ok, pnpm } = run(0);
    expect(ok).toBe(true);
    expect(pnpm).toEqual(['pnpm exec playwright install-deps chromium', 'pnpm exec playwright install chromium']);
  });

  it('retries a failed or timed-out attempt', () => {
    const { ok, pnpm } = run(2);
    expect(ok).toBe(true);
    expect(pnpm).toHaveLength(4);
    expect(pnpm.at(-1)).toBe('pnpm exec playwright install chromium');
  });

  it('fails the step once every attempt has failed', () => {
    const { ok, pnpm } = run(99, 2);
    expect(ok).toBe(false);
    expect(pnpm).toEqual(['pnpm exec playwright install-deps chromium', 'pnpm exec playwright install-deps chromium']);
  });

  it('limits each attempt and the whole step', () => {
    expect(read('scripts/ci/install_playwright.sh')).toMatch(/timeout --kill-after=\d+ "\$ATTEMPT_SECONDS"/);
    expect(read('.github/workflows/main.yml')).toMatch(
      /- name: Install Playwright Browsers\n\s+timeout-minutes: \d+\n\s+run: bash scripts\/ci\/install_playwright\.sh\n/
    );
  });

  it('is the only way CI installs Playwright', () => {
    expect(read('scripts/ci/run_smoke_tests.sh')).toContain('install_playwright.sh" chromium');
    const workflows = fs.readdirSync(path.join(repoRoot, '.github/workflows'));
    for (const file of [...workflows.map((f) => `.github/workflows/${f}`), 'scripts/ci/run_smoke_tests.sh']) {
      expect(read(file), file).not.toMatch(/playwright install/);
    }
  });
});
