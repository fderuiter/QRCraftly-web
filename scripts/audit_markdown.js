import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { parseFrontmatter, isQuarantined } from './compile_docs_manifest.js';

import { tokenize, walk, slugify, MarkdownSyntaxError } from './utils/markdown/index.js';

const require = createRequire(import.meta.url);
// typescript ships as CJS; use createRequire so pnpm hoisting works.
const ts = require('typescript');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

export const parsedFilesCache = new Map();

export function getParsedFile(file) {
  if (isQuarantined(file)) {
    return { content: '', frontmatter: {}, body: '' };
  }
  const filePath = path.isAbsolute(file) ? file : path.join(repoRoot, file);
  const normalizedPath = path.resolve(filePath);
  if (parsedFilesCache.has(normalizedPath)) {
    return parsedFilesCache.get(normalizedPath);
  }
  let content = '';
  try {
    if (fs.existsSync(normalizedPath)) {
      content = fs.readFileSync(normalizedPath, 'utf-8');
    }
  } catch (err) {
    console.warn(`Warning: Could not read file at ${normalizedPath}`, err);
  }
  const { frontmatter, body } = parseFrontmatter(content);
  const result = { content, frontmatter, body };
  parsedFilesCache.set(normalizedPath, result);
  return result;
}

export const docsPublicDir = path.join(repoRoot, 'docs', 'public');
export const GUIDES_FILE = 'src/data/guides.ts';

const PRIVATE_REPO_URL_REGEX = /github\.com\/fderuiter\/QRCraftly-web/i;
const DANGEROUS_SCHEME_REGEX = /^(?:javascript|data|vbscript|file):/i;

/**
 * Directories whose Markdown files are audited in full (non-recursive).
 * Paths are repository-relative POSIX paths.
 */
export const AUDITED_DOC_DIRS = ['docs', 'docs/public', 'docs/adr', 'docs/agents', 'docs/optical-transfer'];

/**
 * Individual Markdown files audited outside the directories above.
 */
export const AUDITED_DOC_FILES = [
  'README.md',
  'CONTEXT.md',
  'AGENTS.md',
  'src/components/inputs/README.md',
  'src/packages/README.md',
  '.github/rulesets/README.md'
];

/**
 * Files (and directories, by prefix) whose inline code spans are checked as repository paths.
 * Limited to the agent and domain docs so that examples elsewhere do not produce noise.
 */
export const INLINE_PATH_SCOPE = {
  files: ['AGENTS.md', 'CONTEXT.md'],
  dirs: ['docs/agents/']
};

/** File extensions that mark an inline code span as a repository path. */
export const INLINE_PATH_EXTENSIONS = ['.ts', '.tsx', '.js', '.cjs', '.mjs', '.md', '.json', '.yml', '.yaml', '.toml', '.rs', '.sh', '.css', '.html'];

/**
 * Remediation hints printed with every audit error, keyed by error kind.
 */
export const REMEDIATION_HINTS = {
  missingFile: 'Restore the file, or remove it from AUDITED_DOC_FILES in scripts/audit_markdown.js.',
  publishApproved: "Add 'publish-approved: true' to the frontmatter once the page is reviewed for public release, or move it out of docs/public/.",
  placeholder: "Resolve the placeholder, or set 'draft: true' in the frontmatter while the page is unfinished.",
  outsideRoot: 'Link to a file inside the repository, or use an absolute https:// URL for external resources.',
  brokenFile: "Fix the relative path (it resolves from the linking file's folder and is case-sensitive), or restore the target file.",
  brokenAnchor: "Point the fragment at an existing heading slug in the target file (lowercase, spaces become '-', punctuation dropped).",
  inlinePath: 'Correct the path (inline paths resolve from the repository root), or link the file.',
  snippet: 'Make the snippet type-check against tsconfig.json, or fence it as ```text if it is only illustrative.',
  unsupported: 'Rewrite the construct with the Markdown subset scripts/utils/markdown supports (ATX headings, lists, tables, fenced code, links), or extend that parser with tests.',
  unmatchedBacktick: 'Balance single-backtick spans (`code`) in src/data/guides.ts; use a { type: "code" } block for multi-line snippets.',
  privateRepoUrl: 'Replace private github.com/fderuiter/QRCraftly-web URLs with public standards URLs, live https://qrcraftly.com routes, or internal routes.',
  dangerousUrl: 'Use safe https:// or site-relative /... links; dangerous schemes (javascript:, data:, vbscript:, file:) are forbidden.',
  packageCoverage: 'Document every directory in src/packages/ (marking optical-modem experimental) and every subpath in src/packages/core/ in both docs/public/INTEGRATION.md and developer-integration-guide in src/data/guides.ts.'
};

/**
 * Prints an audit error together with the matching remediation hint and flags the run as failed.
 * @param {string|null} file Repository-relative file the error belongs to (null for global errors).
 * @param {string} message Description of the problem.
 * @param {keyof typeof REMEDIATION_HINTS} hintKey Which remediation hint to print.
 */
