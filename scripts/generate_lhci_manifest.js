import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.resolve(__dirname, '../dist/client');
// The tracked lighthouserc.json is the base config (thresholds, collect settings).
// The generated config with the discovered routes goes to dist/, which is
// gitignored, so a build never modifies tracked files.
const LIGHTHOUSE_RC_FILE = path.resolve(__dirname, '../lighthouserc.json');
const GENERATED_RC_FILE = path.resolve(__dirname, '../dist/lighthouserc.json');

function findHtmlFiles(dir, fileList = []) {
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
 * Builds the Lighthouse CI config for the pre-rendered routes in distDir.
 *
 * @param {string} [distDir] Folder with the pre-rendered client build.
 * @param {string} [baseConfigPath] Tracked base config that is read, never written.
 * @param {string} [outputPath] Where the generated config is written.
 * @returns {string[] | null} The audited URLs, or null when nothing was generated.
 */
export function generateLhciManifest(distDir = DIST_DIR, baseConfigPath = LIGHTHOUSE_RC_FILE, outputPath = GENERATED_RC_FILE) {
  if (!fs.existsSync(distDir)) {
    console.warn(`[LHCI Manifest] Directory ${distDir} does not exist. Skipping LHCI manifest generation.`);
    return null;
  }

  const htmlFiles = findHtmlFiles(distDir);
  
  // Log all pre-rendered HTML routes found (should be 11)
  console.log(`[LHCI Manifest] Found ${htmlFiles.length} pre-rendered HTML routes/files:`);
  htmlFiles.forEach(file => {
    const rel = path.relative(distDir, file);
    console.log(`  - ${rel}`);
  });

  const urls = [];

  for (const file of htmlFiles) {
    const relativePath = path.relative(distDir, file);
    const posixPath = relativePath.split(path.sep).join('/');
    
    // Exclude 404, draft, test, and sandbox pages from the audit list
    if (posixPath.endsWith('404.html')) continue;
    if (posixPath.includes('draft') || posixPath.includes('test') || posixPath.includes('dev-sandbox')) continue;
    // Skip retired routes that only redirect (e.g. /game -> /qr-code-checker); auditing them measures the redirect stub.
    if (/<meta[^>]+http-equiv=["']?refresh/i.test(fs.readFileSync(file, 'utf8'))) continue;

    let route = `/${posixPath}`;
    
    // Clean up index.html from paths
    if (route.endsWith('/index.html')) {
      route = route.slice(0, -10); // remove '/index.html'
    } else if (route.endsWith('index.html')) {
      route = route.slice(0, -10); // just in case it's 'index.html' at root
    } else if (route.endsWith('.html')) {
      route = route.slice(0, -5); // remove '.html'
    }
    
    // Ensure root is just /
    if (route === '' || route === '/') {
      route = '/';
    } else if (route.endsWith('/')) {
      route = route.slice(0, -1);
    }

    // Prefix with http://localhost/ as per convention
    const fullUrl = `http://localhost${route}`;
    urls.push(fullUrl);
  }

  // Read the tracked base config
  if (!fs.existsSync(baseConfigPath)) {
    console.error(`[LHCI Manifest] ${baseConfigPath} not found!`);
    return null;
  }

  const lhciConfig = JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'));

  // Ensure structure
  if (!lhciConfig.ci) lhciConfig.ci = {};
  if (!lhciConfig.ci.collect) lhciConfig.ci.collect = {};
  
  lhciConfig.ci.collect.url = urls;
  lhciConfig.ci.collect.numberOfRuns = 1;
  lhciConfig.ci.collect.settings = {
    chromeFlags: '--no-sandbox --disable-dev-shm-usage',
  };

  // Ensure strict SEO threshold of 0.95
  if (!lhciConfig.ci.assert) lhciConfig.ci.assert = {};
  if (!lhciConfig.ci.assert.assertions) lhciConfig.ci.assert.assertions = {};
  lhciConfig.ci.assert.assertions['categories:seo'] = ['error', { minScore: 0.95 }];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(lhciConfig, null, 2) + '\n', 'utf8');
  console.log(`[LHCI Manifest] Successfully wrote ${urls.length} audit URLs and the SEO threshold to ${outputPath}`);
  return urls;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename)) {
  generateLhciManifest();
}
