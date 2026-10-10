// Design token guardrail (#1045). Fails when:
//  1. a file in src/ uses a raw palette colour (`bg-slate-800`, `text-teal-700`,
//     `border-white` ...) instead of a semantic token from src/layouts/index.css
//     (`bg-surface`, `text-accent`, `border-line` ...), unless it is on the legacy list
//     below (#1366);
//  2. any file in src/ uses an arbitrary colour or size value (`text-[11px]`,
//     `bg-[#0a0f1d]`, `border-[3px]`) instead of a scale step or token.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.join(path.dirname(__filename), '..');

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
const COLOR_UTILITIES =
  'bg|text|border|border-[trblxy]|ring|ring-offset|outline|divide|from|via|to|fill|stroke|shadow|accent|caret|decoration|placeholder';

const RAW_PALETTE_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOR_UTILITIES})-(?:(?:${PALETTE})-\\d{2,3}|white|black)(?:/\\d+)?(?![\\w-])`,
  'g'
);
const ARBITRARY_VALUE_CLASS = new RegExp(
  `(?<![\\w-])(?:${COLOR_UTILITIES}|leading|tracking)-\\[(?:#|rgba?\\(|hsla?\\(|oklch\\(|\\d)[^\\]]*\\]`,
  'g'
);

/**
 * Files that still use raw palette colours (#1366). The list only shrinks: move a file to
 * tokens, then take it off. New files never join it.
 */
export const LEGACY_PALETTE_FILES = new Set([
  'src/components/QRCanvas.tsx',
  // Draws over the live camera picture, which is never themed.
  'src/components/QRScanner.tsx',
  'src/components/ToolWorkspaceLayout.tsx',
  'src/components/TransferModeSwitcher.tsx',
  'src/pages/file-transfer/receive/+Page.tsx',
  'src/pages/free-forever/+Page.tsx',
]);

/**
 * Lists source files below a directory, as POSIX paths relative to the repo root.
 * @param {string} dir Directory relative to the repo root.
 * @returns {string[]} Relative file paths (tests excluded).
 */
function listSourceFiles(dir) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(child);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Removes comments so documentation examples are not reported.
 * @param {string} source File contents.
 * @returns {string} Source with block and line comments blanked out (line numbers kept).
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\r\n]/g, ' '))
    .replace(/(^|[^:"'`])\/\/[^\r\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

/**
 * Finds every match of a pattern with its 1-based line number.
 * @param {string} source File contents.
 * @param {RegExp} pattern Global pattern.
 * @returns {{ line: number, value: string }[]} Matches.
 */
function findAll(source, pattern) {
  const lines = stripComments(source).split(/\r?\n/);
  const hits = [];
  lines.forEach((text, i) => {
    for (const m of text.matchAll(pattern)) hits.push({ line: i + 1, value: m[0] });
  });
  return hits;
}

/**
 * Audits files for raw palette colours (UI primitives only) and arbitrary values (everywhere).
 * @param {{ file: string, source: string }[]} files Files to audit, with repo-relative POSIX paths.
 * @returns {string[]} Error messages.
 */
export function auditDesignTokens(files) {
  const errors = [];
  for (const { file, source } of files) {
    if (file.startsWith('src/') && !LEGACY_PALETTE_FILES.has(file)) {
      for (const hit of findAll(source, RAW_PALETTE_CLASS)) {
        errors.push(
          `${file}:${hit.line} uses raw palette colour "${hit.value}". Fix: use a semantic token from src/layouts/index.css (for example bg-surface, text-fg-muted, border-line, bg-action, text-danger).`
        );
      }
    }
    for (const hit of findAll(source, ARBITRARY_VALUE_CLASS)) {
      errors.push(
        `${file}:${hit.line} uses arbitrary value "${hit.value}". Fix: use a scale step (text-xs is the 12px floor) or add a token to the @theme block in src/layouts/index.css.`
      );
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const files = listSourceFiles('src').map((file) => ({
    file,
    source: fs.readFileSync(path.join(repoRoot, file), 'utf8'),
  }));
  const errors = auditDesignTokens(files);
  if (errors.length > 0) {
    console.error(`❌ Design token audit failed (${errors.length}):`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`✅ Design token audit passed (${files.length} files).`);
}