export function reportError(file, message, hintKey) {
  const prefix = file ? `Error in ${file}: ` : 'Error: ';
  console.error(`${prefix}${message}\n  Fix: ${REMEDIATION_HINTS[hintKey]}`);
  hasErrors = true;
}

function listMarkdown(relativeDir) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  return fs.readdirSync(absoluteDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => `${relativeDir}/${entry.name}`)
    .sort();
}

export function getFilesToAudit() {
  const rawList = [...AUDITED_DOC_DIRS.flatMap(listMarkdown), ...AUDITED_DOC_FILES];
  return [...new Set(rawList)].filter(file => !isQuarantined(file));
}

export let hasErrors = false;

export function resetErrors() {
  hasErrors = false;
  parsedFilesCache.clear();
  tokenCache.clear();
}

export function setErrors(val) {
  hasErrors = val;
}

export { slugify };

/** Tokens per file and source, so each file is parsed (and reports a syntax error) once. */
const tokenCache = new Map();

/**
 * Tokenizes a file's Markdown body. Unsupported syntax is reported as an audit error.
 * @param {string} file Repository-relative file name.
 * @param {string} content Full file content (with frontmatter).
 * @returns {object[]} Tokens, or an empty list when the file cannot be parsed.
 */
function tokensFor(file, content) {
  const key = `${file}\0${content}`;
  if (tokenCache.has(key)) return tokenCache.get(key);
  const { body } = parseFrontmatter(content);
  const lineOffset = content.slice(0, content.length - body.length).split(/\r?\n/).length - 1;
  let tokens = [];
  try {
    tokens = tokenize(body, { file, lineOffset });
  } catch (err) {
    if (!(err instanceof MarkdownSyntaxError)) throw err;
    reportError(file, `Unsupported Markdown: ${err.message}`, 'unsupported');
  }
  tokenCache.set(key, tokens);
  return tokens;
}

/**
 * Heading slugs of a file.
 * @param {string} file Repository-relative file name.
 * @param {string} content Full file content.
 * @returns {Set<string>} Slugs.
 */
function headingSlugs(file, content) {
  const headings = new Set();
  walk(tokensFor(file, content), token => {
    if (token.type === 'heading') {
      headings.add(slugify(token.text));
    }
  });
  return headings;
}

export function checkPublishApproved(file, content) {
  if (isQuarantined(file)) {
    return false;
  }
  
  const filePathAbs = path.isAbsolute(file) ? file : path.resolve(repoRoot, file);
  const docsPublicDirAbs = path.resolve(docsPublicDir);
  const isInPublicDir = filePathAbs.startsWith(docsPublicDirAbs + path.sep) || filePathAbs === docsPublicDirAbs;
  
  if (!isInPublicDir) {
    return false;
  }
  
  const { frontmatter } = parseFrontmatter(content);
  if (frontmatter['publish-approved'] !== true) {
    reportError(file, "Public document is missing the required 'publish-approved: true' metadata attribute.", 'publishApproved');
    return true;
  }
  return false;
}

export function checkPlaceholders(file, content) {
  if (isQuarantined(file)) {
    return false;
  }
  const { frontmatter, body } = parseFrontmatter(content);
  if (frontmatter.draft === true) {
    return false;
  }
  let localHasErrors = false;
  const placeholderRegex = /(TODO|FIXME)/g;
  let match;
  while ((match = placeholderRegex.exec(body)) !== null) {
    reportError(file, `Found placeholder string '${match[0]}'`, 'placeholder');
    localHasErrors = true;
  }
  return localHasErrors;
}

/**
 * Whether a file is in INLINE_PATH_SCOPE.
 * @param {string} file Repository-relative POSIX path.
 * @returns {boolean} True when inline code paths in the file are checked.
 */
export function isInlinePathScope(file) {
  return INLINE_PATH_SCOPE.files.includes(file)
    || (INLINE_PATH_SCOPE.dirs.some(dir => file.startsWith(dir)) && file.endsWith('.md'));
}

/**
 * Whether an inline code span has the shape of a repository path (see INLINE_PATH_EXTENSIONS).
 * @param {string} span Code span text, without a line suffix.
 * @returns {boolean} True when the span should be checked against the file system.
 */
export function looksLikeRepoPath(span) {
  if (!span.includes('/')) return false;
  if (/\s/.test(span)) return false;
  if (/[*<>{}$]/.test(span)) return false;
  if (span.includes('://')) return false;
  if (/^[@~/.]/.test(span)) return false;
  return INLINE_PATH_EXTENSIONS.some(ext => span.endsWith(ext));
}

/**
 * Checks that inline code spans in prose that look like repository paths exist relative to the
 * repository root. Fenced code blocks are not inline code and are not checked.
 * @param {string} file Repository-relative file name.
 * @param {string} content Full file content.
 * @returns {boolean} True when an error was reported.
 */
