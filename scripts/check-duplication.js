/**
 * Duplicate-code checker (#1195). It enforces the AGENTS.md duplication limit in-process.
 *
 * - Reads `.jscpd.json` (`threshold`, `minLines`, `minTokens`, `path`, `ignore`).
 * - Lists files with `git ls-files` (tracked plus untracked, not ignored) and filters them
 *   with a small glob matcher (`**`, `*`, `?`). Paths are POSIX and relative to the root.
 * - Tokenises `.ts` and `.tsx` with the TypeScript scanner and drops whitespace and comments
 *   (jscpd's default "mild" mode). A little context tracking rescans template literals,
 *   regular expressions, `>=`-style operators and JSX the way a parser would.
 * - Finds clones with a Rabin-Karp rolling hash over windows of `minTokens` tokens, across
 *   files and within each file. Every hash hit is confirmed token by token, and consecutive
 *   hits grow into one maximal clone. A clone pairs a fragment with its earliest copy and
 *   counts when that copy spans `minLines` or more lines (end line minus start line).
 * - The percentage is jscpd's: the summed line span of the clones divided by the total lines
 *   of the scanned files. The check fails when it is at or above `threshold`.
 *
 * Usage: node scripts/check-duplication.js [--json]
 */
import fs from 'fs';
import { createRequire, enableCompileCache } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import { execBinary } from './utils/execHelper.js';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const isMain = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === __filename;

// Loading the TypeScript compiler is most of a run's cost. `require` skips the CommonJS export
// scan that `import` runs over its 9 MB, and Node's bytecode cache halves the rest.
if (isMain && typeof enableCompileCache === 'function') enableCompileCache();
/** @type {typeof import('typescript')} */
const ts = createRequire(import.meta.url)('typescript');

export const CONFIG_FILE = '.jscpd.json';
const EXTENSIONS = ['.ts', '.tsx'];
const DEFAULTS = { threshold: 3, minLines: 5, minTokens: 45, path: ['src'], ignore: [] };

/**
 * @typedef {{ threshold: number, minLines: number, minTokens: number, path: string[], ignore: string[] }} DuplicationConfig
 * @typedef {{ file: string, start: number, end: number }} CloneSide
 * @typedef {{ first: CloneSide, second: CloneSide, lines: number, tokens: number }} Clone
 * @typedef {{ ids: Int32Array, startLines: Int32Array, endLines: Int32Array }} TokenStream
 */

/** @param {string} p */
function toPosix(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/**
 * Reads the checker settings, falling back to the defaults for missing keys.
 *
 * @param {string} root - Repository root
 * @returns {DuplicationConfig}
 */
export function loadConfig(root) {
  const file = path.join(root, CONFIG_FILE);
  const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const toList = (value, fallback) => (Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : fallback);
  return {
    threshold: Number(raw.threshold ?? DEFAULTS.threshold),
    minLines: Number(raw.minLines ?? DEFAULTS.minLines),
    minTokens: Number(raw.minTokens ?? DEFAULTS.minTokens),
    path: toList(raw.path, DEFAULTS.path).map(toPosix),
    ignore: toList(raw.ignore, DEFAULTS.ignore).map(toPosix),
  };
}

/**
 * Compiles a glob to an anchored regular expression: `**` spans directories, `*` and `?`
 * stay within one path segment.
 *
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      const atSegmentStart = i === 0 || glob[i - 1] === '/';
      if (atSegmentStart && glob[i + 2] === '/') {
        out += '(?:[^/]*/)*';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (ch === '*') {
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/**
 * Lists the files to scan: under `config.path`, a `.ts`/`.tsx` extension, not ignored.
 *
 * @param {string} root
 * @param {DuplicationConfig} config
 * @returns {string[]} Sorted POSIX paths relative to `root`
 */
