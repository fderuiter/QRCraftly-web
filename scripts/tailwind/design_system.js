/**
 * Design-system snapshot for the `qrcraftly/tailwind-classes` ESLint rule (ADR 0046, #1194).
 *
 * ESLint rules run synchronously, but Tailwind v4 loads a design system asynchronously. This module
 * bridges the two: it loads the design system once through Tailwind's own API, asks it about a set of
 * class candidates, and writes the answers to a JSON snapshot keyed by a hash of the stylesheet and the
 * Tailwind version. The rule reads the snapshot, and when the key is stale or a class is missing it runs
 * this file as a short child process (see `requestSnapshot`).
 *
 * The snapshot holds, for every candidate it was asked about:
 * - `classes[candidate]`: the candidate's rank in Tailwind's official class order (`getClassOrder`),
 *   relative to every other known candidate. Candidates Tailwind does not know go to `unknown`.
 * - `utilities[utility]`: for the utility without variants or `!`, the CSS properties it sets
 *   (`props`, or `null` when its selector is not a plain class) and, for an arbitrary value with an
 *   equivalent theme token, that token (`canonical`).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execBinary } from '../utils/execHelper.js';

/** Bump when the snapshot layout changes. */
const SCHEMA_VERSION = 1;

export const DEFAULT_CSS_PATH = 'src/layouts/index.css';
export const DEFAULT_CACHE_FILE = 'node_modules/.cache/qrcraftly/tailwind.json';
/** Directories scanned for class candidates when a snapshot is built from scratch. */
export const DEFAULT_SEED_DIRS = ['src', 'tests', 'e2e', 'scripts'];

const SEED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SEED_SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', 'fixtures', '.git']);
const SCRIPT_PATH = fileURLToPath(import.meta.url);

/**
 * Arbitrary values checked for a token equivalent: a single number or length (`p-[8px]`, `z-[10]`,
 * `w-[100%]`). Compound values such as `grid-cols-[1fr_2fr]` are left alone.
 */
const SIMPLE_ARBITRARY = /^(?<negative>-?)(?<root>[a-z][a-z0-9-]*)-\[(?<value>-?(?:\d*\.)?\d+)(?<unit>px|rem|%)?\]$/;
/** Root font size used to compare `rem` and `px` values, as the old plugin did. */
const ROOT_FONT_PX = 16;

/** The parts of Tailwind's unstable design-system API the snapshot relies on. */
const REQUIRED_METHODS = ['getClassOrder', 'candidatesToAst', 'getClassList', 'resolveThemeValue'];

/**
 * Resolves the installed Tailwind package (the one this module imports).
 * @returns {{ dir: string, version: string }} Package directory and version.
 */
function resolveTailwind() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve('tailwindcss/package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return { dir: path.dirname(manifestPath), version: String(manifest.version) };
}

/**
 * Computes the cache key for a stylesheet: a hash of its contents, the Tailwind version and this
 * generator's own source, so a change to any of them rebuilds the snapshot.
 * @param {string} cssFile Absolute path of the stylesheet.
 * @returns {string} Hex SHA-256 key.
 */
export function snapshotKey(cssFile) {
  const { version } = resolveTailwind();
  const css = fs.readFileSync(cssFile, 'utf8').replace(/\r\n/g, '\n');
  const generator = fs.readFileSync(SCRIPT_PATH, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(`${SCHEMA_VERSION}\0${version}\0${css}\0${generator}`).digest('hex');
}

/**
 * Reads a snapshot from disk.
 * @param {string} cacheFile Absolute path of the snapshot.
 * @returns {object | null} The snapshot, or `null` when it is missing or unreadable.
 */
export function readSnapshot(cacheFile) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Writes a snapshot atomically (temp file + rename), so parallel lint runs never read half a file.
 * @param {string} cacheFile Absolute path of the snapshot.
 * @param {object} snapshot The snapshot.
 */
function writeSnapshot(cacheFile, snapshot) {
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const tmp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(snapshot));
  fs.renameSync(tmp, cacheFile);
}

