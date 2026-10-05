const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto'); // eslint-disable-line no-redeclare -- explicit import shadows the Node global on purpose

const DIST_DIR = path.join(__dirname, '../dist/client');
const OUTPUT_FILE = path.join(DIST_DIR, 'sw.js');

function getFilesRecursively(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

function computeHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex').substring(0, 8);
}

// Files cached on first use instead of precached: our WebAssembly modules (ADR 0033), such as
// the scanner's qr-decode reader, are only needed by visitors who use the tool that loads them.
const RUNTIME_CACHED_EXTENSION = '.wasm';

/**
 * Whether a dist/client file is cached on first use rather than precached.
 * @param {string} relativePath POSIX path relative to dist/client.
 * @returns {boolean} True for the lazily loaded WebAssembly modules.
 */
function isRuntimeCached(relativePath) {
  return relativePath.endsWith(RUNTIME_CACHED_EXTENSION);
}

// What a first visit precaches (#1058): the homepage shell and the assets it loads, so the app
// boots offline after one visit. Every other page, chunk and worker is cached the first time it
// is requested, so a visitor on mobile data does not download the whole site in the background.
const SHELL_PAGE = 'index.html';
const SHELL_EXTRAS = [
  'index.pageContext.json',
  'manifest.json',
  'favicon.png',
  'icon-192x192.png',
  'icon-192x192-maskable.png',
  'icon-512x512.png',
  'icon-512x512-maskable.png',
];

/**
 * Reads the hashed assets a built file references: `/assets/...` URLs in HTML, and the static
 * (not dynamic) relative imports of a JavaScript module.
 * @param {string} relativePath POSIX path relative to dist/client.
 * @param {string} source File contents.
 * @returns {string[]} POSIX paths relative to dist/client.
 */
