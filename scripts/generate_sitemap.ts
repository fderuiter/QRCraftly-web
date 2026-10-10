import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let env: Record<string, string> = {};
try {
  const mode = process.env.NODE_ENV || 'production';
  env = loadEnv(mode, process.cwd(), '');
} catch (error) {
  console.warn('[Sitemap] Failed to load env via Vite loadEnv:', error);
}

// Dynamically set process.env.VITE_DOMAIN so it is visible globally to all imported modules
const resolvedDomain = env.VITE_DOMAIN || process.env.VITE_DOMAIN || 'https://qrcraftly.com';
process.env.VITE_DOMAIN = resolvedDomain;

// Now import the shared business logic dynamically
const { resolvePublicUrl, getSanitizedPath } = await import('../src/utils/metadataEngine');
const { contentRegistry, auxiliaryRegistry, getLegacyRedirect } = await import('../src/data/contentRegistry');

const { getGuide } = await import('../src/data/guides');
const { execBinary } = await import('./utils/execHelper.js');

const REPO_ROOT = path.resolve(__dirname, '..');
// Tests point both at temp folders so they never touch a real build (SITEMAP_DIST_DIR, SITEMAP_OUTPUT_PATH).
const DIST_DIR = process.env.SITEMAP_DIST_DIR ? path.resolve(process.env.SITEMAP_DIST_DIR) : path.resolve(__dirname, '../dist/client');


function findHtmlFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      findHtmlFiles(filePath, fileList);
    } else if (filePath.endsWith('.html')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

/**
 * Determines whether a given relative or absolute path/route should be excluded from the sitemap.
 * @param posixPath - The clean posix path of the file or route.
 * @returns True if the path should be excluded, false otherwise.
 */
export function shouldExcludePath(posixPath: string): boolean {
  const clean = posixPath.toLowerCase();
  // Retired routes (such as /game) only redirect to their replacement.
  if (getLegacyRedirect(clean.replace(/(\/index)?\.html$/, ''))) {
    return true;
  }
  if (
    clean.includes('404.html') ||
    clean.endsWith('404') ||
    clean.includes('_error') ||
    clean.includes('draft') ||
    clean.includes('test') ||
    clean.includes('dev-sandbox') ||
    clean.includes('quarantine') ||
    clean.includes('internal') ||
    clean.includes('@id')
  ) {
    return true;
  }
  return false;
}

/**
 * Collects candidate routes from central application registries (contentRegistry and auxiliaryRegistry).
 */
export function getRegistryRoutes(): string[] {
  const candidateRoutes: string[] = [];

  if (contentRegistry && typeof contentRegistry === 'object') {
    for (const [key, item] of Object.entries(contentRegistry)) {
      if (!item) continue;
      let route = '';
      if (item.url) {
        try {
          const parsed = new URL(item.url);
          route = parsed.pathname;
        } catch {
          route = item.url;
        }
      } else if (item.id) {
        route = item.id === 'index' ? '/' : `/${item.id}`;
      } else if (key) {
        route = key === 'index' ? '/' : `/${key}`;
      }

      if (route) candidateRoutes.push(route);
    }
  }

  if (auxiliaryRegistry && typeof auxiliaryRegistry === 'object') {
    for (const [key, item] of Object.entries(auxiliaryRegistry)) {
      if (!item) continue;
      let route = '';
      const url = 'url' in item ? item.url : undefined;
      if (typeof url === 'string') {
        try {
          const parsed = new URL(url);
          route = parsed.pathname;
        } catch {
          route = url;
        }
      } else if (item.id) {
        route = item.id === 'index' ? '/' : `/${item.id}`;
      } else if (key) {
        route = key === 'index' ? '/' : `/${key}`;
      }

      if (route) candidateRoutes.push(route);
    }
  }

  return candidateRoutes;
}

/**
 * Collects candidate routes from physical pre-rendered HTML build output.
 */
export function getPreRenderedHtmlRoutes(distDir: string = DIST_DIR): string[] {
  if (!fs.existsSync(distDir)) return [];

  const htmlFiles = findHtmlFiles(distDir);
  const routes: string[] = [];

  for (const file of htmlFiles) {
    const relativePath = path.relative(distDir, file);
    const posixPath = relativePath.split(path.sep).join('/');

    let route = `/${posixPath}`;
    if (route.endsWith('/index.html')) {
      route = route.slice(0, -10);
    } else if (route.endsWith('index.html')) {
      route = route.slice(0, -10);
    } else if (route.endsWith('.html')) {
      route = route.slice(0, -5);
    }

    if (route === '') {
      route = '/';
    }

    routes.push(route);
  }

  return routes;
}

let historyAvailable: boolean | null = null;

/**
 * Whether the checkout is a shallow clone.
 * @returns True when git reports a shallow repository or cannot tell.
 */
function isShallow(): boolean {
  try {
    return execBinary('git', ['rev-parse', '--is-shallow-repository'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== 'false';
  } catch {
    return true;
  }
}

/**
 * Whether the checkout has full git history. Workers Builds checks out a shallow clone, which
 * would stamp every page with the latest commit date, so on a build server the generator first
 * fetches the commit history (commits and trees only, no file contents) from the public
 * repository (#1309). Elsewhere, or if that fails, lastmod is left out rather than guessed.
 * @returns True when per-path commit dates are trustworthy.
 */
function hasFullHistory(): boolean {
  if (historyAvailable === null) {
    historyAvailable = !isShallow();
    if (!historyAvailable && (process.env.WORKERS_CI === '1' || process.env.SITEMAP_UNSHALLOW === '1')) {
      try {
        execBinary('git', ['fetch', '--unshallow', '--filter=blob:none', '--quiet', 'origin'], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
        historyAvailable = !isShallow();
      } catch (error) {
        console.warn(`[Sitemap] Could not fetch git history, so pages other than guides get no lastmod: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return historyAvailable;
}

/**
 * The files whose last commit dates a route's lastmod: its page directory and, where it has
 * one, its copy block in `src/data/copy/`.
 * @param cleanPath - Sanitized route such as `/` or `/wifi-qr-code`.
 * @returns Repository-relative POSIX paths that exist.
 */
export function getPageSourcePaths(cleanPath: string): string[] {
  const id = cleanPath === '/' || cleanPath === '' ? 'index' : cleanPath.slice(1);
  return [`src/pages/${id}`, `src/data/copy/${id}.ts`].filter((source) => fs.existsSync(path.join(REPO_ROOT, source)));
}

/**
 * Returns the last commit date (YYYY-MM-DD) touching the page source for a route.
 * @param cleanPath - Sanitized route such as `/` or `/wifi-qr-code`.
 * @returns The date, or null when it cannot be determined reliably.
 */
export function getLastModified(cleanPath: string): string | null {
  const guideSlug = /^\/guides\/([^/]+)$/.exec(cleanPath)?.[1];
  const guide = guideSlug ? getGuide(guideSlug) : undefined;
  if (guide) return guide.dateModified;
  const sources = getPageSourcePaths(cleanPath);
  if (sources.length === 0 || !hasFullHistory()) return null;
  try {
    const iso = execBinary('git', ['log', '-1', '--format=%cI', '--', ...sources], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
  } catch {
    return null;
  }
}

export function generateSitemap({
  distDir = DIST_DIR,
  outputFile = process.env.SITEMAP_OUTPUT_PATH || path.join(distDir, 'sitemap.xml'),
}: { distDir?: string; outputFile?: string } = {}) {
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    console.warn(`[Sitemap] Directory ${outputDir} does not exist. Creating output directory.`);
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const htmlRoutes = getPreRenderedHtmlRoutes(distDir);
  const registryRoutes = getRegistryRoutes();
  const allCandidates = [...htmlRoutes, ...registryRoutes];

  const uniqueRoutesMap = new Map<string, string>(); // sanitizedPath -> rawRoute

  for (const rawRoute of allCandidates) {
    if (shouldExcludePath(rawRoute)) continue;

    const cleanPath = getSanitizedPath(rawRoute);
    if (shouldExcludePath(cleanPath)) continue;

    if (!uniqueRoutesMap.has(cleanPath)) {
      uniqueRoutesMap.set(cleanPath, rawRoute);
    }
  }

  const sortedCleanPaths = Array.from(uniqueRoutesMap.keys()).sort((a, b) => {
    if (a === '/') return -1;
    if (b === '/') return 1;
    return a.localeCompare(b);
  });

  const urls: string[] = [];

  for (const cleanPath of sortedCleanPaths) {
    const fullUrl = resolvePublicUrl(cleanPath);
    const priority = (cleanPath === '/' || cleanPath === '') ? '1.0' : '0.8';

    const escapedUrl = fullUrl
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    const lastmod = getLastModified(cleanPath);
    const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';

    urls.push(`  <url>
    <loc>${escapedUrl}</loc>${lastmodTag}
    <changefreq>weekly</changefreq>
    <priority>${priority}</priority>
  </url>`);
  }

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  fs.writeFileSync(outputFile, sitemapXml, 'utf8');
  console.log(`[Sitemap] Generated ${outputFile} with ${urls.length} URLs.`);
}

// Only execute if run directly
const isMain = process.argv[1] ? (path.resolve(process.argv[1]) === path.resolve(__filename)) : false;

if (isMain) {
  generateSitemap();
}
