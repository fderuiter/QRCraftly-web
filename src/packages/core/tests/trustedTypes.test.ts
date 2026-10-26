/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Rules = { createScriptURL(input: string): string; createHTML(input: string): string };

/** A stand-in for the browser's factory that records each policy and wraps what it returns. */
function installTrustedTypes() {
  const created: Array<{ name: string; rules: Rules }> = [];
  const html: string[] = [];
  vi.stubGlobal('trustedTypes', {
    createPolicy: (name: string, rules: Rules) => {
      created.push({ name, rules });
      return {
        createScriptURL: (input: string) => ({ trusted: 'script-url', value: rules.createScriptURL(input) }),
        createHTML: (input: string) => {
          html.push(input);
          return rules.createHTML(input);
        },
      };
    },
  });
  return { created, html };
}

/** A fresh copy of the module, so its cached policy starts empty. */
async function loadSecurity() {
  vi.resetModules();
  return import('../security');
}

describe('Trusted Types policy (#1172)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('assertSameOriginScriptUrl', () => {
    it.each(['/sw.js', '/assets/worker-matrix.abc.js', `${window.location.origin}/assets/x.js`, './worker.js'])('accepts %s', async (url) => {
      const { assertSameOriginScriptUrl } = await loadSecurity();
      expect(assertSameOriginScriptUrl(url)).toBe(url);
    });

    it.each(['https://evil.example/x.js', '//evil.example/x.js', 'data:text/javascript,alert(1)', 'blob:https://evil.example/1', 'javascript:alert(1)', 'http://[bad'])(
      'refuses %s',
      async (url) => {
        const { assertSameOriginScriptUrl } = await loadSecurity();
        expect(() => assertSameOriginScriptUrl(url)).toThrow(TypeError);
      }
    );
  });

  describe('where the browser has Trusted Types', () => {
    let created: Array<{ name: string; rules: Rules }>;
    let html: string[];
    beforeEach(() => {
      ({ created, html } = installTrustedTypes());
    });

    it('creates one policy, under the name the CSP allows, however often it is used', async () => {
      const { trustedScriptUrl, parseInertMarkup, TRUSTED_TYPES_POLICY } = await loadSecurity();
      trustedScriptUrl('/sw.js');
      trustedScriptUrl(new URL('/assets/a.js', window.location.origin));
      parseInertMarkup('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml');
      expect(created.map((policy) => policy.name)).toEqual([TRUSTED_TYPES_POLICY]);
      expect(TRUSTED_TYPES_POLICY).toBe('qrcraftly');
    });

    it('wraps a same-origin URL, string or URL object, in a TrustedScriptURL', async () => {
      const { trustedScriptUrl } = await loadSecurity();
      const absolute = `${window.location.origin}/assets/worker.js`;
      expect(trustedScriptUrl('/sw.js')).toEqual({ trusted: 'script-url', value: '/sw.js' });
      expect(trustedScriptUrl(new URL(absolute))).toEqual({ trusted: 'script-url', value: absolute });
    });

    it('throws for a cross-origin URL', async () => {
      const { trustedScriptUrl } = await loadSecurity();
      expect(() => trustedScriptUrl('https://evil.example/worker.js')).toThrow(/another origin/);
      expect(() => trustedScriptUrl(new URL('https://evil.example/worker.js'))).toThrow(TypeError);
    });

    it('parses markup through the policy into an inert document', async () => {
      const { parseInertMarkup } = await loadSecurity();
      const markup = '<svg xmlns="http://www.w3.org/2000/svg"><rect/><script>alert(1)</script></svg>';
      const doc = parseInertMarkup(markup, 'image/svg+xml');
      expect(html).toEqual([markup]);
      expect(doc.querySelector('rect')).not.toBeNull();
      expect(doc.defaultView).toBeNull();
    });
  });

  describe('sameOriginWorker', () => {
    class RecordingWorker {
      readonly url: unknown;
      readonly options?: WorkerOptions;
      constructor(url: unknown, options?: WorkerOptions) {
        this.url = url;
        this.options = options;
      }
    }

    it('starts the page\'s Worker with the URL wrapped by the policy', async () => {
      installTrustedTypes();
      vi.stubGlobal('Worker', RecordingWorker);
      const { sameOriginWorker } = await loadSecurity();
      const Worker = sameOriginWorker();
      const worker = new Worker(new URL('/assets/worker-matrix.js', window.location.origin), { type: 'module' });
      expect(worker).toBeInstanceOf(RecordingWorker);
      expect(worker).toMatchObject({ url: { trusted: 'script-url', value: `${window.location.origin}/assets/worker-matrix.js` }, options: { type: 'module' } });
    });

    it('refuses a cross-origin worker before the browser fetches it', async () => {
      installTrustedTypes();
      const constructed = vi.fn();
      vi.stubGlobal(
        'Worker',
        class {
          constructor() {
            constructed();
          }
        }
      );
      const { sameOriginWorker } = await loadSecurity();
      const Worker = sameOriginWorker();
      expect(() => new Worker('https://evil.example/worker.js')).toThrow(TypeError);
      expect(constructed).not.toHaveBeenCalled();
    });

    it('follows a Worker stubbed after the first call', async () => {
      const { sameOriginWorker } = await loadSecurity();
      vi.stubGlobal('Worker', RecordingWorker);
      expect(new (sameOriginWorker())('/a.js')).toBeInstanceOf(RecordingWorker);
      class Other extends RecordingWorker {}
      vi.stubGlobal('Worker', Other);
      expect(new (sameOriginWorker())('/a.js')).toBeInstanceOf(Other);
    });
  });

  describe('where the browser has no Trusted Types', () => {
    it('returns the URL unchanged and creates no policy', async () => {
      vi.stubGlobal('trustedTypes', undefined);
      const { trustedScriptUrl, parseInertMarkup } = await loadSecurity();
      const url = new URL('/assets/worker.js', window.location.origin);
      expect(trustedScriptUrl(url)).toBe(url);
      expect(trustedScriptUrl('/sw.js')).toBe('/sw.js');
      expect(parseInertMarkup('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml').documentElement.tagName).toBe('svg');
    });
  });
});