export function checkInlinePaths(file, content) {
  if (isQuarantined(file) || !isInlinePathScope(file)) {
    return false;
  }
  let localHasErrors = false;
  walk(tokensFor(file, content), token => {
    if (token.type !== 'codespan') return;
    const span = token.text.trim();
    const candidate = span.replace(/:\d+(-\d+)?$/, '');
    if (!looksLikeRepoPath(candidate)) return;
    if (!fs.existsSync(path.join(repoRoot, candidate))) {
      reportError(file, `Inline path '${span}' does not exist in the repository.`, 'inlinePath');
      localHasErrors = true;
    }
  });
  return localHasErrors;
}

export function buildFileHeadings(file, content) {
  if (isQuarantined(file)) {
    return new Set();
  }
  return headingSlugs(file, content);
}

export function existsSyncCaseSensitive(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const resolvedPath = path.resolve(targetPath);
  let current = repoRoot;
  let relative = path.relative(repoRoot, resolvedPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const parsed = path.parse(resolvedPath);
    current = parsed.root;
    relative = path.relative(current, resolvedPath);
  }

  if (!relative) return true;

  const parts = relative.split(/[/\\]/).filter(Boolean);

  for (const part of parts) {
    try {
      if (!fs.existsSync(current)) break;
      const entries = fs.readdirSync(current);
      if (entries.includes(part)) {
        current = path.join(current, part);
        continue;
      }
      const partLower = part.toLowerCase();
      const hasCaseInsensitiveMatch = entries.some(e => e.toLowerCase() === partLower);
      if (hasCaseInsensitiveMatch) {
        return false;
      }
      current = path.join(current, part);
    } catch {
      break;
    }
  }

  return true;
}

function isPublicDocFile(file) {
  const filePathAbs = path.isAbsolute(file) ? file : path.resolve(repoRoot, file);
  const docsPublicDirAbs = path.resolve(docsPublicDir);
  return filePathAbs.startsWith(docsPublicDirAbs + path.sep) || filePathAbs === docsPublicDirAbs;
}

export function verifyLinks(file, content, fileHeadings) {
  if (isQuarantined(file)) {
    return false;
  }
  let localHasErrors = false;
  const filePath = path.join(repoRoot, file);
  const inPublicDocs = isPublicDocFile(file);

  walk(tokensFor(file, content), token => {
    if (token.type === 'link') {
      const href = token.href;

      if (DANGEROUS_SCHEME_REGEX.test(href.trim())) {
        reportError(file, `Dangerous link scheme in '${href}'.`, 'dangerousUrl');
        localHasErrors = true;
        return;
      }

      if (inPublicDocs && PRIVATE_REPO_URL_REGEX.test(href)) {
        reportError(file, `Public document links to private repository URL '${href}'.`, 'privateRepoUrl');
        localHasErrors = true;
        return;
      }
      
      // Ignore external HTTP/HTTPS links and mailto:
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        return;
      }
      
      let targetFile = file;
      let targetHash = null;
      
      if (href.startsWith('#')) {
        targetHash = href.slice(1);
      } else {
        const parts = href.split('#');
        const relativeTargetFile = parts[0];
        const targetFilePathAbs = path.resolve(path.dirname(filePath), relativeTargetFile);
        
        // Block path traversal and any link outside repository root
        const relativeFromRoot = path.relative(repoRoot, targetFilePathAbs);
        if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
          reportError(file, `Relative link '${href}' resolves to a path outside the repository root.`, 'outsideRoot');
          localHasErrors = true;
          return;
        }

        targetFile = relativeFromRoot;
        if (parts.length > 1) {
          targetHash = parts[1];
        }
      }
      
      // Verify file exists
      if (targetFile) {
        const targetFilePath = path.join(repoRoot, targetFile);
        if (!existsSyncCaseSensitive(targetFilePath)) {
          reportError(file, `Broken link references missing file '${targetFile}' (href: '${href}')`, 'brokenFile');
          localHasErrors = true;
          return;
        }
        
        // Verify hash exists in the target file
        if (targetHash) {
          let headingsToSearch = fileHeadings[targetFile];
          
          if (!headingsToSearch) {
            // Target file is valid but wasn't audited yet (e.g. README.md)
            headingsToSearch = headingSlugs(targetFile, getParsedFile(targetFile).content);
            fileHeadings[targetFile] = headingsToSearch;
          }
          
          const targetSlug = slugify(targetHash);
          if (!headingsToSearch.has(targetSlug) && !headingsToSearch.has(targetHash)) {
            reportError(file, `Broken link references missing anchor '#${targetHash}' in '${targetFile}' (href: '${href}')`, 'brokenAnchor');
            localHasErrors = true;
          }
        }
      }
    }
  });
  return localHasErrors;
}