export function listFiles(root, config) {
  const output = execBinary('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...config.path], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const ignores = config.ignore.map(globToRegExp);
  const files = new Set();
  for (const entry of output.split('\0')) {
    const file = toPosix(entry);
    if (!file || !EXTENSIONS.some(ext => file.endsWith(ext))) continue;
    if (ignores.some(re => re.test(file))) continue;
    if (!fs.existsSync(path.join(root, file))) continue;
    files.add(file);
  }
  return [...files].sort();
}

const K = ts.SyntaxKind;
const TEXT_ID_OFFSET = 1000;

/** Punctuation and keywords: the kind alone fixes the text. @param {number} kind */
function hasFixedText(kind) {
  return (kind >= K.FirstPunctuation && kind <= K.LastPunctuation) || (kind >= K.FirstKeyword && kind <= K.LastKeyword);
}

/**
 * Gives every distinct token (kind plus text) a small integer id, so two tokens are equal
 * exactly when their ids are. Punctuation and keywords are fixed by their kind alone.
 */
export class TokenTable {
  constructor() {
    /** @type {Map<string, number>} */
    this.ids = new Map();
  }

  /** @param {number} kind @param {string} text */
  id(kind, text) {
    if (hasFixedText(kind)) return kind;
    const key = `${kind}\u0000${text}`;
    let id = this.ids.get(key);
    if (id === undefined) {
      id = TEXT_ID_OFFSET + this.ids.size;
      this.ids.set(key, id);
    }
    return id;
  }
}

/** Keywords after which an expression starts, so `/` opens a regex and `<` may open JSX. */
const EXPRESSION_KEYWORDS = new Set([
  K.ReturnKeyword, K.TypeOfKeyword, K.InstanceOfKeyword, K.InKeyword, K.OfKeyword, K.NewKeyword, K.DeleteKeyword,
  K.VoidKeyword, K.ThrowKeyword, K.CaseKeyword, K.DoKeyword, K.ElseKeyword, K.AwaitKeyword, K.YieldKeyword, K.DefaultKeyword,
]);
const VALUE_ENDS = new Set([K.CloseParenToken, K.CloseBracketToken, K.CloseBraceToken, K.GreaterThanToken]);

/** @param {number} prev - Kind of the previous token, or -1 at the start of the file */
function expressionMayStart(prev) {
  if (prev === -1) return true;
  if (prev >= K.FirstPunctuation && prev <= K.LastPunctuation) return !VALUE_ENDS.has(prev);
  return EXPRESSION_KEYWORDS.has(prev);
}

// Scanner contexts kept on a stack.
const BRACE = 0; // `{` in code
const TEMPLATE = 1; // `${` in a template literal
const ATTRIBUTE_EXPRESSION = 2; // `{` inside a JSX tag
const CHILD_EXPRESSION = 3; // `{` among JSX children
const JSX_TAG = 4; // inside `<tag ...>`
const JSX_CHILDREN = 5; // between `<tag>` and `</tag>`
const JSX_CLOSING = 6; // inside `</tag>`

/**
 * Tokenises one TypeScript or TSX source in mild mode: no whitespace, newlines or comments.
 * Each token keeps its kind and text (as an id) and its 1-based start and end lines.
 * JSX text, whitespace included, is one token, and `</` is two (`<` and `/`), as in jscpd.
 *
 * @param {string} fileName - `.tsx` turns JSX on
 * @param {string} text - Source text
 * @param {TokenTable} table
 * @returns {TokenStream}
 */
export function tokenize(fileName, text, table) {
  const jsx = fileName.endsWith('.tsx');
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);

  /** @type {number[]} */ const ids = [];
  /** @type {number[]} */ const startLines = [];
  /** @type {number[]} */ const endLines = [];
  let line = 1;
  let nextBreak = text.indexOf('\n');
  /** 1-based line of `pos`; positions arrive in increasing order. */
  const lineAt = pos => {
    while (nextBreak !== -1 && nextBreak < pos) {
      line++;
      nextBreak = text.indexOf('\n', nextBreak + 1);
    }
    return line;
  };

  let prev = -1;
  const emit = (kind, start, end) => {
    ids.push(hasFixedText(kind) ? kind : table.id(kind, text.slice(start, end)));
    startLines.push(lineAt(start));
    endLines.push(lineAt(Math.max(start, end - 1)));
    prev = kind;
  };
  const emitCurrent = kind => emit(kind, scanner.getTokenStart(), scanner.getTokenEnd());

  /** Whether the `<` just scanned opens a JSX element rather than type parameters. */
  const opensJsx = () =>
    scanner.lookAhead(() => {
      const next = scanner.scan();
      if (next === K.GreaterThanToken) return true;
      if (next !== K.Identifier && !(next >= K.FirstKeyword && next <= K.LastKeyword)) return false;
      const after = scanner.scan();
      return after !== K.CommaToken && after !== K.ExtendsKeyword && after !== K.EqualsToken;
    });

  /** @type {number[]} */ const stack = [];
  let tagDepth = 0; // type arguments inside a tag, as in `<List<Item> />`
  let selfClosing = false;
  let expectValue = false;

  for (;;) {
    const mode = stack.length === 0 ? BRACE : stack[stack.length - 1];

    if (mode === JSX_CHILDREN) {
      const kind = scanner.scanJsxToken();
      if (kind === K.EndOfFileToken) break;
      if (kind === K.JsxText || kind === K.JsxTextAllWhiteSpaces) {
        emitCurrent(K.JsxText);
      } else if (kind === K.LessThanSlashToken) {
        const start = scanner.getTokenStart();
        emit(K.LessThanToken, start, start + 1);
        emit(K.SlashToken, start + 1, start + 2);
        stack.push(JSX_CLOSING);
      } else {
        emitCurrent(kind);
        if (kind === K.LessThanToken) {
          stack.push(JSX_TAG);
          tagDepth = 0;
          selfClosing = false;
          expectValue = false;
        } else if (kind === K.OpenBraceToken) {
          stack.push(CHILD_EXPRESSION);
        }
      }
      continue;
    }

    if (mode === JSX_TAG || mode === JSX_CLOSING) {
      let kind = expectValue ? scanner.scanJsxAttributeValue() : scanner.scan();
      expectValue = false;
      if (kind === K.EndOfFileToken) break;
      if (kind === K.Identifier || (kind >= K.FirstKeyword && kind <= K.LastKeyword)) kind = scanner.scanJsxIdentifier();
      emitCurrent(kind);
      if (kind === K.OpenBraceToken) {
        stack.push(ATTRIBUTE_EXPRESSION);
      } else if (kind === K.EqualsToken) {
        expectValue = mode === JSX_TAG;
      } else if (kind === K.LessThanToken) {
        tagDepth++;
      } else if (kind === K.SlashToken) {
        selfClosing = true;
      } else if (kind === K.GreaterThanToken) {
        if (tagDepth > 0) {
          tagDepth--;
        } else if (mode === JSX_CLOSING) {
          stack.pop();
          if (stack[stack.length - 1] === JSX_CHILDREN) stack.pop();
        } else {
          stack.pop();
          if (!selfClosing) stack.push(JSX_CHILDREN);
        }
      }
      continue;
    }

    // Code, possibly inside braces, a template literal or a JSX expression.
    const before = prev;
    let kind = scanner.scan();
    if (kind === K.EndOfFileToken) break;
    if ((kind === K.SlashToken || kind === K.SlashEqualsToken) && expressionMayStart(before)) {
      kind = scanner.reScanSlashToken();
    } else if (kind === K.GreaterThanToken && /\s/.test(text[scanner.getTokenStart() - 1] ?? '')) {
      // A spaced `>` is an operator (`>=`, `>>`, `>>>=`); an unspaced one closes type arguments.
      kind = scanner.reScanGreaterToken();
    } else if (kind === K.CloseBraceToken && stack.length > 0) {
      const closed = stack.pop();
      if (closed === TEMPLATE) {
        kind = scanner.reScanTemplateToken(false);
        if (kind === K.TemplateMiddle) stack.push(TEMPLATE);
      }
    }
    emitCurrent(kind);
    if (kind === K.OpenBraceToken) {
      stack.push(BRACE);
    } else if (kind === K.TemplateHead) {
      stack.push(TEMPLATE);
    } else if (kind === K.LessThanToken && jsx && expressionMayStart(before) && opensJsx()) {
      stack.push(JSX_TAG);
      tagDepth = 0;
      selfClosing = false;
      expectValue = false;
    }
  }

  return { ids: Int32Array.from(ids), startLines: Int32Array.from(startLines), endLines: Int32Array.from(endLines) };
}