/**
 * Splits a class token into its variant prefix (with the trailing `:`) and the utility, honouring
 * brackets and parentheses so `[&:hover]:p-2` and `bg-[url(a:b)]` split correctly.
 * @param {string} token A class token.
 * @returns {[string, string]} `[variants, utility]`.
 */
export function splitVariants(token) {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '[' || ch === '(') depth++;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) cut = i;
  }
  return [token.slice(0, cut + 1), token.slice(cut + 1)];
}

/**
 * Strips the important marker (`!` before or after) from a utility.
 * @param {string} utility A utility without variants.
 * @returns {{ base: string, important: boolean, prefixed: boolean }} The bare utility and its marker.
 */
export function splitImportant(utility) {
  if (utility.length > 1 && utility.startsWith('!')) return { base: utility.slice(1), important: true, prefixed: true };
  if (utility.length > 1 && utility.endsWith('!')) return { base: utility.slice(0, -1), important: true, prefixed: false };
  return { base: utility, important: false, prefixed: false };
}

/**
 * Evaluates a CSS length expression (`calc(0.25rem * -2)`, `8px`, `100%`) to a number and unit, with
 * `rem` converted to `px`. Returns `null` for anything else.
 * @param {string} text CSS value with theme variables already substituted.
 * @returns {{ n: number, unit: string } | null} Quantity.
 */
