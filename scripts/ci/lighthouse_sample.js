/**
 * Narrows the generated Lighthouse config (dist/lighthouserc.json) to a sample of
 * pages for pull requests (ADR 0049). The sample holds one page of each template,
 * so a regression in shared layout, styles or scripts still shows up; the nightly
 * run on main audits every page.
 *
 * Fails when a sampled route is no longer pre-rendered, so the list never shrinks
 * silently. Usage: node scripts/ci/lighthouse_sample.js [config path]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAMPLE_ROUTES = [
  '/',
  '/wifi-qr-code',
  '/guides',
  '/guides/static-vs-dynamic-qr-codes',
  '/qr-code-scanner',
  '/file-transfer',
  '/security',
  '/arcade',
];

/**
 * Keeps only the sampled URLs.
 * @param {string[]} urls Every audited URL, such as `http://localhost/guides`.
 * @param {string[]} [routes]
 * @returns {{ kept: string[], missing: string[] }}
 */
export function sampleUrls(urls, routes = SAMPLE_ROUTES) {
  const byRoute = new Map(urls.map(url => [new URL(url).pathname.replace(/(.)\/$/, '$1'), url]));
  const kept = [];
  const missing = [];
  for (const route of routes) {
    const url = byRoute.get(route);
    if (url) kept.push(url);
    else missing.push(route);
  }
  return { kept, missing };
}

function main() {
  const configPath = path.resolve(process.argv[2] || 'dist/lighthouserc.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const urls = config?.ci?.collect?.url;
  if (!Array.isArray(urls)) {
    console.error(`::error::${configPath} has no ci.collect.url list.`);
    process.exit(1);
  }

  const { kept, missing } = sampleUrls(urls);
  if (missing.length > 0) {
    console.error(`::error::These sampled routes are not pre-rendered any more: ${missing.join(', ')}. Update SAMPLE_ROUTES in scripts/ci/lighthouse_sample.js.`);
    process.exit(1);
  }

  config.ci.collect.url = kept;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  console.log(`Lighthouse sample: ${kept.length} of ${urls.length} pages.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main();
}