/**
 * Lines in a file as jscpd counts them: up to the last line that is not blank.
 *
 * @param {string} text
 */
export function countLines(text) {
  const trimmed = text.trimEnd();
  return trimmed ? trimmed.split(/\r?\n/).length : 0;
}

const HASH_BASE = 0x01000193;

/** @param {number} id */
function tokenHash(id) {
  return (Math.imul(id + 1, 0x9e3779b1) ^ 0x7f4a7c15) >>> 0;
}

/**
 * Finds clones across and within token streams with a Rabin-Karp rolling hash.
 *
 * Streams are processed in order and every window of `minTokens` tokens is stored. A window
 * whose tokens equal a stored one (the hash narrows the search, the tokens decide) is a hit.
 * A hit pairs with the earliest equal window, unless it continues the clone that is open,
 * so consecutive hits grow into one maximal clone.
 *
 * @param {{ file: string, tokens: TokenStream }[]} sources
 * @param {{ minTokens: number, minLines: number }} options
 * @returns {Clone[]}
 */
export function detectClones(sources, { minTokens, minLines }) {
  const w = Math.max(1, Math.floor(minTokens));
  let highPower = 1;
  for (let k = 1; k < w; k++) highPower = Math.imul(highPower, HASH_BASE) >>> 0;

  // All tokens in one array; a window is named by the global index of its first token.
  const offsets = new Int32Array(sources.length + 1);
  for (let s = 0; s < sources.length; s++) offsets[s + 1] = offsets[s] + sources[s].tokens.ids.length;
  const total = offsets[sources.length];
  const ids = new Int32Array(total);
  for (let s = 0; s < sources.length; s++) ids.set(sources[s].tokens.ids, offsets[s]);

  // Hash table of stored windows: chains in insertion order, so the first match is the earliest.
  let size = 1;
  while (size < total * 2) size <<= 1;
  const mask = size - 1;
  const heads = new Int32Array(size).fill(-1);
  const tails = new Int32Array(size).fill(-1);
  const next = new Int32Array(Math.max(1, total)).fill(-1);
  const hashes = new Uint32Array(Math.max(1, total));

  const sameWindow = (a, b) => {
    for (let k = 0; k < w; k++) if (ids[a + k] !== ids[b + k]) return false;
    return true;
  };

  /** @type {Clone[]} */
  const clones = [];

  for (let s = 0; s < sources.length; s++) {
    const base = offsets[s];
    const end = offsets[s + 1];
    const lastWindow = end - w;
    if (lastWindow < base) continue;

    let open = false;
    let firstSource = 0;
    let firstStart = 0;
    let firstLast = 0;
    let secondStart = 0;
    let secondLast = 0;

    const close = () => {
      if (!open) return;
      open = false;
      const a = sources[firstSource].tokens;
      const b = sources[s].tokens;
      const aBase = offsets[firstSource];
      const aStart = firstStart - aBase;
      const aAfter = firstLast - aBase + w;
      const bStart = secondStart - base;
      const bAfter = secondLast - base + w;
      const first = { file: sources[firstSource].file, start: a.startLines[aStart], end: a.endLines[aAfter - 1] };
      const second = { file: sources[s].file, start: b.startLines[bStart], end: b.endLines[bAfter - 1] };
      if (first.end - first.start < minLines) {
        // Like jscpd, a clone just short of `minLines` still counts when the token after it
        // brings it there, and then both ends are reported at that next token.
        if (aAfter >= a.ids.length || a.endLines[aAfter] - first.start < minLines) return;
        first.end = a.endLines[aAfter];
        if (bAfter < b.ids.length) second.end = b.endLines[bAfter];
      }
      clones.push({ first, second, lines: first.end - first.start + 1, tokens: secondLast - secondStart + w });
    };

    let hash = 0;
    for (let k = 0; k < w; k++) hash = (Math.imul(hash, HASH_BASE) + tokenHash(ids[base + k])) >>> 0;

    for (let p = base; p <= lastWindow; p++) {
      if (p > base) {
        hash = (hash - Math.imul(tokenHash(ids[p - 1]), highPower)) >>> 0;
        hash = (Math.imul(hash, HASH_BASE) + tokenHash(ids[p + w - 1])) >>> 0;
      }
      const slot = (hash ^ (hash >>> 15)) & mask;

      const following = firstLast + 1;
      const followingStored = firstSource === s ? following < p : following <= offsets[firstSource + 1] - w;
      if (open && followingStored && sameWindow(following, p)) {
        firstLast = following;
        secondLast = p;
      } else {
        close();
        for (let q = heads[slot]; q !== -1; q = next[q]) {
          if (hashes[q] === hash && sameWindow(q, p)) {
            open = true;
            firstSource = sourceOf(offsets, q);
            firstStart = firstLast = q;
            secondStart = secondLast = p;
            break;
          }
        }
      }

      hashes[p] = hash;
      if (tails[slot] === -1) heads[slot] = p;
      else next[tails[slot]] = p;
      tails[slot] = p;
    }
    close();
  }
  return clones;
}