function evaluateLength(text) {
  const tokens = text.replace(/calc\(/g, '(').match(/-?(?:\d*\.)?\d+(?:[a-z%]+)?|[()*/+]|-/g);
  if (!tokens || tokens.join('') !== text.replace(/calc\(/g, '(').replace(/\s+/g, '')) return null;
  let i = 0;
  const atom = () => {
    const token = tokens[i++];
    if (token === '(') {
      const value = sum();
      if (tokens[i++] !== ')') throw new Error('unbalanced');
      return value;
    }
    const match = /^(-?(?:\d*\.)?\d+)([a-z%]*)$/.exec(token ?? '');
    if (!match) throw new Error('not a number');
    const n = Number(match[1]);
    return match[2] === 'rem' ? { n: n * ROOT_FONT_PX, unit: 'px' } : { n, unit: match[2] };
  };
  const product = () => {
    let left = atom();
    while (tokens[i] === '*' || tokens[i] === '/') {
      const op = tokens[i++];
      const right = atom();
      if (op === '*' && left.unit && right.unit) throw new Error('unit * unit');
      if (op === '/' && right.unit) throw new Error('divide by unit');
      left = op === '*' ? { n: left.n * right.n, unit: left.unit || right.unit } : { n: left.n / right.n, unit: left.unit };
    }
    return left;
  };
  const sum = () => {
    let left = product();
    while (tokens[i] === '+' || tokens[i] === '-') {
      const op = tokens[i++];
      const right = product();
      if (left.unit !== right.unit) throw new Error('mixed units');
      left = { n: op === '+' ? left.n + right.n : left.n - right.n, unit: left.unit };
    }
    return left;
  };
  try {
    const value = sum();
    return i === tokens.length && Number.isFinite(value.n) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Normalises a declaration value: theme variables replaced by their values, lengths evaluated.
 * @param {object} designSystem Tailwind design system.
 * @param {string} value CSS value.
 * @returns {string} Comparable value.
 */
function normaliseValue(designSystem, value) {
  let text = value;
  for (let depth = 0; depth < 5 && text.includes('var(--'); depth++) {
    text = text.replace(/var\((--[\w-]+)\)/g, (whole, name) => designSystem.resolveThemeValue(name) ?? whole);
  }
  const length = evaluateLength(text.trim());
  return length ? `${Math.round(length.n * 1e6) / 1e6}${length.unit}` : text.replace(/\s+/g, ' ').trim();
}

/**
 * The declarations a utility sets on its own rule, normalised for comparison.
 * @param {object} designSystem Tailwind design system.
 * @param {Array<{kind: string, property?: string, value?: string, nodes?: unknown[]}>} ast Utility AST.
 * @returns {string} Comparable signature (`prop:value;...`), or `''`.
 */
function declarationSignature(designSystem, ast) {
  const out = [];
  for (const node of ast) {
    if (node.kind !== 'rule') continue;
    for (const decl of node.nodes ?? []) {
      if (decl.kind === 'declaration') out.push(`${decl.property}:${normaliseValue(designSystem, decl.value ?? '')}`);
    }
  }
  return out.sort().join(';');
}

/**
 * Finds a theme token that gives the same CSS as a simple arbitrary value: a whole or half step on
 * the spacing scale (`p-[8px]` → `p-2`, `p-[2px]` → `p-0.5`), a bare number (`z-[10]` → `z-10`), `px`, or a named key
 * (`w-[100%]` → `w-full`).
 * @param {object} designSystem Tailwind design system.
 * @param {string[]} bases Arbitrary-value utilities matching `SIMPLE_ARBITRARY`.
 * @returns {Map<string, string>} Utility → equivalent token.
 */
function findTokenEquivalents(designSystem, bases) {
  const result = new Map();
  if (bases.length === 0) return result;
  const spacing = evaluateLength(designSystem.resolveThemeValue('--spacing') ?? '');
  const named = new Map();
  for (const [name] of designSystem.getClassList()) {
    const dash = name.lastIndexOf('-');
    if (dash <= 0 || /\d/.test(name.slice(dash + 1))) continue;
    const root = name.slice(0, dash);
    if (!named.has(root)) named.set(root, []);
    named.get(root).push(name);
  }
  const options = new Map();
  for (const base of bases) {
    const { negative, root, value, unit = '' } = SIMPLE_ARBITRARY.exec(base).groups;
    const prefix = `${negative}${root}`;
    const list = [];
    const quantity = evaluateLength(`${value}${unit}`);
    if (quantity && spacing && spacing.unit === quantity.unit && quantity.unit === 'px') {
      const steps = quantity.n / spacing.n;
      // Whole steps, plus the classic half steps 0.5 to 3.5; `w-[17px]` is not `w-4.25`.
      if (steps >= 0 && (Number.isInteger(steps) || (steps < 4 && Number.isInteger(steps * 2)))) list.push(`${prefix}-${steps}`);
    }
    if (!unit && !value.startsWith('-')) list.push(`${prefix}-${value}`);
    if (quantity?.unit === 'px' && quantity.n === 1) list.push(`${prefix}-px`);
    list.push(...(named.get(prefix) ?? []));
    options.set(base, list);
  }
  const everything = [...new Set([...bases, ...[...options.values()].flat()])];
  const signatures = new Map();
  designSystem.candidatesToAst(everything).forEach((ast, i) => signatures.set(everything[i], declarationSignature(designSystem, ast ?? [])));
  for (const base of bases) {
    const target = signatures.get(base);
    if (!target) continue;
    const match = options.get(base).find((option) => option !== base && signatures.get(option) === target);
    if (match) result.set(base, match);
  }
  return result;
}

/**
 * Collects the CSS properties a compiled utility sets.
 * @param {Array<{kind: string, selector?: string, name?: string, property?: string, nodes?: unknown[]}>} ast
 *   Tailwind AST nodes of one utility.
 * @param {string} base The utility, used to recognise its own class selector.
 * @returns {string[] | null} Sorted property names, or `null` when a selector is more than the class.
 */
function collectProperties(ast, base) {
  const props = new Set();
  let simple = true;
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.kind === 'declaration' && node.property) props.add(node.property);
      else if (node.kind === 'rule') {
        if (/::|\s|>|~|\+/.test(node.selector ?? '')) simple = false;
        walk(node.nodes ?? []);
      } else if (node.kind === 'at-rule' && node.name !== '@property' && node.name !== '@keyframes') {
        walk(node.nodes ?? []);
      }
    }
  };
  walk(ast);
  if (!simple || props.size === 0 || base.length === 0) return null;
  return [...props].sort();
}

/**
 * Resolves an `@import` id to a stylesheet on disk.
 * @param {string} id The import id (`tailwindcss`, `tailwindcss/theme.css`, `./x.css`).
 * @param {string} base The importing file's directory.
 * @returns {string} Absolute path.
 */
function resolveStylesheet(id, base) {
  if (id.startsWith('.') || path.isAbsolute(id)) return path.resolve(base, id);
  const parts = id.split('/');
  const name = id.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const sub = id.slice(name.length + 1);
  const require = createRequire(path.join(base, 'noop.js'));
  const pkgDir = path.dirname(require.resolve(`${name}/package.json`));
  if (sub) return path.join(pkgDir, sub);
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  return path.join(pkgDir, manifest.style ?? 'index.css');
}

/**
 * Loads the Tailwind design system for a stylesheet. Fails loudly when the unstable API moved.
 * @param {string} cssFile Absolute path of the stylesheet.
 * @returns {Promise<object>} The design system.
 */
async function loadDesignSystem(cssFile) {
  const { dir, version } = resolveTailwind();
  const tailwind = await import('tailwindcss');
  const load = tailwind.__unstable__loadDesignSystem;
  if (typeof load !== 'function') {
    throw new Error(
      `tailwindcss ${version} (${dir}) no longer exports __unstable__loadDesignSystem. ` +
        'Update scripts/tailwind/design_system.js for the new API (see docs/adr/0046-own-tailwind-class-rule.md).'
    );
  }
  const css = fs.readFileSync(cssFile, 'utf8');
  const designSystem = await load(css, {
    base: path.dirname(cssFile),
    async loadStylesheet(id, base) {
      const file = resolveStylesheet(id, base);
      return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
    },
    async loadModule(id) {
      throw new Error(`The Tailwind snapshot does not load JavaScript plugins or configs (${id}).`);
    },
  });
  const missing = REQUIRED_METHODS.filter((name) => typeof designSystem?.[name] !== 'function');
  if (missing.length > 0) {
    throw new Error(
      `tailwindcss ${version}: the design system no longer has ${missing.join(', ')}. ` +
        'Update scripts/tailwind/design_system.js for the new API (see docs/adr/0046-own-tailwind-class-rule.md).'
    );
  }
  return designSystem;
}

/**
 * Extracts candidate class strings from source files: the contents of every string literal, split on
 * whitespace. Used to seed a fresh snapshot so a cold lint run does not spawn one child per file.
 * @param {string} cwd Repository root.
 * @param {string[]} dirs Directories (relative to `cwd`) to scan.
 * @returns {string[][]} Token lists, one per string literal.
 */
export function seedStrings(cwd, dirs) {
  const lists = [];
  const literal = /"((?:[^"\\\r\n]|\\.)*)"|'((?:[^'\\\r\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SEED_SKIP_DIRS.has(entry.name)) visit(full);
      } else if (SEED_EXTENSIONS.has(path.extname(entry.name))) {
        const text = fs.readFileSync(full, 'utf8');
        for (const match of text.matchAll(literal)) {
          const body = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ' ');
          const tokens = body.split(/\s+/).filter((t) => t.length > 0 && t.length <= 120);
          if (tokens.length > 0) lists.push(tokens);
        }
      }
    }
  };
  for (const dir of dirs) visit(path.resolve(cwd, dir));
  return lists;
}