function unwrapExpression(node) {
  let current = node;
  while (
    current &&
    (ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function evalStringNode(node) {
  const unwrapped = unwrapExpression(node);
  if (!unwrapped) return null;
  if (ts.isStringLiteral(unwrapped) || ts.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.text;
  }
  if (ts.isBinaryExpression(unwrapped) && unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evalStringNode(unwrapped.left);
    const right = evalStringNode(unwrapped.right);
    if (left !== null && right !== null) return left + right;
  }
  if (
    ts.isCallExpression(unwrapped) &&
    ts.isPropertyAccessExpression(unwrapped.expression) &&
    unwrapped.expression.name.text === 'join' &&
    ts.isArrayLiteralExpression(unwrapExpression(unwrapped.expression.expression))
  ) {
    const arrNode = unwrapExpression(unwrapped.expression.expression);
    const sep = unwrapped.arguments.length > 0 ? evalStringNode(unwrapped.arguments[0]) : ',';
    if (sep !== null) {
      const items = [];
      for (const elem of arrNode.elements) {
        const val = evalStringNode(elem);
        if (val === null) return null;
        items.push(val);
      }
      return items.join(sep);
    }
  }
  return null;
}

function evalStringArrayNode(node) {
  const unwrapped = unwrapExpression(node);
  if (!unwrapped || !ts.isArrayLiteralExpression(unwrapped)) return [];
  const items = [];
  for (const elem of unwrapped.elements) {
    const val = evalStringNode(elem);
    if (val !== null) items.push(val);
  }
  return items;
}

function getObjectPropertyMap(objNode) {
  const map = new Map();
  const unwrapped = unwrapExpression(objNode);
  if (!unwrapped || !ts.isObjectLiteralExpression(unwrapped)) return map;
  for (const prop of unwrapped.properties) {
    if (ts.isPropertyAssignment(prop)) {
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
      if (key) map.set(key, prop.initializer);
    }
  }
  return map;
}

/**
 * Parses `export const guides` from `src/data/guides.ts` using TypeScript's AST.
 * @param {string|null} content Optional source text override for tests.
 * @param {string} file File label for diagnostics.
 * @returns {Array<object>} Parsed guide records.
 */
export function parseGuidesData(content = null, file = GUIDES_FILE) {
  const sourceText = content !== null
    ? content
    : fs.readFileSync(path.join(repoRoot, file), 'utf-8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const guides = [];

  ts.forEachChild(sourceFile, node => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== 'guides' || !decl.initializer) continue;
      const arrNode = unwrapExpression(decl.initializer);
      if (!arrNode || !ts.isArrayLiteralExpression(arrNode)) continue;

      for (const elem of arrNode.elements) {
        const props = getObjectPropertyMap(elem);
        const slug = evalStringNode(props.get('slug')) ?? '';
        const title = evalStringNode(props.get('title')) ?? '';
        const lead = evalStringNode(props.get('lead')) ?? '';
        const sections = [];
        const sectionsArr = unwrapExpression(props.get('sections'));
        if (sectionsArr && ts.isArrayLiteralExpression(sectionsArr)) {
          for (const secElem of sectionsArr.elements) {
            const secProps = getObjectPropertyMap(secElem);
            const id = evalStringNode(secProps.get('id')) ?? '';
            const heading = evalStringNode(secProps.get('heading')) ?? '';
            const blocks = [];
            const blocksArr = unwrapExpression(secProps.get('blocks'));
            if (blocksArr && ts.isArrayLiteralExpression(blocksArr)) {
              for (const blockElem of blocksArr.elements) {
                const blockProps = getObjectPropertyMap(blockElem);
                const type = evalStringNode(blockProps.get('type')) ?? '';
                if (type === 'p') {
                  blocks.push({ type, text: evalStringNode(blockProps.get('text')) ?? '' });
                } else if (type === 'ul' || type === 'ol') {
                  blocks.push({ type, items: evalStringArrayNode(blockProps.get('items')) });
                } else if (type === 'note') {
                  blocks.push({
                    type,
                    title: evalStringNode(blockProps.get('title')) ?? '',
                    text: evalStringNode(blockProps.get('text')) ?? '',
                  });
                } else if (type === 'table') {
                  const rowsNode = unwrapExpression(blockProps.get('rows'));
                  const rows = [];
                  if (rowsNode && ts.isArrayLiteralExpression(rowsNode)) {
                    for (const rowElem of rowsNode.elements) {
                      rows.push(evalStringArrayNode(rowElem));
                    }
                  }
                  blocks.push({
                    type,
                    caption: evalStringNode(blockProps.get('caption')) ?? '',
                    head: evalStringArrayNode(blockProps.get('head')),
                    rows,
                  });
                } else if (type === 'code') {
                  blocks.push({
                    type,
                    language: evalStringNode(blockProps.get('language')) ?? '',
                    title: evalStringNode(blockProps.get('title')) ?? '',
                    code: evalStringNode(blockProps.get('code')) ?? '',
                  });
                }
              }
            }
            sections.push({ id, heading, blocks });
          }
        }

        const sources = [];
        const sourcesArr = unwrapExpression(props.get('sources'));
        if (sourcesArr && ts.isArrayLiteralExpression(sourcesArr)) {
          for (const srcElem of sourcesArr.elements) {
            const srcProps = getObjectPropertyMap(srcElem);
            sources.push({
              label: evalStringNode(srcProps.get('label')) ?? '',
              url: evalStringNode(srcProps.get('url')) ?? '',
              supports: evalStringNode(srcProps.get('supports')) ?? '',
            });
          }
        }

        guides.push({ slug, title, lead, sections, sources });
      }
    }
  });

  return guides;
}

function scanGuideInlineText(text) {
  const codeSpans = [];
  const links = [];
  let unmatched = false;

  if (text.includes('``')) {
    unmatched = true;
    return { unmatched, codeSpans, links };
  }

  let index = 0;
  while (index < text.length) {
    const ch = text[index];
    if (ch === '`') {
      const close = text.indexOf('`', index + 1);
      if (close === -1) {
        unmatched = true;
        return { unmatched, codeSpans, links };
      }
      codeSpans.push(text.slice(index + 1, close));
      index = close + 1;
      continue;
    }
    if (ch === '[') {
      const match = /^\[([^\]\r\n]+)\]\(([^)\s]+)\)/.exec(text.slice(index));
      if (match) {
        const labelScan = scanGuideInlineText(match[1]);
        if (labelScan.unmatched) {
          unmatched = true;
          return { unmatched, codeSpans, links };
        }
        codeSpans.push(...labelScan.codeSpans);
        links.push({ label: match[1], href: match[2] });
        index += match[0].length;
        continue;
      }
    }
    index += 1;
  }

  return { unmatched, codeSpans, links };
}

