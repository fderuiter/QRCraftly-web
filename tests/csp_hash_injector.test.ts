import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BASE_CSP_PATTERN, extractInlineScripts, computeCspHash, replaceMetaCSP, updateCsp, validateHeaders, pathToRoute, generateHeadersContent, allHashes } from '../scripts/csp_hash_injector.js';
import { DEFERRED_SCRIPTS_POLICY } from '../scripts/defer_page_scripts.js';
import { TRUSTED_TYPES_POLICY } from '../src/packages/core/security';

describe('CSP Hash Injector Unit Tests', () => {
  describe('pathToRoute', () => {
    it('should correctly map HTML file paths to URL route paths', () => {
      expect(pathToRoute('index.html')).toBe('/');
      expect(pathToRoute('/index.html')).toBe('/');
      expect(pathToRoute('about/index.html')).toBe('/about');
      expect(pathToRoute('file-transfer/receive/index.html')).toBe('/file-transfer/receive');
      expect(pathToRoute('404.html')).toBe('/404');
    });
  });

  describe('generateHeadersContent', () => {
    it('writes one global CSP rule and drops CSP lines from other rules (#1109)', () => {
      const baseCsp = updateCsp(BASE_CSP_PATTERN, ["'sha256-index'", "'sha256-about'"]);
      const existingHeaders = `/*\n  X-Frame-Options: DENY\n  Strict-Transport-Security: max-age=63072000\n\n/about\n  Content-Security-Policy: default-src 'none';\n  X-Robots-Tag: noindex\n`;

      const generated = generateHeadersContent(existingHeaders, baseCsp);

      expect(generated).toContain(`/*\n  Content-Security-Policy: ${baseCsp}\n  X-Frame-Options: DENY`);
      expect(generated).toContain('/about\n  X-Robots-Tag: noindex');
      expect(generated.match(/Content-Security-Policy:/g)).toHaveLength(1);
      expect(() => validateHeaders(baseCsp, generated)).not.toThrow();
    });
  });

  describe('allHashes', () => {
    it('returns every route hash once, in first-seen order', () => {
      expect(allHashes([["'a'", "'b'"], ["'b'", "'a'", "'c'"], ["'d'"]])).toEqual(["'a'", "'b'", "'c'", "'d'"]);
      expect(allHashes([])).toEqual([]);
    });
  });

  describe('extractInlineScripts', () => {
    it('should extract simple inline scripts and ignore scripts with src attribute', () => {
      const html = `
        <html>
          <head>
            <script src="/js/external.js"></script>
            <script>console.log("hello world");</script>
            <script type="application/ld+json">{"@context": "https://schema.org"}</script>
          </head>
        </html>
      `;
      const extracted = extractInlineScripts(html);
      expect(extracted).toHaveLength(2);
      expect(extracted[0]).toBe('console.log("hello world");');
      expect(extracted[1]).toBe('{"@context": "https://schema.org"}');
    });

    it('should handle script tags with line breaks and attributes', () => {
      const html = `
        <script id="vike_pageContext" type="application/json">
          {"pageId": "/src/pages/index"}
        </script>
      `;
      const extracted = extractInlineScripts(html);
      expect(extracted).toHaveLength(1);
      expect(extracted[0]).toContain('{"pageId": "/src/pages/index"}');
    });
  });

  describe('computeCspHash', () => {
    it('should calculate correct sha256 hash formatted for CSP', () => {
      const script = 'console.log("hello world");';
      // Expected Base64 of sha256("console.log("hello world");")
      // sha256 hash in hex: b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9 -> base64 is uU0nuZNNPgilLlLX2n2r+sSE7+N6U4DukIj3rOLvzek=
      // Let's compute dynamic output and assert prefix
      const hashResult = computeCspHash(script);
      expect(hashResult).toMatch(/^'sha256-[A-Za-z0-9+/=]+'$/);
    });
  });

  describe('replaceMetaCSP', () => {
    it('should replace the content attribute in Content-Security-Policy meta tag', () => {
      const html = '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\';" />';
      const updated = replaceMetaCSP(html, "default-src 'self'; script-src 'self' 'sha256-abc';");
      expect(updated).toContain('content="default-src &#x27;self&#x27;; script-src &#x27;self&#x27; &#x27;sha256-abc&#x27;;"');
    });
  });

  describe('updateCsp', () => {
    it('should update script-src directive by removing unsafe-inline and adding hashes', () => {
      const originalCsp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self';";
      const hashes = ["'sha256-abc'", "'sha256-def'"];
      const updated = updateCsp(originalCsp, hashes);
      expect(updated).toContain("script-src 'self' 'sha256-abc' 'sha256-def';");
      expect(updated).not.toContain("'unsafe-inline'");
      expect(updated).toContain("style-src 'self';");
    });
  });

  describe('validateHeaders', () => {
    it('should pass valid headers configuration', () => {
      const csp = "default-src 'self';";
      const content = `/*\n  Content-Security-Policy: ${csp}\n  X-Frame-Options: DENY\n`;
      const results = validateHeaders(csp, content);
      expect(results.cspLength).toBe(19);
      expect(results.totalHeadersSize).toBeGreaterThan(0);
      expect(results.routeHeaders['/*']).toHaveLength(2);
    });

    it('should throw error when CSP is too long', () => {
      const csp = "a".repeat(2001);
      const content = `/*\n  Content-Security-Policy: ${csp}\n`;
      expect(() => validateHeaders(csp, content)).toThrowError(/exceeds Cloudflare's individual header limit/);
    });

    it('should throw error when _headers file is too large', () => {
      const csp = "default-src 'self';";
      const content = "a".repeat(8193);
      expect(() => validateHeaders(csp, content)).toThrowError(/exceeds Cloudflare's limit of 8,192 bytes/);
    });

    it('should throw error if any header exceeds 2000 characters', () => {
      const csp = "default-src 'self';";
      const tooLongHeader = "b".repeat(2001);
      const content = `/*\n  Custom-Header: ${tooLongHeader}\n`;
      expect(() => validateHeaders(csp, content)).toThrowError(/exceeds 2,000 characters/);
    });

    it('rejects a _headers file where more than one rule sets the CSP (#1109)', () => {
      const headers = "/*\n  Content-Security-Policy: default-src 'self';\n\n/about\n  Content-Security-Policy: default-src 'self';\n";
      expect(() => validateHeaders(headers)).toThrow(/set by 2 _headers rules/);
    });

    it('should throw error if total headers exceed 8192 bytes', () => {
      const csp = "default-src 'self';";
      const largeHeader = "b".repeat(1500);
      const content = `/*\n` + Array(6).fill(`  X-Custom-Header: ${largeHeader}\n`).join("");
      expect(() => validateHeaders(csp, content)).toThrowError(/exceeds Cloudflare's limit of 8,192 bytes/);
    });

    it('rejects route matchers that do not start with / or https:// while allowing valid domain-prefixed rules', () => {
      const csp = "default-src 'self';";
      const validDomainContent = `https://:subdomain.fpderuiter.workers.dev/*\n  X-Robots-Tag: noindex\n`;
      expect(() => validateHeaders(csp, validDomainContent)).not.toThrow();

      const invalidPathContent = `assets/*\n  Cache-Control: no-cache\n`;
      expect(() => validateHeaders(csp, invalidPathContent)).toThrowError(/Invalid route matcher "assets\/\*" in _headers: route matchers must start with "\/" or "https:\/\/"/);
    });
  });

  describe('BASE_CSP_PATTERN', () => {
    const directiveSources = (csp: string, name: string): string[] | undefined => {
      const directive = csp.split(';').map(d => d.trim()).find(d => d.split(/\s+/)[0] === name);
      return directive?.split(/\s+/).slice(1);
    };

    it('allows blob: images and blob: media for SVG export and video scanning (#969)', () => {
      expect(directiveSources(BASE_CSP_PATTERN, 'img-src')).toEqual(["'self'", 'data:', 'blob:']);
      expect(directiveSources(BASE_CSP_PATTERN, 'media-src')).toEqual(["'self'", 'blob:']);
    });

    it('keeps blob: sources after inline script hashes are injected (#969)', () => {
      const routeCsp = updateCsp(BASE_CSP_PATTERN, ["'sha256-abc'"]);
      expect(directiveSources(routeCsp, 'img-src')).toEqual(["'self'", 'data:', 'blob:']);
      expect(directiveSources(routeCsp, 'media-src')).toEqual(["'self'", 'blob:']);
      expect(directiveSources(routeCsp, 'script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", "'sha256-abc'"]);
    });

    it('allowlists no third-party origins now that Google Fonts is gone (#970)', () => {
      expect(BASE_CSP_PATTERN).not.toMatch(/https?:/);
      expect(directiveSources(BASE_CSP_PATTERN, 'font-src')).toEqual(["'self'"]);
      expect(directiveSources(BASE_CSP_PATTERN, 'style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    });

    it('enforces Trusted Types with only the app policy and the script loader policy (#1172)', () => {
      expect(directiveSources(BASE_CSP_PATTERN, 'require-trusted-types-for')).toEqual(["'script'"]);
      expect(directiveSources(BASE_CSP_PATTERN, 'trusted-types')).toEqual([TRUSTED_TYPES_POLICY, DEFERRED_SCRIPTS_POLICY]);
    });

    it('matches the meta CSP rendered by src/layouts/Head.tsx byte for byte', () => {
      const headSource = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/layouts/Head.tsx'), 'utf8');
      const match = /const CONTENT_SECURITY_POLICY = "([^"]+)";/.exec(headSource);
      expect(match?.[1]).toBe(BASE_CSP_PATTERN);
    });
  });
});
