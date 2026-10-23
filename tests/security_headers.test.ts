import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import worker from '../public/_worker.js';

const HEADERS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/_headers');

/**
 * Parses the global (`/*`) block of a Cloudflare `_headers` file into a header map.
 */
function readGlobalHeaders(): Map<string, string> {
  const lines = fs.readFileSync(HEADERS_PATH, 'utf8').split(/\r?\n/);
  const headers = new Map<string, string>();
  let inGlobalBlock = false;
  for (const line of lines) {
    if (!/^\s/.test(line) && line.trim() !== '') {
      inGlobalBlock = line.trim() === '/*';
      continue;
    }
    const separator = line.indexOf(':');
    if (inGlobalBlock && separator > 0) {
      headers.set(line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim());
    }
  }
  return headers;
}

function readPermissionsPolicy(): Map<string, string> {
  const policy = readGlobalHeaders().get('permissions-policy') ?? '';
  const features = new Map<string, string>();
  for (const entry of policy.split(',').map(e => e.trim()).filter(Boolean)) {
    const [feature, allowlist] = entry.split('=');
    features.set(feature.trim(), (allowlist ?? '').trim());
  }
  return features;
}

describe('public/_headers security headers', () => {
  it('declares a Permissions-Policy for every route', () => {
    expect(readGlobalHeaders().has('permissions-policy')).toBe(true);
  });

  it('lets the site itself use geolocation for "Use Current Location" (#970)', () => {
    expect(readPermissionsPolicy().get('geolocation')).toBe('(self)');
  });

  it('keeps the microphone disabled, since no feature uses it', () => {
    expect(readPermissionsPolicy().get('microphone')).toBe('()');
  });

  it('keeps the camera available to the site itself only, for the optical scanner', () => {
    expect(readPermissionsPolicy().get('camera')).toBe('(self)');
  });

  it('keeps payment disabled', () => {
    expect(readPermissionsPolicy().get('payment')).toBe('()');
  });

  it('keeps the baseline hardening headers', () => {
    const headers = readGlobalHeaders();
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('strict-transport-security')).toMatch(/^max-age=\d+/);
  });

  it('sends HSTS for subdomains too, without the preload flag, which is a separate decision (#1160)', () => {
    const hsts = readGlobalHeaders().get('strict-transport-security') ?? '';
    expect(hsts).toMatch(/;\s*includeSubDomains\b/);
    expect(hsts).not.toMatch(/preload/);
    expect(Number(/max-age=(\d+)/.exec(hsts)?.[1])).toBeGreaterThanOrEqual(31536000);
  });

  it('upgrades insecure subresource requests through the page policy (#1160)', () => {
    expect(fs.readFileSync(path.resolve(path.dirname(HEADERS_PATH), '../src/layouts/Head.tsx'), 'utf8')).toContain(
      "form-action 'self';"
    );
  });

  it('allowlists no third-party font hosts (#970)', () => {
    expect(fs.readFileSync(HEADERS_PATH, 'utf8')).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('ensures all route matchers in public/_headers begin with a leading slash relative path (#1028)', () => {
    const content = fs.readFileSync(HEADERS_PATH, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || line.startsWith(' ') || line.startsWith('\t')) continue;
      expect(trimmed.startsWith('/')).toBe(true);
    }
    expect(content).not.toContain('https://');
    expect(readGlobalHeaders().has('x-robots-tag')).toBe(false);
  });

  it('edge Worker middleware injects X-Robots-Tag: noindex for non-canonical hosts', async () => {
    const mockAssetFetch = async (req: Request) => new Response('OK', { status: 200, headers: { 'Content-Type': 'text/html' } });
    const env = { ASSETS: { fetch: mockAssetFetch } };

    // Canonical request: qrcraftly.com
    const canonicalReq = new Request('https://qrcraftly.com/about');
    const canonicalRes = await worker.fetch(canonicalReq, env);
    expect(canonicalRes.headers.get('X-Robots-Tag')).toBeNull();

    // Non-canonical request: workers.dev host
    const workerDevReq = new Request('https://qrcraftly.fpderuiter.workers.dev/about');
    const workerDevRes = await worker.fetch(workerDevReq, env);
    expect(workerDevRes.headers.get('X-Robots-Tag')).toBe('noindex');

    // Non-canonical request: PR preview host
    const previewReq = new Request('https://feat-test-qrcraftly.fpderuiter.workers.dev/');
    const previewRes = await worker.fetch(previewReq, env);
    expect(previewRes.headers.get('X-Robots-Tag')).toBe('noindex');
  });
});

describe('public/_headers caching', () => {
  it('never lets a cache serve a stale /version.json, which the deploy checks poll (#1217)', () => {
    const content = fs.readFileSync(HEADERS_PATH, 'utf8');
    expect(content).toMatch(/^\/version\.json\r?\n\s+Cache-Control: no-store$/m);
  });

  it('lets browsers keep the content-hashed files under /assets/ for a year', () => {
    const content = fs.readFileSync(HEADERS_PATH, 'utf8');
    expect(content).toMatch(/^\/assets\/\*\r?\n\s+Cache-Control: public, max-age=31536000, immutable$/m);
  });
});
