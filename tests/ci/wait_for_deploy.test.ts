import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execBinary, resolveBash } from '../utils/execHelper';

const repoRoot = process.cwd();
const SCRIPT = path.join(repoRoot, 'scripts/ci/wait_for_deploy.sh');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

/**
 * Stubs `curl` on PATH. It writes STUB_HEADERS to the `-D` file and STUB_BODY to the `-o` file and
 * prints STUB_STATUS, as `curl -w '%{http_code}'` does; STUB_STATUS=000 fails like a refused connection.
 */
function stubCurl(dir: string) {
  const body = [
    'out=""; dump=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    -o) out="$2"; shift ;;',
    '    -D) dump="$2"; shift ;;',
    '  esac',
    '  shift',
    'done',
    'if [ "$STUB_STATUS" = "000" ]; then printf "000"; echo "curl: (7) Failed to connect" >&2; exit 7; fi',
    'printf "%b" "$STUB_HEADERS" >"$dump"',
    'printf "%s" "$STUB_BODY" >"$out"',
    'printf "%s" "$STUB_STATUS"',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'curl'), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}

describe('Deploy wait (scripts/ci/wait_for_deploy.sh)', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = '';
  });

  function run(stub: { status: string; headers?: string; body?: string }) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wait-for-deploy-'));
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    stubCurl(bin);
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      STUB_STATUS: stub.status,
      STUB_HEADERS: stub.headers ?? '',
      STUB_BODY: stub.body ?? '',
      BASE_URL: 'https://example.test',
      EXPECTED_COMMIT: COMMIT,
      TIMEOUT_SECONDS: '0',
      POLL_SECONDS: '0',
    };
    try {
      const stdout = execBinary(resolveBash(), [SCRIPT], { env, stdio: 'pipe', encoding: 'utf8' });
      return { ok: true, output: String(stdout) };
    } catch (error) {
      const { stdout = '', stderr = '' } = error as { stdout?: string | Buffer; stderr?: string | Buffer };
      return { ok: false, output: `${String(stdout)}${String(stderr)}` };
    }
  }

  it('passes once version.json reports the expected commit', () => {
    const { ok, output } = run({
      status: '200',
      headers: 'HTTP/2 200\r\ncontent-type: application/json\r\n\r\n',
      body: JSON.stringify({ version: '1.2.3', commit: COMMIT }),
    });
    expect(ok).toBe(true);
    expect(output).toContain(`is serving v1.2.3 (${COMMIT})`);
  });

  it('on timeout, prints the status, the cache and routing headers and the start of the body (#1394)', () => {
    const { ok, output } = run({
      status: '403',
      headers: [
        'HTTP/2 301\\r\\nlocation: https://example.test/version.json\\r\\n\\r\\n',
        'HTTP/2 403\\r\\ndate: Sat, 10 Oct 2026 15:46:00 GMT\\r\\ncontent-type: text/html\\r\\nserver: cloudflare\\r\\ncf-ray: 8c1d2e3f4a5b6c7d-IAD\\r\\ncf-cache-status: DYNAMIC\\r\\nage: 0\\r\\nset-cookie: secret=1\\r\\n\\r\\n',
      ].join(''),
      body: '<!DOCTYPE html><title>Just a moment...</title>',
    });
    expect(ok).toBe(false);
    expect(output).toContain('::error title=Production did not serve the expected build::');
    expect(output).toContain('(HTTP 403)');
    expect(output).toContain('HTTP status: 403');
    for (const header of ['cf-cache-status: DYNAMIC', 'age: 0', 'date: Sat', 'server: cloudflare', 'cf-ray: 8c1d', 'content-type: text/html']) {
      expect(output).toContain(header);
    }
    // Only the final hop's headers, and only the diagnostic ones.
    expect(output).not.toContain('location:');
    expect(output).not.toContain('set-cookie');
    expect(output).toContain('| <!DOCTYPE html><title>Just a moment...</title>');
  });

  it('on timeout, says when no HTTP response came back at all', () => {
    const { ok, output } = run({ status: '000' });
    expect(ok).toBe(false);
    expect(output).toContain('No HTTP response. curl said: curl: (7) Failed to connect');
  });

  it('keeps waiting on a stale build and reports what is served', () => {
    const { ok, output } = run({
      status: '200',
      headers: 'HTTP/2 200\\r\\ncontent-type: application/json\\r\\ncf-cache-status: HIT\\r\\nage: 600\\r\\n\\r\\n',
      body: JSON.stringify({ version: '1.2.2', commit: 'f'.repeat(40) }),
    });
    expect(ok).toBe(false);
    expect(output).toContain(`serves version='1.2.2' commit='${'f'.repeat(40)}' (HTTP 200)`);
    expect(output).toContain('cf-cache-status: HIT');
    expect(output).toContain('age: 600');
  });
});