/**
 * Builds a snapshot for the given candidates.
 * @param {object} options Build options.
 * @param {string} options.cssFile Absolute path of the stylesheet.
 * @param {string[]} options.candidates Candidates the caller needs answers for (kept as unknown when invalid).
 * @param {string[][]} [options.seed] Token lists from source; unknown tokens are kept only from lists
 *   that hold at least one Tailwind class.
 * @param {Record<string, { props: string[] | null, canonical?: string }>} [options.previous] Utility
 *   entries from a current snapshot. They do not depend on other candidates, so they are reused.
 * @returns {Promise<object>} The snapshot.
 */
export async function buildSnapshot({ cssFile, candidates, seed = [], previous = {} }) {
  const designSystem = await loadDesignSystem(cssFile);
  const requested = new Set(candidates);
  const all = new Set(candidates);
  for (const list of seed) for (const token of list) all.add(token);

  const order = designSystem.getClassOrder([...all]);
  const ranked = order.filter(([, rank]) => rank !== null).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const classes = {};
  ranked.forEach(([token], index) => {
    classes[token] = index;
  });

  const unknown = new Set([...requested].filter((token) => !(token in classes)));
  for (const list of seed) {
    if (list.some((token) => token in classes)) for (const token of list) if (!(token in classes)) unknown.add(token);
  }

  const bases = [...new Set(Object.keys(classes).map((token) => splitImportant(splitVariants(token)[1]).base))];
  const utilities = {};
  const fresh = bases.filter((base) => {
    if (!Object.hasOwn(previous, base)) return true;
    utilities[base] = previous[base];
    return false;
  });
  const asts = designSystem.candidatesToAst(fresh);
  const equivalents = findTokenEquivalents(designSystem, fresh.filter((base) => SIMPLE_ARBITRARY.test(base)));
  fresh.forEach((base, i) => {
    const entry = { props: collectProperties(asts[i] ?? [], base) };
    if (equivalents.has(base)) entry.canonical = equivalents.get(base);
    utilities[base] = entry;
  });

  return {
    schema: SCHEMA_VERSION,
    key: snapshotKey(cssFile),
    tailwind: resolveTailwind().version,
    classes,
    unknown: [...unknown].sort(),
    utilities,
  };
}