/**
 * Audits inline backticks, inline repository paths, internal/external links, placeholders, and
 * source URLs across every guide in `src/data/guides.ts`.
 * @param {string|null} content Optional source text override for tests.
 * @param {string} file File label for error reporting.
 * @returns {boolean} True when any error was reported.
 */
export function auditGuidesData(content = null, file = GUIDES_FILE) {
  const filePath = path.join(repoRoot, file);
  if (content === null && !fs.existsSync(filePath)) {
    reportError(file, `File does not exist at ${filePath}`, 'missingFile');
    return true;
  }

  const guides = parseGuidesData(content, file);
  const guidesBySlug = new Map();
  for (const guide of guides) {
    guidesBySlug.set(guide.slug, {
      guide,
      sectionIds: new Set(['sources', ...guide.sections.map(sec => sec.id)]),
    });
  }

  let localHasErrors = false;

  const auditInlineField = (guideSlug, contextLabel, text) => {
    const placeholderMatch = /(TODO|FIXME)/.exec(text);
    if (placeholderMatch) {
      reportError(file, `[${guideSlug} ${contextLabel}] Found placeholder string '${placeholderMatch[0]}'.`, 'placeholder');
      localHasErrors = true;
    }

    const { unmatched, codeSpans, links } = scanGuideInlineText(text);
    if (unmatched) {
      reportError(file, `[${guideSlug} ${contextLabel}] Unmatched or multi-backtick code span in '${text.slice(0, 80)}'.`, 'unmatchedBacktick');
      localHasErrors = true;
      return;
    }

    for (const rawSpan of codeSpans) {
      const span = rawSpan.trim();
      const candidate = span.replace(/:\d+(-\d+)?$/, '');
      if (looksLikeRepoPath(candidate) && !fs.existsSync(path.join(repoRoot, candidate))) {
        reportError(file, `[${guideSlug} ${contextLabel}] Inline path '${span}' does not exist in the repository.`, 'inlinePath');
        localHasErrors = true;
      }
    }

    for (const { href } of links) {
      const trimmed = href.trim();
      if (DANGEROUS_SCHEME_REGEX.test(trimmed)) {
        reportError(file, `[${guideSlug} ${contextLabel}] Dangerous link scheme '${href}'.`, 'dangerousUrl');
        localHasErrors = true;
        continue;
      }
      if (PRIVATE_REPO_URL_REGEX.test(trimmed)) {
        reportError(file, `[${guideSlug} ${contextLabel}] Link points to private repository URL '${href}'.`, 'privateRepoUrl');
        localHasErrors = true;
        continue;
      }
      if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('mailto:')) {
        continue;
      }
      if (trimmed.startsWith('#')) {
        const anchor = trimmed.slice(1);
        const guideInfo = guidesBySlug.get(guideSlug);
        if (!guideInfo || !guideInfo.sectionIds.has(anchor)) {
          reportError(file, `[${guideSlug} ${contextLabel}] Broken anchor '#${anchor}' in guide '${guideSlug}'.`, 'brokenAnchor');
          localHasErrors = true;
        }
        continue;
      }
      if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        const [pathAndQuery, hashPart] = trimmed.split('#');
        const routeRaw = pathAndQuery.split('?')[0];
        const route = routeRaw.length > 1 ? routeRaw.replace(/\/+$/, '') : routeRaw;

        if (route === '/') {
          if (!fs.existsSync(path.join(repoRoot, 'src', 'pages', 'index'))) {
            reportError(file, `[${guideSlug} ${contextLabel}] Broken route link '${href}'.`, 'brokenFile');
            localHasErrors = true;
          }
        } else if (route === '/guides') {
          if (!fs.existsSync(path.join(repoRoot, 'src', 'pages', 'guides', '+Page.tsx'))) {
            reportError(file, `[${guideSlug} ${contextLabel}] Broken route link '${href}'.`, 'brokenFile');
            localHasErrors = true;
          }
        } else if (route.startsWith('/guides/')) {
          const targetSlug = route.slice('/guides/'.length);
          const targetGuide = guidesBySlug.get(targetSlug);
          if (!targetGuide) {
            reportError(file, `[${guideSlug} ${contextLabel}] Broken guide route '${href}'.`, 'brokenFile');
            localHasErrors = true;
          } else if (hashPart && !targetGuide.sectionIds.has(hashPart)) {
            reportError(file, `[${guideSlug} ${contextLabel}] Broken anchor '#${hashPart}' on '/guides/${targetSlug}'.`, 'brokenAnchor');
            localHasErrors = true;
          }
        } else {
          const segments = route.slice(1).split('/');
          if (!fs.existsSync(path.join(repoRoot, 'src', 'pages', ...segments))) {
            reportError(file, `[${guideSlug} ${contextLabel}] Broken internal route '${href}'.`, 'brokenFile');
            localHasErrors = true;
          }
        }
        continue;
      }

      reportError(file, `[${guideSlug} ${contextLabel}] Relative or unsupported URL '${href}' in guide text.`, 'outsideRoot');
      localHasErrors = true;
    }
  };

  for (const guide of guides) {
    auditInlineField(guide.slug, 'title', guide.title);
    auditInlineField(guide.slug, 'lead', guide.lead);

    for (const section of guide.sections) {
      auditInlineField(guide.slug, `section:${section.id}:heading`, section.heading);
      for (const block of section.blocks) {
        if (block.type === 'p') {
          auditInlineField(guide.slug, `section:${section.id}:p`, block.text);
        } else if (block.type === 'ul' || block.type === 'ol') {
          for (const item of block.items) {
            auditInlineField(guide.slug, `section:${section.id}:${block.type}`, item);
          }
        } else if (block.type === 'note') {
          auditInlineField(guide.slug, `section:${section.id}:note-title`, block.title);
          auditInlineField(guide.slug, `section:${section.id}:note-text`, block.text);
        } else if (block.type === 'table') {
          auditInlineField(guide.slug, `section:${section.id}:table-caption`, block.caption);
          for (const cell of block.head) {
            auditInlineField(guide.slug, `section:${section.id}:table-head`, cell);
          }
          for (const row of block.rows) {
            for (const cell of row) {
              auditInlineField(guide.slug, `section:${section.id}:table-cell`, cell);
            }
          }
        }
      }
    }

    for (const source of guide.sources) {
      auditInlineField(guide.slug, 'source:label', source.label);
      auditInlineField(guide.slug, 'source:supports', source.supports);
      if (DANGEROUS_SCHEME_REGEX.test(source.url.trim()) || !source.url.startsWith('https://')) {
        reportError(file, `[${guide.slug} source] Source URL '${source.url}' must use https://.`, 'dangerousUrl');
        localHasErrors = true;
      } else if (PRIVATE_REPO_URL_REGEX.test(source.url)) {
        reportError(file, `[${guide.slug} source] Source URL '${source.url}' points to the private repository.`, 'privateRepoUrl');
        localHasErrors = true;
      }
    }
  }

  return localHasErrors;
}

