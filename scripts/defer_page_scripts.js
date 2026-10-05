import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getHtmlFiles } from './csp_hash_injector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_CLIENT_DIR = path.join(__dirname, '../dist/client');

/** Id of the inert template that holds a page's deferred script tags. */
export const DEFERRED_SCRIPTS_ID = 'deferred-scripts';

/**
 * Starts the page's scripts once the pre-rendered HTML has painted (#1058). It copies each tag
 * out of the inert template, in the order Vike wrote them.
 * A hidden tab paints nothing, so it loads at once there. The text is the same on every page,
 * so `csp_hash_injector.js` adds a single hash for it.
 */
export const DEFERRED_SCRIPTS_LOADER =
  '(function(){var d=document;function load(){var t=d.getElementById("' +
  DEFERRED_SCRIPTS_ID +
  '");if(!t)return;t.remove();Array.prototype.forEach.call(t.content.children,function(e){var n;' +
  'if(e.tagName==="SCRIPT"){n=d.createElement("script");n.type="module";n.src=e.getAttribute("src")}' +
  'else{n=d.createElement("link");n.rel="modulepreload";n.href=e.getAttribute("href")}d.head.appendChild(n)})}' +
  'if(d.visibilityState==="hidden"){load()}else{requestAnimationFrame(function(){setTimeout(load,0)})}})();';

/** Vike's startup tags: the entry module and the preloads of its static imports. */
const STARTUP_TAG = /<script src="\/assets\/[^"]+\.js" type="module"[^>]*><\/script>|<link rel="modulepreload" href="\/assets\/[^"]+\.js"[^>]*>/g;

/**
 * Moves a pre-rendered page's startup scripts into an inert `<template>` and adds the loader that
 * starts them after the first paint. Until then the browser fetches only the HTML and the CSS, so
 * the page paints as soon as they arrive instead of waiting on dozens of script downloads. React
 * hydrates the same markup a moment later. The tags keep their `href` and `src` attributes, so
 * `check-bundle-size.js` and the service worker shell still find every startup file.
 * @param {string} html - A built page.
 * @returns {string} The page with deferred scripts; unchanged when it has no entry module or was already rewritten.
 */
export function deferPageScripts(html) {
  if (html.includes(`id="${DEFERRED_SCRIPTS_ID}"`)) return html;
  const tags = html.match(STARTUP_TAG) ?? [];
  if (!tags.some((tag) => tag.startsWith('<script'))) return html;
  const stripped = html.replace(STARTUP_TAG, '');
  const deferred = `<template id="${DEFERRED_SCRIPTS_ID}">${tags.join('')}</template><script>${DEFERRED_SCRIPTS_LOADER}</script>`;
  const bodyEnd = stripped.lastIndexOf('</body>');
  if (bodyEnd === -1) throw new Error('Cannot defer page scripts: the page has no </body>.');
  return stripped.slice(0, bodyEnd) + deferred + stripped.slice(bodyEnd);
}

/**
 * Rewrites every pre-rendered page in dist/client.
 * @param {string} [distDir] - The client build directory.
 * @returns {number} How many pages were rewritten.
 */
export function run(distDir = DIST_CLIENT_DIR) {
  let rewritten = 0;
  for (const file of getHtmlFiles(distDir)) {
    const html = fs.readFileSync(file, 'utf8');
    const deferred = deferPageScripts(html);
    if (deferred !== html) {
      fs.writeFileSync(file, deferred);
      rewritten++;
    }
  }
  console.log(`[Defer Page Scripts] Started the scripts of ${rewritten} pages after first paint.`);
  return rewritten;
}

// Only run automatically if executed directly
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('defer_page_scripts.js'))) {
  run();
}
