/**
 * One-off parity check between our Markdown parser (`scripts/utils/markdown/`) and `marked`,
 * which it replaced (#1191). Not run in CI. `marked` is no longer a dependency, so install it
 * for the run only:
 *
 * ```sh
 * pnpm add -D marked@18.0.9
 * node scripts/fixtures/markdown_parity.js
 * pnpm remove marked
 * ```
 *
 * Gate 1: every public doc (`docs/public/*.md` and `docs/SECURITY.md`, published or not)
 * compiles to byte-identical /security page HTML.
 * Gate 2: every Markdown file the docs audit covers yields the same links (href, text) and
 * code blocks (lang, text).
 * It also reports which files render differently with the default renderers (information only).
 * Exits 1 when a gate fails.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { buildManifest, compileDocHtml, docsPublicDir, securityDocPath, parseFrontmatter } from '../compile_docs_manifest.js';
import { getFilesToAudit } from '../audit_markdown.js';
import { tokenize, walk, render, slugify } from '../utils/markdown/index.js';

const require = createRequire(import.meta.url);
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let marked;
try {
  marked = require('marked');
} catch {
  console.error('marked is not installed. Run: pnpm add -D marked@18.0.9 (and pnpm remove marked afterwards).');
  process.exit(2);
}

/**
 * The /security page compiler as it was with marked (scripts/compile_docs_manifest.js before #1191).
 * @param {{ id: string, content: string }} doc Document.
 * @param {{ id: string, filename: string }[]} manifest Link targets.
 * @returns {string} HTML.
 */
function compileWithMarked(doc, manifest) {
  const contentWithoutH1 = doc.content.replace(/^#\s+.+$/m, '');
  const scoped = new marked.Marked({
    renderer: {
      heading({ text, depth }) {
        const newDepth = Math.min(depth + 1, 6);
        return `<h${newDepth} id="${doc.id}-${slugify(text)}">${text}</h${newDepth}>`;
      }
    },
    walkTokens(token) {
      if (token.type !== 'link') return;
      const href = token.href;
      if (href.startsWith('#')) {
        const fragment = href.slice(1);
        if (fragment) token.href = `#${doc.id}-${slugify(fragment)}`;
        return;
      }
      const [file, hash] = href.split('#');
      const baseName = file.split('/').pop() || file;
      const target = manifest.find(d => d.filename.toLowerCase() === baseName.toLowerCase());
      const suffix = hash ? `-${slugify(hash)}` : '';
      if (target) token.href = `#${target.id}${suffix}`;
    }
  });
  return scoped.parse(contentWithoutH1);
}

/**
 * @param {string} absolutePath Markdown file.
 * @param {string} id Document id.
 * @returns {{ id: string, filename: string, content: string, source: string }} Document.
 */
function loadDoc(absolutePath, id) {
  const { body } = parseFrontmatter(fs.readFileSync(absolutePath, 'utf-8'));
  return { id, filename: path.basename(absolutePath), content: body, source: absolutePath };
}

let failed = false;

// Gate 1a: the published manifest, exactly as the build compiles it.
const published = buildManifest();
const publishedDocs = published.map(entry =>
  loadDoc(entry.id === 'security' ? securityDocPath : path.join(docsPublicDir, entry.filename), entry.id)
);
console.log('Gate 1: /security page HTML');
for (const entry of published) {
  const doc = publishedDocs.find(d => d.id === entry.id);
  const same = entry.html === compileWithMarked(doc, publishedDocs);
  failed ||= !same;
  console.log(`  published ${entry.filename}: ${entry.html.length} bytes, ${same ? 'identical' : 'DIFFERENT'}`);
}

// Gate 1b: every public doc, including developer references the page leaves out.
const allPublic = [
  ...fs
    .readdirSync(docsPublicDir)
    .filter(file => file.endsWith('.md'))
    .sort()
    .map(file => loadDoc(path.join(docsPublicDir, file), path.parse(file).name.toLowerCase())),
  loadDoc(securityDocPath, 'security')
];
for (const doc of allPublic) {
  const ours = compileDocHtml(doc, allPublic);
  const same = ours === compileWithMarked(doc, allPublic);
  failed ||= !same;
  console.log(`  any ${doc.filename}: ${ours.length} bytes, ${same ? 'identical' : 'DIFFERENT'}`);
}

// Gate 2: links and code blocks the docs audit reads.
/**
 * @param {object[]} tokens Tokens.
 * @param {(tokens: object[], fn: (token: object) => void) => void} visit Walker.
 * @returns {{ links: string[][], code: string[][] }} What the audit reads.
 */
function auditView(tokens, visit) {
  const links = [];
  const code = [];
  visit(tokens, token => {
    if (token.type === 'link') links.push([token.href, token.text]);
    if (token.type === 'code') code.push([token.lang || '', token.text]);
  });
  return { links, code };
}

const files = getFilesToAudit();
let gate2Files = 0;
let linkCount = 0;
let codeCount = 0;
const renderDiffs = [];
for (const file of files) {
  const { body } = parseFrontmatter(fs.readFileSync(path.join(repoRoot, file), 'utf-8'));
  const ourTokens = tokenize(body, { file });
  const ours = auditView(ourTokens, walk);
  const theirs = auditView(marked.lexer(body), (tokens, fn) => marked.walkTokens(tokens, fn));
  if (JSON.stringify(ours) === JSON.stringify(theirs)) {
    gate2Files++;
    linkCount += ours.links.length;
    codeCount += ours.code.length;
  } else {
    failed = true;
    console.log(`  DIFFERENT audit tokens in ${file}`);
  }
  if (render(ourTokens) !== marked.parse(body)) renderDiffs.push(file);
}
console.log(`Gate 2: ${gate2Files}/${files.length} files identical (${linkCount} links, ${codeCount} code blocks)`);
console.log(`Default HTML: ${files.length - renderDiffs.length}/${files.length} files identical${renderDiffs.length ? `; differs: ${renderDiffs.join(', ')}` : ''}`);

process.exit(failed ? 1 : 0);