/**
 * Verifies that every package in `src/packages/` (with `optical-modem` marked experimental) and
 * every subpath in `src/packages/core/` is documented in both `docs/public/INTEGRATION.md` and
 * the `developer-integration-guide` entry in `src/data/guides.ts`.
 * @param {{ integrationMdContent?: string|null, guidesContent?: string|null }} options Optional overrides for tests.
 * @returns {boolean} True when any coverage error was reported.
 */
export function checkIntegrationPackageCoverage(options = {}) {
  const { integrationMdContent = null, guidesContent = null } = options;
  const packagesDir = path.join(repoRoot, 'src', 'packages');
  const coreDir = path.join(packagesDir, 'core');
  if (!fs.existsSync(packagesDir) || !fs.existsSync(coreDir)) {
    return false;
  }

  const packageNames = fs.readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  const coreSubpaths = fs.readdirSync(coreDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts'))
    .map(entry => entry.name.replace(/\.ts$/, ''))
    .sort();

  const integrationFile = 'docs/public/INTEGRATION.md';
  const mdText = integrationMdContent !== null ? integrationMdContent : getParsedFile(integrationFile).content;

  const guides = parseGuidesData(guidesContent, GUIDES_FILE);
  const devGuide = guides.find(g => g.slug === 'developer-integration-guide');

  let guideText = '';
  const guideItemsAndRows = [];
  if (devGuide) {
    const parts = [devGuide.title, devGuide.lead];
    for (const sec of devGuide.sections) {
      parts.push(sec.heading);
      for (const block of sec.blocks) {
        if (block.type === 'p') {
          parts.push(block.text);
          guideItemsAndRows.push(block.text);
        } else if (block.type === 'ul' || block.type === 'ol') {
          parts.push(...block.items);
          guideItemsAndRows.push(...block.items);
        } else if (block.type === 'note') {
          parts.push(block.title, block.text);
          guideItemsAndRows.push(`${block.title} ${block.text}`);
        } else if (block.type === 'table') {
          parts.push(block.caption, ...block.head);
          for (const row of block.rows) {
            parts.push(...row);
            guideItemsAndRows.push(row.join(' | '));
          }
        } else if (block.type === 'code') {
          parts.push(block.code);
        }
      }
    }
    guideText = parts.join('\n');
  }

  let localHasErrors = false;

  for (const pkg of packageNames) {
    const token = `@/packages/${pkg}`;
    if (!mdText.includes(token)) {
      reportError(integrationFile, `Missing package '${token}' in ${integrationFile}.`, 'packageCoverage');
      localHasErrors = true;
    }
    if (!guideText.includes(token)) {
      reportError(GUIDES_FILE, `Missing package '${token}' in developer-integration-guide.`, 'packageCoverage');
      localHasErrors = true;
    }
  }

  const mdModemLines = mdText.split(/\r?\n/).filter(line => line.includes('@/packages/optical-modem'));
  if (mdModemLines.length === 0 || !mdModemLines.some(line => /experimental/i.test(line))) {
    reportError(integrationFile, "Package '@/packages/optical-modem' must be marked experimental.", 'packageCoverage');
    localHasErrors = true;
  }

  const guideModemEntries = guideItemsAndRows.filter(entry => entry.includes('@/packages/optical-modem'));
  if (guideModemEntries.length === 0 || !guideModemEntries.some(entry => /experimental/i.test(entry))) {
    reportError(GUIDES_FILE, "Package '@/packages/optical-modem' must be marked experimental in developer-integration-guide.", 'packageCoverage');
    localHasErrors = true;
  }

  for (const subpath of coreSubpaths) {
    const token = `@/packages/core/${subpath}`;
    if (!mdText.includes(token)) {
      reportError(integrationFile, `Missing core subpath '${token}' in ${integrationFile}.`, 'packageCoverage');
      localHasErrors = true;
    }
    if (!guideText.includes(token)) {
      reportError(GUIDES_FILE, `Missing core subpath '${token}' in developer-integration-guide.`, 'packageCoverage');
      localHasErrors = true;
    }
  }

  return localHasErrors;
}

export function checkCodeSnippets(filesList, options = {}) {
  let localHasErrors = false;
  const virtualFiles = new Map();
  const { guidesContent = null } = options;
  try {
    let snippetIndex = 0;
    for (const file of filesList) {
      if (file === GUIDES_FILE) {
        const filePath = path.join(repoRoot, file);
        if (guidesContent === null && !fs.existsSync(filePath)) continue;
        const guides = parseGuidesData(guidesContent, file);
        const fileDir = path.dirname(filePath);
        for (const guide of guides) {
          for (const section of guide.sections) {
            for (const block of section.blocks) {
              if (block.type !== 'code') continue;
              const lang = (block.language || '').toLowerCase();
              if (['ts', 'tsx', 'typescript', 'typescriptreact'].includes(lang)) {
                const tempFileName = `virtual_guide_snippet_${snippetIndex++}.tsx`;
                const tempFilePath = path.resolve(fileDir, tempFileName);
                virtualFiles.set(tempFilePath, {
                  file: `${file} (${guide.slug}#${section.id})`,
                  lang,
                  text: block.code,
                });
              }
            }
          }
        }
        continue;
      }

      const filePath = path.join(repoRoot, file);
      if (!fs.existsSync(filePath)) continue;
      const { frontmatter, content } = getParsedFile(file);
      if (frontmatter.draft === true) {
        continue;
      }

      walk(tokensFor(file, content), token => {
        if (token.type === 'code') {
          const lang = (token.lang || '').toLowerCase();
          if (['ts', 'tsx', 'typescript', 'typescriptreact'].includes(lang)) {
            const fileDir = path.dirname(filePath);
            const tempFileName = `virtual_snippet_${snippetIndex++}.tsx`;
            const tempFilePath = path.resolve(fileDir, tempFileName);
            virtualFiles.set(tempFilePath, {
              file: file,
              lang: lang,
              text: token.text
            });
          }
        }
      });
    }

    const fileNames = Array.from(virtualFiles.keys());
    if (fileNames.length > 0) {
      const tsconfigPath = path.join(repoRoot, 'tsconfig.json');
      const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (readResult.error) {
        reportError('tsconfig.json', `Could not read tsconfig.json: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, '\n')}`, 'snippet');
        localHasErrors = true;
      } else {
        const parsedConfig = ts.parseJsonConfigFileContent(
          readResult.config,
          ts.sys,
          repoRoot
        );

        const compilerOptions = {
          ...parsedConfig.options,
          noEmit: true,
          skipLibCheck: true,
        };

        const defaultHost = ts.createCompilerHost(compilerOptions);

        const customHost = {
          ...defaultHost,
          fileExists(fileName) {
            const normalizedPath = path.resolve(fileName);
            if (virtualFiles.has(normalizedPath)) {
              return true;
            }
            return defaultHost.fileExists(fileName);
          },
          readFile(fileName) {
            const normalizedPath = path.resolve(fileName);
            if (virtualFiles.has(normalizedPath)) {
              return virtualFiles.get(normalizedPath).text;
            }
            return defaultHost.readFile(fileName);
          },
          getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
            const normalizedPath = path.resolve(fileName);
            if (virtualFiles.has(normalizedPath)) {
              const virtualFileInfo = virtualFiles.get(normalizedPath);
              if (!virtualFileInfo.sourceFile) {
                const languageVersion = typeof languageVersionOrOptions === 'object'
                  ? languageVersionOrOptions.target
                  : languageVersionOrOptions;
                virtualFileInfo.sourceFile = ts.createSourceFile(
                  normalizedPath,
                  virtualFileInfo.text,
                  languageVersion || ts.ScriptTarget.Latest,
                  true
                );
              }
              return virtualFileInfo.sourceFile;
            }
            return defaultHost.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
          },
          writeFile() {
            // No physical output files generated
          },
          directoryExists(directoryName) {
            const normalizedDir = path.resolve(directoryName);
            for (const virtualPath of virtualFiles.keys()) {
              if (virtualPath.startsWith(normalizedDir)) {
                return true;
              }
            }
            if (defaultHost.directoryExists) {
              return defaultHost.directoryExists(directoryName);
            }
            return false;
          }
        };

        const ambientFiles = parsedConfig.fileNames.filter((f) => f.endsWith('.d.ts'));
        const program = ts.createProgram([...ambientFiles, ...fileNames], compilerOptions, customHost);
        const emitResult = program.emit();

        const allDiagnostics = ts
          .getPreEmitDiagnostics(program)
          .concat(emitResult.diagnostics);

        for (const diagnostic of allDiagnostics) {
          if (diagnostic.category === ts.DiagnosticCategory.Error) {
            localHasErrors = true;
            hasErrors = true;
            if (diagnostic.file) {
              const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
              const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
              const fileName = path.resolve(diagnostic.file.fileName);
              const tempFileInfo = virtualFiles.get(fileName);
              if (tempFileInfo) {
                reportError(tempFileInfo.file, `TS type check error in snippet on line ${line + 1}, col ${character + 1}: ${message}`, 'snippet');
              } else {
                reportError(null, `TS error in ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`, 'snippet');
              }
            } else {
              reportError(null, `TS error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`, 'snippet');
            }
          }
        }
      }
    }
  } catch (err) {
    reportError(null, `TS snippet extraction or compilation failed: ${err instanceof Error ? err.message : String(err)}`, 'snippet');
    localHasErrors = true;
  }
  return localHasErrors;
}

