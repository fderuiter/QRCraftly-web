import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  buildSwContent,
  toPrecacheUrl,
  readRedirectSources,
  isRuntimeCached,
  selectShell,
  readAssetReferences,
  readWorkerReferences,
  computeBuildHash,
} = require('../scripts/generate_sw.cjs') as {
  buildSwContent: (manifest: Array<{ url: string; revision: string }>, hash: string) => string;
  toPrecacheUrl: (relativePath: string) => string;
  readRedirectSources: (redirectsFile: string) => Set<string>;
  isRuntimeCached: (relativePath: string) => boolean;
  selectShell: (files: string[], readText: (relativePath: string) => string) => Set<string>;
  readAssetReferences: (relativePath: string, source: string) => string[];
  readWorkerReferences: (relativePath: string, source: string) => string[];
  computeBuildHash: (manifest: Array<{ url: string; revision: string }>, readRuleFile: (name: string) => string) => string;
};

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  request?: { url: string; method: string; mode?: string };
  data?: unknown;
  respondWith: (p: Promise<unknown>) => void;
  waitUntil: (p: Promise<unknown>) => void;
}

const ORIGIN = 'https://qrcraftly.com';

/** In-memory CacheStorage keyed by cache name, then by pathname. */
function createCacheStorage(initial: Record<string, Record<string, unknown>> = {}) {
  const store = new Map<string, Map<string, unknown>>();
  for (const [name, entries] of Object.entries(initial)) {
    store.set(name, new Map(Object.entries(entries)));
  }
  const keyOf = (req: unknown) => {
    const raw = typeof req === 'string' ? req : (req as { url: string }).url;
    return new URL(raw, ORIGIN).pathname;
  };
  const openCache = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const entries = store.get(name)!;
    return {
      add: async (url: string) => {
        entries.set(keyOf(url), `network:${keyOf(url)}`);
      },
      put: async (req: unknown, res: unknown) => {
        entries.set(keyOf(req), res);
      },
      match: async (req: unknown) => entries.get(keyOf(req)),
    };
  };
  return {
    store,
    api: {
      open: async (name: string) => openCache(name),
      keys: async () => Array.from(store.keys()),
      delete: async (name: string) => store.delete(name),
      match: async (req: unknown) => {
        for (const entries of store.values()) {
          const hit = entries.get(keyOf(req));
          if (hit !== undefined) return hit;
        }
        return undefined;
      },
    },
  };
}

function loadWorker(options: {
  manifest?: Array<{ url: string; revision: string }>;
  hash?: string;
  caches: ReturnType<typeof createCacheStorage>;
  fetchImpl?: (req: unknown) => Promise<unknown>;
  /** Simulates a worker from an earlier build already controlling the site. */
  hasActiveWorker?: boolean;
}) {
  const listeners = new Map<string, Listener>();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(),
    registration: { active: options.hasActiveWorker ? {} : null },
    clients: { claim: vi.fn(async () => undefined) },
  };
  const fetchImpl = options.fetchImpl ?? (async (req: unknown) => `fetched:${(req as { url: string }).url}`);
  const source = buildSwContent(
    options.manifest ?? [
      { url: '/', revision: 'a' },
      { url: '/about', revision: 'b' },
      { url: '/index.pageContext.json', revision: 'c' },
      { url: '/assets/app-123.js', revision: 'd' },
    ],
    options.hash ?? 'new'
  );
  const run = new Function('self', 'caches', 'fetch', 'Response', source);
  run(self, options.caches.api, fetchImpl, Response);

  const dispatch = async (type: string, init: Partial<FakeEvent> = {}) => {
    let responded: Promise<unknown> | undefined;
    let waited: Promise<unknown> | undefined;
    listeners.get(type)!({
      ...init,
      respondWith: (p) => {
        responded = p;
      },
      waitUntil: (p) => {
        waited = p;
      },
    } as FakeEvent);
    if (waited) await waited;
    return responded;
  };
  const fetchEvent = (path: string, mode = 'no-cors', method = 'GET') =>
    dispatch('fetch', { request: { url: ORIGIN + path, method, mode } });

  return { self, dispatch, fetchEvent };
}