function readAssetReferences(relativePath, source) {
  const found = [];
  if (relativePath.endsWith('.html')) {
    for (const match of source.matchAll(/(?:href|src)="\/(assets\/[^"?#]+\.(?:js|css))"/g)) found.push(match[1]);
  } else if (relativePath.endsWith('.js')) {
    const dir = path.posix.dirname(relativePath);
    for (const match of source.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+\.js)["']/g)) {
      found.push(path.posix.normalize(path.posix.join(dir, match[1])));
    }
  }
  return found;
}

/**
 * Picks the files a first visit precaches: the homepage, everything it loads at startup (found
 * by following static imports), and the install files. Lazily imported chunks, workers, other
 * pages and developer-only routes are left to the runtime cache.
 * @param {string[]} files POSIX paths relative to dist/client that exist in the build.
 * @param {(relativePath: string) => string} readText Reads a built text file.
 * @returns {Set<string>} The shell, as POSIX paths relative to dist/client.
 */
function selectShell(files, readText) {
  const available = new Set(files);
  const shell = new Set();
  const queue = [SHELL_PAGE];
  while (queue.length > 0) {
    const next = queue.pop();
    if (!available.has(next) || shell.has(next)) continue;
    shell.add(next);
    for (const ref of readAssetReferences(next, readText(next))) queue.push(ref);
  }
  for (const extra of SHELL_EXTRAS) if (available.has(extra)) shell.add(extra);
  return shell;
}

// Version 2: pages are precached by canonical URL (fix for #1086).
const SW_SCHEMA_VERSION = 2;

/**
 * Maps a dist/client file to the URL the service worker precaches it under.
 * Cloudflare Static Assets (html_handling "drop-trailing-slash") serves
 * about/index.html at /about and redirects /about/index.html there, so pages
 * are cached under the URL the host answers with a 200, never a redirect.
 * @param {string} relativePath POSIX path relative to dist/client.
 * @returns {string} Precache URL.
 */
function toPrecacheUrl(relativePath) {
  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) return '/' + relativePath.slice(0, -'/index.html'.length);
  if (relativePath.endsWith('.html')) return '/' + relativePath.slice(0, -'.html'.length);
  return '/' + relativePath;
}

/**
 * Reads the source paths of the _redirects rules, without trailing slashes.
 * @param {string} redirectsFile Path to the built _redirects file.
 * @returns {Set<string>} Paths the host redirects.
 */
function readRedirectSources(redirectsFile) {
  if (!fs.existsSync(redirectsFile)) return new Set();
  const sources = fs
    .readFileSync(redirectsFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
    .map((source) => (source.length > 1 ? source.replace(/\/+$/, '') : source));
  return new Set(sources);
}

/**
 * Builds the service worker source for a given precache manifest.
 *
 * Update model: the new worker installs and then waits. It never calls
 * skipWaiting() on its own, so open tabs keep their current worker and
 * their lazily-loaded chunks. The page shows an "update available" toast
 * and posts SKIP_WAITING when the user accepts. On activate, the current
 * and the previous precache are kept, so a tab still running the previous
 * build can load its hashed chunks; older caches are deleted.
 * @param {Array<{url: string, revision: string}>} precacheManifest Files to precache.
 * @param {string} buildHash Unique hash of this build.
 * @returns {string} Service worker JavaScript source.
 */
function buildSwContent(precacheManifest, buildHash) {
  return `/**
 * QRCraftly Service Worker
 * Generated at build time with automated precaching
 */

const CACHE_PREFIX = 'qrcraftly-precache-';
const CACHE_NAME = CACHE_PREFIX + '${buildHash}';
const META_CACHE = 'qrcraftly-meta';
const META_KEY = '/__qrcraftly_cache_history__';
const CACHE_HISTORY_LIMIT = 2;
// Bumped when a worker fix must reach visitors whose current worker can't
// load a page (and so can't show the update prompt). A newer schema takes
// over at once instead of waiting.
const SCHEMA_KEY = '/__qrcraftly_sw_schema__';
const SCHEMA_VERSION = ${SW_SCHEMA_VERSION};
const RUNTIME_CACHED_EXTENSION = ${JSON.stringify(RUNTIME_CACHED_EXTENSION)};
const PRECACHE_ASSETS = ${JSON.stringify(precacheManifest, null, 2)};
const PRECACHED_PATHS = new Set(PRECACHE_ASSETS.map((asset) => asset.url));

// Pages are precached under their canonical URL (/about, not
// /about/index.html), because the host answers the .html path with a redirect
// and a redirected response can't be used for a navigation.
function toPageUrl(pathname) {
  let page = pathname.replace(/\\/index\\.html$/, '/').replace(/\\.html$/, '');
  if (page.length > 1 && page.endsWith('/')) page = page.slice(0, -1);
  return page || '/';
}

async function readCacheHistory() {
  try {
    const meta = await caches.open(META_CACHE);
    const response = await meta.match(META_KEY);
    if (!response) return [];
    const history = await response.json();
    return Array.isArray(history) ? history.filter((name) => typeof name === 'string') : [];
  } catch (err) {
    return [];
  }
}

async function readSchemaVersion() {
  try {
    const meta = await caches.open(META_CACHE);
    const response = await meta.match(SCHEMA_KEY);
    if (!response) return 0;
    const version = await response.json();
    return typeof version === 'number' ? version : 0;
  } catch (err) {
    return 0;
  }
}

async function writeSchemaVersion() {
  const meta = await caches.open(META_CACHE);
  await meta.put(SCHEMA_KEY, new Response(JSON.stringify(SCHEMA_VERSION), { headers: { 'Content-Type': 'application/json' } }));
}

async function writeCacheHistory(history) {
  const meta = await caches.open(META_CACHE);
  await meta.put(META_KEY, new Response(JSON.stringify(history), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        PRECACHE_ASSETS.map((asset) => {
          return cache.add(asset.url).catch((err) => {
            console.warn('Failed to precache asset:', asset.url, err);
          });
        })
      );
      const replacesOlderSchema = Boolean(self.registration && self.registration.active) && (await readSchemaVersion()) < SCHEMA_VERSION;
      if (replacesOlderSchema) self.skipWaiting();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const history = (await readCacheHistory()).filter((name) => name !== CACHE_NAME);
      history.push(CACHE_NAME);
      const keep = new Set(history.slice(-CACHE_HISTORY_LIMIT));
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith(CACHE_PREFIX) && !keep.has(name))
          .map((name) => caches.delete(name))
      );
      await writeCacheHistory(Array.from(keep));
      await writeSchemaVersion();
      await self.clients.claim();
    })()
  );
});

async function matchPrecache(pathname) {
  // caches.match searches every cache, so chunks from the previous build
  // are still served to tabs that loaded it.
  return caches.match(pathname, { ignoreSearch: true, ignoreVary: true });
}

// Stores a good answer under a canonical key. Redirects and errors are never kept.
async function remember(key, response) {
  if (response && response.ok && !response.redirected) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(key, response.clone());
    } catch (err) {
      // A full or unavailable cache must never break the page.
    }
  }
}

async function handleNavigation(request, url) {
  const pageUrl = toPageUrl(url.pathname);
  if (PRECACHED_PATHS.has(pageUrl)) {
    const cached = await matchPrecache(pageUrl);
    // Browsers reject a redirected response for a navigation, so let the
    // network answer (and redirect) instead.
    if (cached && !cached.redirected) return cached;
  }
  try {
    // Other pages are not precached: the network answers (so the server can
    // send the right page or a real 404) and a good answer is kept for offline.
    const response = await fetch(request);
    await remember(pageUrl, response);
    return response;
  } catch (err) {
    // Offline: a page seen before, else the cached shell so the app still boots.
    const seen = await matchPrecache(pageUrl);
    if (seen && !seen.redirected) return seen;
    const shell = await matchPrecache('/');
    if (shell) return shell;
    throw err;
  }
}

async function handleRequest(request, url) {
  const cached = await matchPrecache(url.pathname);
  if (cached) return cached;
  if (url.pathname.startsWith('/assets/')) {
    // Chunks, workers and the scanner's WebAssembly reader are not precached, so they are
    // kept the first time they load. Their file names carry a content hash, so a cached
    // copy is never stale.
    const response = await fetch(request);
    await remember(url.pathname, response);
    return response;
  }
  if (url.pathname.endsWith('.pageContext.json')) {
    // Client-side navigation data: the network first, so it is never stale, and the last
    // good copy when offline. Never a substitute from another route.
    try {
      const response = await fetch(request);
      await remember(url.pathname, response);
      return response;
    } catch (err) {
      const seen = await matchPrecache(url.pathname);
      if (seen) return seen;
      throw err;
    }
  }
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Requests targeting API routes must bypass local service worker fetch interception
  // and pass directly to the network across all HTTP methods.
  if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
    return;
  }

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request, url));
    return;
  }

  event.respondWith(handleRequest(request, url));
});
`;
}

function generateSW() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('dist/client directory does not exist. Run build first.');
    process.exit(1);
  }

  const allFiles = getFilesRecursively(DIST_DIR);
  const redirectedPaths = readRedirectSources(path.join(DIST_DIR, '_redirects'));
  const precacheManifest = [];
  const relativeFiles = allFiles.map((file) => path.relative(DIST_DIR, file).replace(/\\/g, '/'));
  const shell = selectShell(relativeFiles, (relativePath) => fs.readFileSync(path.join(DIST_DIR, relativePath), 'utf8'));

  allFiles.forEach(file => {
    const relativePath = path.relative(DIST_DIR, file).replace(/\\/g, '/');
    if (!shell.has(relativePath) || isRuntimeCached(relativePath)) return;

    const hash = computeHash(file);
    // Standardize URL to start with a forward slash
    const url = toPrecacheUrl(relativePath);
    // A page the host redirects (a retired route) would be cached as a redirect.
    if (redirectedPaths.has(url)) return;
    precacheManifest.push({
      url,
      revision: hash
    });
  });

  // Calculate a unique build hash from the files
  const manifestString = JSON.stringify(precacheManifest);
  const buildHash = crypto.createHash('sha256').update(manifestString).digest('hex').substring(0, 12);

  const swContent = buildSwContent(precacheManifest, buildHash);
  fs.writeFileSync(OUTPUT_FILE, swContent, 'utf8');
  console.log('✅ Compiled vanilla service worker written to ' + OUTPUT_FILE + ' with ' + precacheManifest.length + ' assets mapped (Build Hash: ' + buildHash + ').');
}

if (require.main === module) {
  generateSW();
}

module.exports = { buildSwContent, toPrecacheUrl, readRedirectSources, isRuntimeCached, selectShell, readAssetReferences };