/** Index of the source holding global token `index`. @param {Int32Array} offsets @param {number} index */
function sourceOf(offsets, index) {
  let lo = 0;
  let hi = offsets.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Runs the whole check on a repository. Files with fewer than `minTokens` tokens cannot hold a
 * clone and, as in jscpd, are left out of the totals.
 *
 * @param {string} [root=repoRoot]
 */
export function runDuplicationCheck(root = repoRoot) {
  const config = loadConfig(root);
  const table = new TokenTable();
  let totalLines = 0;
  let totalTokens = 0;
  /** @type {{ file: string, tokens: TokenStream }[]} */
  const sources = [];
  for (const file of listFiles(root, config)) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    const tokens = tokenize(file, text, table);
    if (tokens.ids.length < config.minTokens) continue;
    totalLines += countLines(text);
    totalTokens += tokens.ids.length;
    sources.push({ file, tokens });
  }
  const clones = detectClones(sources, config);
  const duplicatedLines = clones.reduce((sum, clone) => sum + clone.first.end - clone.first.start, 0);
  const percentage = totalLines === 0 ? 0 : (duplicatedLines / totalLines) * 100;
  return {
    threshold: config.threshold,
    minLines: config.minLines,
    minTokens: config.minTokens,
    files: sources.length,
    totalLines,
    totalTokens,
    duplicatedLines,
    percentage,
    passed: percentage < config.threshold,
    clones,
  };
}

/**
 * @param {Clone} clone
 * @returns {string} `a.ts:12-30 ↔ b.ts:40-58`
 */
export function formatClone(clone) {
  return `${clone.first.file}:${clone.first.start}-${clone.first.end} ↔ ${clone.second.file}:${clone.second.start}-${clone.second.end}`;
}

function main() {
  const json = process.argv.includes('--json');
  const result = runDuplicationCheck(repoRoot);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const clone of result.clones) console.log(`  ${formatClone(clone)} (${clone.lines} lines, ${clone.tokens} tokens)`);
    console.log(
      `${result.clones.length} clones in ${result.files} files: ${result.duplicatedLines} of ${result.totalLines} lines duplicated (${result.percentage.toFixed(2)}%, limit ${result.threshold}%).`
    );
  }
  if (!result.passed) {
    console.error(
      `❌ Duplicated code is ${result.percentage.toFixed(2)}%, at or above the ${result.threshold}% limit in ${CONFIG_FILE}. Fix: move the repeated code listed above into one shared function or module and import it in both places.`
    );
    process.exit(1);
  }
  if (!json) console.log('✅ Code duplication check passed.');
}

if (isMain) main();