/**
 * Synchronously (re)builds the snapshot in a child process and returns it. Called by the ESLint rule
 * when the cached snapshot is stale or lacks a candidate.
 * @param {object} request Build request.
 * @param {string} request.cssFile Absolute path of the stylesheet.
 * @param {string} request.cacheFile Absolute path of the snapshot.
 * @param {string} request.cwd Repository root.
 * @param {string[]} request.candidates Candidates to include (merged with the cached ones when fresh).
 * @param {string[]} request.seedDirs Directories to scan when the snapshot is built from scratch.
 * @returns {object} The new snapshot.
 */
export function requestSnapshot(request) {
  let output;
  try {
    output = execBinary(process.execPath, [SCRIPT_PATH], {
      cwd: request.cwd,
      input: JSON.stringify(request),
      maxBuffer: 256 * 1024 * 1024,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    throw new Error(`Could not build the Tailwind class snapshot (scripts/tailwind/design_system.js):\n${stderr || String(error)}`);
  }
  return JSON.parse(output);
}

/**
 * Child-process entry: reads a request from stdin, builds and caches the snapshot, prints it.
 */
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const { cssFile, cacheFile, cwd, seedDirs = [] } = request;
  const key = snapshotKey(cssFile);
  const cached = readSnapshot(cacheFile);
  const candidates = new Set(request.candidates);
  let seed = [];
  let previous = {};
  if (cached && cached.key === key) {
    previous = cached.utilities ?? {};
    for (const token of Object.keys(cached.classes ?? {})) candidates.add(token);
    for (const token of cached.unknown ?? []) candidates.add(token);
  } else {
    seed = seedStrings(cwd, seedDirs);
  }
  const snapshot = await buildSnapshot({ cssFile, candidates: [...candidates], seed, previous });
  writeSnapshot(cacheFile, snapshot);
  process.stdout.write(JSON.stringify(snapshot));
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