export function runAudit() {
  hasErrors = false;
  const files = getFilesToAudit();
  const fileHeadings = {};
  
  // 1. Build a map of headings for each file and check for placeholders
  for (const file of files) {
    const filePath = path.join(repoRoot, file);
    if (!fs.existsSync(filePath)) {
      reportError(file, `File does not exist at ${filePath}`, 'missingFile');
      continue;
    }
    const { content } = getParsedFile(file);
    checkPublishApproved(file, content);
    checkPlaceholders(file, content);
    checkInlinePaths(file, content);
    fileHeadings[file] = buildFileHeadings(file, content);
  }
  
  // 2. Extract and validate links in Markdown files
  for (const file of files) {
    const filePath = path.join(repoRoot, file);
    if (!fs.existsSync(filePath)) continue;
    const { content } = getParsedFile(file);
    verifyLinks(file, content, fileHeadings);
  }

  // 3. Audit src/data/guides.ts prose, backticks, links, sources, and package coverage
  auditGuidesData();
  checkIntegrationPackageCoverage();
  
  // 4. Extract and verify TypeScript/TSX code blocks in Markdown files and src/data/guides.ts
  checkCodeSnippets([...files, GUIDES_FILE]);
  
  if (hasErrors) {
    process.exit(1);
  } else {
    console.log('Markdown audit passed successfully.');
    process.exit(0);
  }
}

// Only run automatically if executed directly
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('audit_markdown.js'))) {
  runAudit();
}
