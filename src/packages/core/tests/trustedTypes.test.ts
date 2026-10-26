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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://qrcraftly.com';

/** A stand-in for a `TrustedScriptURL` or `TrustedHTML`: the browser's value is opaque too. */
class Trusted {
  readonly kind: string;
  readonly value: string;
  constructor(kind: string, value: string) {
    this.kind = kind;
    this.value = value;
  }
}

interface PolicyRules {
  createScriptURL?: (input: string) => string;
  createHTML?: (input: string) => string;
}

/** Records the policies the module creates, and applies their rules like a browser does. */
function installTrustedTypes() {
  const created: string[] = [];
  vi.stubGlobal('trustedTypes', {
    createPolicy(name: string, rules: PolicyRules) {
      created.push(name);
      return {
        createScriptURL: (input: string) => new Trusted('script-url', rules.createScriptURL!(input)),
        createHTML: (input: string) => new Trusted('html', rules.createHTML!(input)),
      };
    },
  });
  return created;
}

class RecordingWorker {
  readonly url: unknown;
  readonly options: unknown;
  constructor(url: unknown, options: unknown) {
    this.url = url;
    this.options = options;
  }
}

async function load() {
  vi.resetModules();
  return import('../trustedTypes');
}

describe('Trusted Types policies (#1172)', () => {
  beforeEach(() => {
    vi.stubGlobal('location', new URL(`${ORIGIN}/wifi-qr-code`));
    vi.stubGlobal('Worker', RecordingWorker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('assertSameOriginScriptUrl', () => {
    it.each(['/sw.js', '/assets/worker-matrix-abc123.js', `${ORIGIN}/assets/x.js`, 'assets/relative.js'])('accepts the same-origin URL %s', async (url) => {
      const { assertSameOriginScriptUrl } = await load();
      expect(assertSameOriginScriptUrl(url)).toBe(url);
    });

    it.each(['https://evil.example/x.js', '//evil.example/x.js', 'http://qrcraftly.com/sw.js', 'https://qrcraftly.com:8443/sw.js', 'data:text/javascript,alert(1)', 'blob:https://evil.example/1'])(
      'refuses the cross-origin URL %s',
      async (url) => {
        const { assertSameOriginScriptUrl } = await load();
        expect(() => assertSameOriginScriptUrl(url)).toThrow(TypeError);
      }
    );
  });

  describe('with Trusted Types', () => {
    it('starts a module worker with a TrustedScriptURL from the script URL policy', async () => {
      const created = installTrustedTypes();
      const { startModuleWorker, SCRIPT_URL_POLICY } = await load();

      const worker = startModuleWorker('/assets/worker-maze.js');

      expect(worker).toBeInstanceOf(RecordingWorker);
      expect(Reflect.get(worker, 'url')).toEqual(new Trusted('script-url', '/assets/worker-maze.js'));
      expect(Reflect.get(worker, 'options')).toEqual({ type: 'module' });
      expect(created).toEqual([SCRIPT_URL_POLICY]);
    });

    it('creates each policy once, however many workers start', async () => {
      const created = installTrustedTypes();
      const { startModuleWorker } = await load();
      startModuleWorker('/a.js');
      startModuleWorker(new URL(`${ORIGIN}/b.js`));
      expect(created).toHaveLength(1);
    });

    it('refuses a cross-origin worker before the browser sees it', async () => {
      installTrustedTypes();
      const { startModuleWorker } = await load();
      expect(() => startModuleWorker('https://evil.example/worker.js')).toThrow(/another origin/);
    });

    it('registers the service worker with a TrustedScriptURL', async () => {
      installTrustedTypes();
      const { registerServiceWorker } = await load();
      const register = vi.fn().mockResolvedValue('registration');

      await registerServiceWorker({ register }, '/sw.js');

      expect(register).toHaveBeenCalledExactlyOnceWith(new Trusted('script-url', '/sw.js'));
    });

    it('parses markup with TrustedHTML from the inert markup policy, not the script URL policy', async () => {
      const created = installTrustedTypes();
      const parseFromString = vi.fn().mockReturnValue('document');
      vi.stubGlobal(
        'DOMParser',
        class {
          parseFromString = parseFromString;
        }
      );
      const { parseInertDocument, INERT_MARKUP_POLICY } = await load();

      expect(parseInertDocument('<svg/>', 'image/svg+xml')).toBe('document');
      expect(parseFromString).toHaveBeenCalledExactlyOnceWith(new Trusted('html', '<svg/>'), 'image/svg+xml');
      expect(created).toEqual([INERT_MARKUP_POLICY]);
    });
  });

  describe('without Trusted Types', () => {
    it('passes the URL string and still refuses another origin', async () => {
      const { startModuleWorker } = await load();
      expect(Reflect.get(startModuleWorker('/assets/w.js'), 'url')).toBe('/assets/w.js');
      expect(() => startModuleWorker('https://evil.example/w.js')).toThrow(/another origin/);
    });

    it('passes the markup string to DOMParser', async () => {
      const parseFromString = vi.fn().mockReturnValue('document');
      vi.stubGlobal(
        'DOMParser',
        class {
          parseFromString = parseFromString;
        }
      );
      const { parseInertDocument } = await load();
      parseInertDocument('<svg/>', 'image/svg+xml');
      expect(parseFromString).toHaveBeenCalledExactlyOnceWith('<svg/>', 'image/svg+xml');
    });
  });
});