describe('generated service worker runtime', () => {
  let caches: ReturnType<typeof createCacheStorage>;

  beforeEach(() => {
    caches = createCacheStorage();
  });

  it('does not skip waiting on install, so open tabs keep their worker', async () => {
    const sw = loadWorker({ caches });
    await sw.dispatch('install');
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    expect(caches.store.get('qrcraftly-precache-new')?.has('/about')).toBe(true);
  });

  it('takes over at once from a worker that predates canonical page URLs (#1086)', async () => {
    const sw = loadWorker({ caches, hasActiveWorker: true });
    await sw.dispatch('install');
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('takes over at once from a worker that serves pages cache-first from any build (#1259)', async () => {
    const meta = await caches.api.open('qrcraftly-meta');
    await meta.put('/__qrcraftly_sw_schema__', new Response(JSON.stringify(2)));
    const sw = loadWorker({ caches, hasActiveWorker: true });
    await sw.dispatch('install');
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('waits as usual when the active worker already uses canonical page URLs', async () => {
    const first = loadWorker({ caches });
    await first.dispatch('install');
    await first.dispatch('activate');
    const next = loadWorker({ caches, hash: 'next', hasActiveWorker: true });
    await next.dispatch('install');
    expect(next.self.skipWaiting).not.toHaveBeenCalled();
  });

  it('activates the waiting worker only when the page asks for it', async () => {
    const sw = loadWorker({ caches });
    await sw.dispatch('message', { data: { type: 'OTHER' } });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    await sw.dispatch('message', { data: { type: 'SKIP_WAITING' } });
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('keeps the current and the previous precache on activate and deletes older ones', async () => {
    caches = createCacheStorage({
      'qrcraftly-precache-old1': { '/assets/app-1.js': 'v1' },
      'qrcraftly-precache-old2': { '/assets/app-2.js': 'v2' },
      'unrelated-cache': { '/x': 'x' },
    });
    // History from two earlier activations.
    const meta = await caches.api.open('qrcraftly-meta');
    await meta.put(
      '/__qrcraftly_cache_history__',
      new Response(JSON.stringify(['qrcraftly-precache-old1', 'qrcraftly-precache-old2']))
    );
    const sw = loadWorker({ caches });
    await sw.dispatch('install');
    await sw.dispatch('activate');

    const names = await caches.api.keys();
    expect(names).toContain('qrcraftly-precache-new');
    expect(names).toContain('qrcraftly-precache-old2');
    expect(names).not.toContain('qrcraftly-precache-old1');
    expect(names).toContain('unrelated-cache');

    // A tab still on the previous build can load its hashed chunk.
    expect(await sw.fetchEvent('/assets/app-2.js')).toBe('v2');
  });

  it('never answers API calls', async () => {
    const sw = loadWorker({ caches });
    await sw.dispatch('install');
    expect(await sw.fetchEvent('/api/anything', 'cors', 'POST')).toBeUndefined();
    expect(await sw.fetchEvent('/api/anything', 'navigate')).toBeUndefined();
  });

  it('asks the network first for every page and serves precached pages offline (#1259)', async () => {
    let online = true;
    const fetchImpl = vi.fn(async (req: unknown) => {
      if (!online) throw new TypeError('Failed to fetch');
      return `fetched:${(req as { url: string }).url}`;
    });
    const sw = loadWorker({ caches, fetchImpl });
    await sw.dispatch('install');
    expect(await sw.fetchEvent('/', 'navigate')).toBe(`fetched:${ORIGIN}/`);
    expect(await sw.fetchEvent('/about', 'navigate')).toBe(`fetched:${ORIGIN}/about`);

    online = false;
    expect(await sw.fetchEvent('/about', 'navigate')).toBe('network:/about');
    expect(await sw.fetchEvent('/about/', 'navigate')).toBe('network:/about');
    expect(await sw.fetchEvent('/about/index.html', 'navigate')).toBe('network:/about');
    expect(await sw.fetchEvent('/', 'navigate')).toBe('network:/');
    expect(await sw.fetchEvent('/index.html', 'navigate')).toBe('network:/');
  });

  it("answers from this build's cache even when the previous build's cache was created first (#1259)", async () => {
    caches = createCacheStorage({
      'qrcraftly-precache-old': {
        '/': 'old:/',
        '/index.pageContext.json': 'old:data',
        '/manifest.json': 'old:manifest',
        '/assets/old-chunk.js': 'old:chunk',
      },
    });
    const meta = await caches.api.open('qrcraftly-meta');
    await meta.put('/__qrcraftly_cache_history__', new Response(JSON.stringify(['qrcraftly-precache-old'])));
    const sw = loadWorker({
      caches,
      manifest: [
        { url: '/', revision: 'a' },
        { url: '/index.pageContext.json', revision: 'b' },
        { url: '/manifest.json', revision: 'c' },
      ],
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await sw.dispatch('install');
    await sw.dispatch('activate');

    expect(await sw.fetchEvent('/', 'navigate')).toBe('network:/');
    expect(await sw.fetchEvent('/index.pageContext.json')).toBe('network:/index.pageContext.json');
    expect(await sw.fetchEvent('/manifest.json')).toBe('network:/manifest.json');
    // A tab still running the previous build can load its hashed chunk.
    expect(await sw.fetchEvent('/assets/old-chunk.js')).toBe('old:chunk');
  });

  it("never serves a page or the manifest from another build's cache (#1259)", async () => {
    caches = createCacheStorage({
      'qrcraftly-precache-old': { '/manifest.json': 'old:manifest', '/arcade': 'old:arcade' },
    });
    let online = true;
    const sw = loadWorker({
      caches,
      manifest: [{ url: '/', revision: 'a' }],
      fetchImpl: async (req: unknown) => {
        if (!online) throw new TypeError('Failed to fetch');
        return `fetched:${(req as { url: string }).url}`;
      },
    });
    await sw.dispatch('install');
    expect(await sw.fetchEvent('/manifest.json')).toBe(`fetched:${ORIGIN}/manifest.json`);
    online = false;
    // Offline, an unseen page gets this build's shell, not the old build's copy.
    expect(await sw.fetchEvent('/arcade', 'navigate')).toBe('network:/');
  });

  it('never answers a navigation with a redirected response (#1086)', async () => {
    caches = createCacheStorage({
      'qrcraftly-precache-old': { '/about': { redirected: true } },
    });
    const sw = loadWorker({ caches });
    expect(await sw.fetchEvent('/about', 'navigate')).toBe(`fetched:${ORIGIN}/about`);
  });

  it('sends unknown navigations to the network instead of serving the homepage', async () => {
    const sw = loadWorker({ caches });
    await sw.dispatch('install');
    expect(await sw.fetchEvent('/does-not-exist', 'navigate')).toBe(`fetched:${ORIGIN}/does-not-exist`);
  });

  it('falls back to the cached shell for unknown navigations only when offline', async () => {
    const sw = loadWorker({
      caches,
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await sw.dispatch('install');
    expect(await sw.fetchEvent('/does-not-exist', 'navigate')).toBe('network:/');
  });

  it('never substitutes another route for a missing pageContext.json', async () => {
    const sw = loadWorker({ caches });
    await sw.dispatch('install');
    expect(await sw.fetchEvent('/unknown/index.pageContext.json')).toBe(
      `fetched:${ORIGIN}/unknown/index.pageContext.json`
    );
  });

  it('asks the network for navigation data it already holds, so it is never stale (#1260)', async () => {
    let body = 'first';
    const fetchImpl = vi.fn(async () => {
      const current = body;
      return { ok: true, body: current, clone: () => `kept:${current}` };
    });
    const sw = loadWorker({ caches, fetchImpl });
    await sw.dispatch('install');
    await sw.fetchEvent('/arcade/index.pageContext.json');
    body = 'second';
    expect(await sw.fetchEvent('/arcade/index.pageContext.json')).toMatchObject({ body: 'second' });
    expect(await sw.fetchEvent('/index.pageContext.json')).toMatchObject({ body: 'second' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('caches a wasm module on first use and serves it from the cache afterwards (ADR 0033)', async () => {
    const response = { ok: true, body: 'wasm', clone: () => 'cached-wasm' };
    const fetchImpl = vi.fn(async () => response);
    const sw = loadWorker({ caches, fetchImpl, hash: 'new' });
    await sw.dispatch('install');

    expect(await sw.fetchEvent('/assets/qr-decode.abc.wasm')).toBe(response);
    expect(await sw.fetchEvent('/assets/qr-decode.abc.wasm')).toBe('cached-wasm');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed wasm response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, clone: () => 'broken' }));
    const sw = loadWorker({ caches, fetchImpl });
    await sw.fetchEvent('/assets/qr-decode.abc.wasm');
    await sw.fetchEvent('/assets/qr-decode.abc.wasm');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps a hashed chunk the first time it loads and serves it from the cache afterwards (#1058)', async () => {
    const response = { ok: true, clone: () => 'cached-chunk' };
    const fetchImpl = vi.fn(async () => response);
    const sw = loadWorker({ caches, fetchImpl });
    await sw.dispatch('install');

    expect(await sw.fetchEvent('/assets/chunks/lazy-9.js')).toBe(response);
    expect(await sw.fetchEvent('/assets/chunks/lazy-9.js')).toBe('cached-chunk');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps a page that was not precached for offline use, and asks the network first', async () => {
    const fresh = { ok: true, redirected: false, clone: () => 'kept-page' };
    let online = true;
    const fetchImpl = vi.fn(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return fresh;
    });
    const sw = loadWorker({ caches, fetchImpl });
    await sw.dispatch('install');

    expect(await sw.fetchEvent('/arcade', 'navigate')).toBe(fresh);
    online = false;
    expect(await sw.fetchEvent('/arcade', 'navigate')).toBe('kept-page');
    // A page never seen falls back to the shell.
    expect(await sw.fetchEvent('/wifi-qr-code', 'navigate')).toBe('network:/');
  });

  it('never keeps a redirect or an error page', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, redirected: true, clone: () => 'redirect' }));
    const sw = loadWorker({ caches, fetchImpl });
    await sw.dispatch('install');
    await sw.fetchEvent('/old-page', 'navigate');
    expect(caches.store.get('qrcraftly-precache-new')?.has('/old-page')).toBe(false);
  });

  it('keeps navigation data of a visited page and falls back to it offline', async () => {
    const fresh = { ok: true, clone: () => 'kept-data' };
    let online = true;
    const fetchImpl = vi.fn(async () => {
      if (!online) throw new TypeError('Failed to fetch');
      return fresh;
    });
    const sw = loadWorker({ caches, fetchImpl });
    await sw.dispatch('install');
    await sw.fetchEvent('/arcade/index.pageContext.json');
    online = false;
    expect(await sw.fetchEvent('/arcade/index.pageContext.json')).toBe('kept-data');
  });

  it('ignores cross-origin and non-GET requests', async () => {
    const sw = loadWorker({ caches });
    expect(await sw.dispatch('fetch', { request: { url: 'https://example.com/a.js', method: 'GET' } })).toBeUndefined();
    expect(await sw.fetchEvent('/about', 'navigate', 'POST')).toBeUndefined();
  });
});

describe('service worker precache manifest', () => {
  it('precaches pages under the URL the host serves with a 200', () => {
    expect(toPrecacheUrl('index.html')).toBe('/');
    expect(toPrecacheUrl('arcade/index.html')).toBe('/arcade');
    expect(toPrecacheUrl('file-transfer/receive/index.html')).toBe('/file-transfer/receive');
    expect(toPrecacheUrl('404.html')).toBe('/404');
    expect(toPrecacheUrl('arcade/index.pageContext.json')).toBe('/arcade/index.pageContext.json');
    expect(toPrecacheUrl('assets/chunks/a.js')).toBe('/assets/chunks/a.js');
  });

  it('caches wasm modules outside the shell on first use', () => {
    expect(isRuntimeCached('assets/qr-decode.abc.wasm')).toBe(true);
    expect(isRuntimeCached('assets/chunks/a.js')).toBe(false);
  });

  it('reads the assets a page and a module load at startup, not the ones imported later', () => {
    expect(
      readAssetReferences(
        'index.html',
        '<link rel="modulepreload" href="/assets/chunks/a.js"><script src="/assets/entries/e.js"></script><link rel="stylesheet" href="/assets/static/s.css">'
      )
    ).toEqual(['assets/chunks/a.js', 'assets/entries/e.js', 'assets/static/s.css']);
    expect(
      readAssetReferences(
        'assets/entries/e.js',
        'import{x}from"../chunks/b.js";import"./c.js";const l=()=>import("../chunks/lazy.js");export{x}'
      )
    ).toEqual(['assets/chunks/b.js', 'assets/entries/c.js']);
  });

  it('reads the workers and wasm modules a module starts, but not from HTML or other code', () => {
    expect(
      readWorkerReferences(
        'assets/chunks/a.js',
        'new Worker(new URL("/assets/worker-matrix-x.js",import.meta.url),{type:"module"});' +
          'fetch(new URL( "/assets/static/qr-encode.y.wasm" , import.meta.url));new URL("../../../wasm/qr-encode.wasm",import.meta.url)'
      )
    ).toEqual(['assets/worker-matrix-x.js', 'assets/static/qr-encode.y.wasm']);
    expect(readWorkerReferences('index.html', 'new URL("/assets/w.js",import.meta.url)')).toEqual([]);
  });

  it('precaches the workers and wasm the homepage generator starts, so it draws offline after one visit (#1262)', () => {
    const files: Record<string, string> = {
      'index.html': '<script src="/assets/entries/e.js"></script>',
      'assets/entries/e.js': 'import"../chunks/m.js";',
      'assets/chunks/m.js':
        'new Worker(new URL("/assets/worker-matrix-1.js",import.meta.url));new URL("/assets/static/qr-encode.1.wasm",import.meta.url)',
      'assets/worker-matrix-1.js': 'const w=new URL("/assets/qr-encode-1.wasm",self.location.href);',
      'assets/qr-encode-1.wasm': '\0asm',
      'assets/static/qr-encode.1.wasm': '\0asm',
      'assets/chunks/lazy.js': 'new Worker(new URL("/assets/worker-slice-1.js",import.meta.url))',
      'assets/worker-slice-1.js': '',
      'assets/modem-1.wasm': '\0asm',
    };
    const read = vi.fn((file: string) => files[file]);
    const shell = selectShell(Object.keys(files), read);
    expect([...shell].sort()).toEqual(
      [
        'assets/chunks/m.js',
        'assets/entries/e.js',
        'assets/qr-encode-1.wasm',
        'assets/static/qr-encode.1.wasm',
        'assets/worker-matrix-1.js',
        'index.html',
      ].sort()
    );
    // WebAssembly is binary: it is precached but never parsed for references.
    expect(read).not.toHaveBeenCalledWith('assets/qr-encode-1.wasm');
  });

  it('ships a new worker when only the host headers or redirects change (#1261)', () => {
    const manifest = [{ url: '/', revision: 'aaaaaaaa' }];
    const rules = (headers: string, redirects = '') => (name: string) => (name === '_headers' ? headers : redirects);
    const base = computeBuildHash(manifest, rules('/*\n  Permissions-Policy: camera=(self)\n'));
    expect(base).toMatch(/^[0-9a-f]{12}$/);
    expect(computeBuildHash(manifest, rules('/*\r\n  Permissions-Policy: camera=(self)\r\n'))).toBe(base);
    expect(computeBuildHash(manifest, rules('/*\n  Permissions-Policy: camera=()\n'))).not.toBe(base);
    expect(computeBuildHash(manifest, rules('/*\n  Permissions-Policy: camera=(self)\n', '/old /new 301'))).not.toBe(base);
    expect(computeBuildHash([{ url: '/', revision: 'bbbbbbbb' }], rules('/*\n  Permissions-Policy: camera=(self)\n'))).not.toBe(base);
  });

  it('generates the worker after every postbuild step that rewrites HTML or headers (#1261)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    const steps = pkg.scripts.postbuild.split('&&').map((step) => step.trim());
    const position = (script: string) => steps.findIndex((step) => step.includes(script));
    const sw = position('generate_sw.cjs');
    expect(sw).toBeGreaterThan(-1);
    for (const rewriter of ['defer_page_scripts.js', 'csp_hash_injector.js', 'generate_social_images.ts', 'generate_sitemap.ts', 'write_build_info.js']) {
      expect(position(rewriter)).toBeGreaterThan(-1);
      expect(position(rewriter)).toBeLessThan(sw);
    }
  });

  it('precaches the homepage shell only, leaving other pages, lazy chunks and workers to the runtime cache (#1058)', () => {
    const files: Record<string, string> = {
      'index.html': '<script src="/assets/entries/e.js"></script><link href="/assets/static/s.css">',
      'assets/entries/e.js': 'import"../chunks/a.js";',
      'assets/chunks/a.js': 'const l=()=>import("./lazy.js");',
      'assets/chunks/lazy.js': '',
      'assets/static/s.css': '',
      'assets/worker-1.js': '',
      'assets/entries/src_pages_dev-sandbox.js': 'import"../chunks/a.js";',
      'arcade/index.html': '<script src="/assets/entries/arcade.js"></script>',
      'assets/entries/arcade.js': '',
      'index.pageContext.json': '{}',
      'manifest.json': '{}',
    };
    const shell = selectShell(Object.keys(files), (file) => files[file]);
    expect([...shell].sort()).toEqual(
      ['assets/chunks/a.js', 'assets/entries/e.js', 'assets/static/s.css', 'index.html', 'index.pageContext.json', 'manifest.json'].sort()
    );
  });

  it('reads redirect sources so retired routes are not precached as redirects', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-redirects-'));
    const file = path.join(dir, '_redirects');
    fs.writeFileSync(file, '# comment\r\n/game /arcade?mode=simulator 301\r\n/game/ /arcade?mode=simulator 301\n\n');
    try {
      expect(Array.from(readRedirectSources(file))).toEqual(['/game']);
      expect(readRedirectSources(path.join(dir, 'missing')).size).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
