/**
 * `qrcraftly/tailwind-classes`: our own Tailwind class checks (ADR 0046, #1194).
 *
 * Checks the static class lists in `className` / `class` attributes and in calls to the configured
 * callees (`mergeClasses`, `clsx`, ...), including the static parts of template literals:
 * - order: Tailwind's official class order (`getClassOrder`), unknown classes first;
 * - duplicates: removed;
 * - important: `!p-2` is written `p-2!` in Tailwind v4;
 * - negative arbitrary: `-top-[5px]` is written `top-[-5px]`;
 * - unnecessary arbitrary: `p-[8px]` is written `p-2` when a theme token gives the same CSS;
 * - shorthand: `px-2 py-2` is `p-2`, `w-4 h-4` is `size-4`;
 * - contradicting: two classes set the same CSS properties under the same variants (no auto-fix).
 *
 * Custom and unknown classes are never reported. The Tailwind data comes from the snapshot built by
 * `scripts/tailwind/design_system.js`; a stale or incomplete snapshot is rebuilt in a short child process.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CACHE_FILE,
  DEFAULT_CSS_PATH,
  DEFAULT_SEED_DIRS,
  readSnapshot,
  requestSnapshot,
  snapshotKey,
  splitImportant,
  splitVariants,
} from '../../scripts/tailwind/design_system.js';

export const DEFAULT_CALLEES = ['classnames', 'clsx', 'ctl', 'mergeClasses'];
const CLASS_ATTRIBUTES = new Set(['className', 'class']);

/**
 * Longhand-to-shorthand families (from eslint-plugin-tailwindcss `enforces-shorthand`). Each strategy
 * maps a shorthand prefix to the sets of longhand prefixes it replaces.
 */
const SHORTHAND_FAMILIES = [
  { pattern: /^(?<negative>)(?<prefix>p[xytbrlse]?|p(?:bs|be))-(?<value>.+)$/, strategies: { px: [['pl', 'pr'], ['ps', 'pe']], py: [['pt', 'pb'], ['pbs', 'pbe']], p: [['px', 'py']] } },
  { pattern: /^(?<negative>-?)(?<prefix>m[xytbrlse]?|m(?:bs|be))-(?<value>.+)$/, strategies: { mx: [['ml', 'mr'], ['ms', 'me']], my: [['mt', 'mb'], ['mbs', 'mbe']], m: [['mx', 'my']] } },
  { pattern: /^(?<negative>-?)(?<prefix>inset(?:-[xy])?|top|right|bottom|left)-(?<value>.+)$/, strategies: { 'inset-x': [['right', 'left']], 'inset-y': [['top', 'bottom']], inset: [['inset-x', 'inset-y']] } },
  { pattern: /^(?<negative>)(?<prefix>gap(?:-[xy])?)-(?<value>.+)$/, strategies: { gap: [['gap-x', 'gap-y']] } },
  { pattern: /^(?<negative>)(?<prefix>w|h)-(?<value>.+)$/, strategies: { size: [['w', 'h']] } },
  { pattern: /^(?<negative>)(?<prefix>border-[xytbrlse]|border-(?:bs|be))(?:-(?<value>.+))?$/, strategies: { 'border-y': [['border-t', 'border-b'], ['border-bs', 'border-be']], 'border-x': [['border-l', 'border-r'], ['border-s', 'border-e']], border: [['border-x', 'border-y']] } },
  { pattern: /^(?<negative>)(?<prefix>border-spacing-[xy])-(?<value>.+)$/, strategies: { 'border-spacing': [['border-spacing-x', 'border-spacing-y']] } },
  { pattern: /^(?<negative>-?)(?<prefix>rounded(?:-(?:ss|se|ee|es|tl|tr|br|bl|[stbrl]))?)-(?<value>[^-]+)$/, strategies: { 'rounded-t': [['rounded-tl', 'rounded-tr'], ['rounded-ss', 'rounded-se']], 'rounded-r': [['rounded-tr', 'rounded-br']], 'rounded-b': [['rounded-bl', 'rounded-br'], ['rounded-ee', 'rounded-es']], 'rounded-l': [['rounded-tl', 'rounded-bl']], rounded: [['rounded-t', 'rounded-b'], ['rounded-l', 'rounded-r'], ['rounded-s', 'rounded-e']] } },
  { pattern: /^(?<negative>)(?<prefix>overflow-[xy])-(?<value>auto|hidden|clip|visible|scroll)$/, strategies: { overflow: [['overflow-x', 'overflow-y']] } },
  { pattern: /^(?<negative>)(?<prefix>overscroll-[xy])-(?<value>auto|contain|none)$/, strategies: { overscroll: [['overscroll-x', 'overscroll-y']] } },
  { pattern: /^(?<negative>-?)(?<prefix>scale-[xy])-(?<value>.+)$/, strategies: { scale: [['scale-x', 'scale-y']] } },
  { pattern: /^(?<negative>-?)(?<prefix>skew-[xy])-(?<value>.+)$/, strategies: { skew: [['skew-x', 'skew-y']] } },
  { pattern: /^(?<negative>-?)(?<prefix>translate-[xy])-(?<value>.+)$/, strategies: { translate: [['translate-x', 'translate-y']] } },
  { pattern: /^(?<negative>-?)(?<prefix>scroll-m[xytbrlse]?|scroll-m(?:bs|be))-(?<value>.+)$/, strategies: { 'scroll-mx': [['scroll-ml', 'scroll-mr'], ['scroll-ms', 'scroll-me']], 'scroll-my': [['scroll-mt', 'scroll-mb'], ['scroll-mbs', 'scroll-mbe']], 'scroll-m': [['scroll-mx', 'scroll-my']] } },
  { pattern: /^(?<negative>)(?<prefix>scroll-p[xytbrlse]?|scroll-p(?:bs|be))-(?<value>.+)$/, strategies: { 'scroll-px': [['scroll-pl', 'scroll-pr'], ['scroll-ps', 'scroll-pe']], 'scroll-py': [['scroll-pt', 'scroll-pb'], ['scroll-pbs', 'scroll-pbe']], 'scroll-p': [['scroll-px', 'scroll-py']] } },
  { pattern: /^(?<negative>)(?<prefix>overflow-hidden|text-ellipsis|whitespace-nowrap)(?<value>)$/, strategies: { truncate: [['overflow-hidden', 'text-ellipsis', 'whitespace-nowrap']] } },
];

/** Utilities whose negative arbitrary form moves the minus into the value. */
const NEGATIVE_ARBITRARY = new RegExp(
  `^-(?<property>${[
    '(?:inset|scale)(?:-[xy])?',
    'm[xytbrlse]?',
    'top',
    'right',
    'bottom',
    'left',
    'z',
    'order',
    'tracking',
    'indent',
    '(?:backdrop-)?hue-rotate',
    'space-[xy]',
    'scroll-m(?:[xyse]|bs|be|t|r|b|l)?',
    '(?:skew|translate|rotate)(?:-[xyz])?',
  ].join('|')})-\\[(?<value>[^\\]]+)\\]$`
);

/** Per-process snapshot memo, keyed by cache file. */
const memo = new Map();

/**
 * Returns a snapshot that is current for the stylesheet and knows every candidate, rebuilding it in a
 * child process when needed.
 * @param {{ cssFile: string, cacheFile: string, cwd: string, seedDirs: string[] }} target Snapshot location.
 * @param {Iterable<string>} candidates Candidates the caller needs.
 * @returns {{ classes: Record<string, number>, unknownSet: Set<string>, utilities: Record<string, { props: string[] | null, canonical?: string }> }} Snapshot.
 */
function loadSnapshot(target, candidates) {
  const stat = fs.statSync(target.cssFile);
  const stamp = `${stat.mtimeMs}:${stat.size}`;
  let entry = memo.get(target.cacheFile);
  if (!entry || entry.stamp !== stamp || entry.cssFile !== target.cssFile) {
    const key = snapshotKey(target.cssFile);
    const raw = readSnapshot(target.cacheFile);
    entry = { stamp, cssFile: target.cssFile, key, snapshot: raw && raw.key === key ? prepare(raw) : null };
    memo.set(target.cacheFile, entry);
  }
  const missing = entry.snapshot ? [...candidates].filter((c) => !(c in entry.snapshot.classes) && !entry.snapshot.unknownSet.has(c)) : [...candidates];
  if (!entry.snapshot || missing.length > 0) {
    const built = requestSnapshot({ ...target, candidates: missing });
    if (built.key !== entry.key) {
      throw new Error(`The Tailwind class snapshot for ${target.cssFile} was built with a different key; is the stylesheet changing during lint?`);
    }
    entry.snapshot = prepare(built);
  }
  return entry.snapshot;
}

/**
 * Adds lookup structures to a raw snapshot.
 * @param {{ classes: Record<string, number>, unknown: string[], utilities: Record<string, { props: string[] | null, canonical?: string }> }} raw Raw snapshot.
 * @returns {{ classes: Record<string, number>, unknownSet: Set<string>, utilities: Record<string, { props: string[] | null, canonical?: string }> }} Snapshot.
 */
function prepare(raw) {
  const classes = Object.assign(Object.create(null), raw.classes);
  const utilities = Object.assign(Object.create(null), raw.utilities);
  return { classes, unknownSet: new Set(raw.unknown), utilities };
}

/**
 * Splits a class string into tokens and the whitespace around them.
 * @param {string} text Class string.
 * @returns {{ head: string, tokens: string[], gaps: string[], tail: string }} Parts.
 */
function tokenize(text) {
  const parts = text.split(/(\s+)/);
  const head = parts.length > 1 && parts[0] === '' ? parts[1] : '';
  const tail = parts.length > 1 && parts[parts.length - 1] === '' ? parts[parts.length - 2] : '';
  const tokens = [];
  const gaps = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i] !== '') tokens.push(parts[i]);
    } else if (i !== 1 || parts[0] !== '') {
      if (i !== parts.length - 2 || parts[parts.length - 1] !== '') gaps.push(parts[i]);
    }
  }
  return { head: tokens.length === 0 ? text : head, tokens, gaps, tail: tokens.length === 0 ? '' : tail };
}

/**
 * Joins tokens back, reusing the original whitespace between them.
 * @param {{ head: string, gaps: string[], tail: string }} layout Original layout.
 * @param {string[]} tokens New tokens.
 * @returns {string} Class string.
 */
function join(layout, tokens) {
  let out = layout.head;
  tokens.forEach((token, i) => {
    if (i > 0) out += layout.gaps[i - 1] ?? ' ';
    out += token;
  });
  return out + layout.tail;
}

/**
 * Parses a token into variants, utility and important marker.
 * @param {string} token Class token.
 * @returns {{ variants: string, base: string, important: boolean, prefixed: boolean }} Parts.
 */
function parse(token) {
  const [variants, utility] = splitVariants(token);
  return { variants, ...splitImportant(utility) };
}

/**
 * The single-token rewrites (important suffix, negative arbitrary, unnecessary arbitrary). Each returns
 * the replacement, or `undefined`.
 * @param {string} token Class token.
 * @param {ReturnType<typeof prepare> | null} snapshot Snapshot (`null` while collecting candidates).
 * @returns {{ kind: string, replacement: string } | undefined} Rewrite.
 */
function rewrite(token, snapshot) {
  const { variants, base, important, prefixed } = parse(token);
  const bang = important ? '!' : '';
  const canonical = snapshot?.utilities[base]?.canonical;
  if (canonical) return { kind: 'unnecessaryArbitrary', replacement: `${variants}${canonical}${bang}` };
  const negative = NEGATIVE_ARBITRARY.exec(base);
  if (negative?.groups) {
    const value = negative.groups.value.startsWith('-') ? negative.groups.value.slice(1) : `-${negative.groups.value}`;
    return { kind: 'negativeArbitrary', replacement: `${variants}${negative.groups.property}-[${value}]${bang}` };
  }
  if (prefixed) return { kind: 'important', replacement: `${variants}${base}!` };
  return undefined;
}

/**
 * Finds shorthand merges in a token list: groups by variants, important flag, sign and value, then
 * folds longhand sets into their shorthand until nothing changes.
 * @param {string[]} tokens Class tokens.
 * @returns {Array<{ longhands: string[], shorthand: string }>} Merges.
 */
function findShorthands(tokens) {
  const merges = [];
  for (const family of SHORTHAND_FAMILIES) {
    const groups = new Map();
    for (const token of tokens) {
      const { variants, base, important } = parse(token);
      const match = family.pattern.exec(base);
      if (!match?.groups) continue;
      const { negative = '', prefix, value = '' } = match.groups;
      const key = `${variants}\0${important}\0${negative}\0${value}`;
      if (!groups.has(key)) groups.set(key, { variants, important, negative, value, members: new Map() });
      groups.get(key).members.set(prefix, [token]);
    }
    for (const group of groups.values()) {
      let changed = true;
      while (changed) {
        changed = false;
        for (const [shorthand, alternatives] of Object.entries(family.strategies)) {
          if (group.members.has(shorthand)) continue;
          const hit = alternatives.find((set) => set.every((p) => group.members.has(p)));
          if (!hit) continue;
          const sources = hit.flatMap((p) => group.members.get(p));
          for (const p of hit) group.members.delete(p);
          group.members.set(shorthand, sources);
          const suffix = group.value ? `-${group.value}` : '';
          merges.push({ longhands: sources, shorthand: `${group.variants}${group.negative}${shorthand}${suffix}${group.important ? '!' : ''}` });
          changed = true;
        }
      }
    }
  }
  return merges;
}

/**
 * Keeps the merges whose shorthand Tailwind knows, dropping any merge another known merge subsumes
 * (`pl pr pt pb` reports `p`, not also `px` and `py`).
 * @param {string[]} tokens Known class tokens.
 * @param {ReturnType<typeof prepare>} snapshot Snapshot.
 * @returns {Array<{ longhands: string[], shorthand: string }>} Merges to report or apply.
 */
function knownShorthands(tokens, snapshot) {
  const merges = findShorthands(tokens).filter((m) => m.shorthand in snapshot.classes);
  return merges.filter(
    (m) => !merges.some((other) => other.longhands.length > m.longhands.length && m.longhands.every((t) => other.longhands.includes(t)))
  );
}

/**
 * Derives the candidates a check may need to validate, so one snapshot request covers them.
 * @param {string[]} tokens Class tokens.
 * @returns {string[]} Extra candidates.
 */
function derivedCandidates(tokens) {
  const extra = [];
  for (const token of tokens) {
    const result = rewrite(token, null);
    if (result) extra.push(result.replacement);
  }
  for (const merge of findShorthands(tokens)) extra.push(merge.shorthand);
  return extra;
}

/**
 * Applies every auto-fix to a token list and sorts it in Tailwind's official order.
 * @param {string[]} tokens Class tokens.
 * @param {ReturnType<typeof prepare>} snapshot Snapshot.
 * @returns {string[]} Fixed tokens.
 */
export function fixTokens(tokens, snapshot) {
  const known = (t) => t in snapshot.classes;
  let out = tokens.map((token) => {
    if (!known(token)) return token;
    const result = rewrite(token, snapshot);
    return result && known(result.replacement) ? result.replacement : token;
  });
  out = [...new Set(out)];
  let merges = knownShorthands(out.filter(known), snapshot);
  while (merges.length > 0) {
    const [merge] = merges;
    const at = out.indexOf(merge.longhands[0]);
    out = out.filter((t) => !merge.longhands.includes(t));
    out.splice(Math.min(at, out.length), 0, merge.shorthand);
    out = [...new Set(out)];
    merges = knownShorthands(out.filter(known), snapshot);
  }
  return sortTokens(out, snapshot);
}

/**
 * Sorts tokens in Tailwind's official order; unknown classes keep their relative order, first.
 * @param {string[]} tokens Class tokens.
 * @param {ReturnType<typeof prepare>} snapshot Snapshot.
 * @returns {string[]} Sorted tokens.
 */
function sortTokens(tokens, snapshot) {
  const unknown = tokens.filter((t) => !(t in snapshot.classes));
  const known = tokens.filter((t) => t in snapshot.classes).sort((a, b) => snapshot.classes[a] - snapshot.classes[b]);
  return [...unknown, ...known];
}

/**
 * Finds groups of known classes that set the same CSS properties under the same variants.
 * @param {string[]} tokens Class tokens (deduplicated).
 * @param {ReturnType<typeof prepare>} snapshot Snapshot.
 * @returns {string[][]} Conflicting groups.
 */
function findContradictions(tokens, snapshot) {
  const groups = new Map();
  for (const token of tokens) {
    if (!(token in snapshot.classes)) continue;
    const { variants, base } = parse(token);
    const props = snapshot.utilities[base]?.props;
    if (!props) continue;
    const key = `${variants}\0${props.join(',')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(token);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * Collects the string pieces holding classes under an expression.
 * @param {import('estree').Node} node Expression.
 * @param {Array<import('estree').Node>} out Collected `Literal` and `TemplateElement` nodes.
 */
function collect(node, out) {
  if (!node) return;
  switch (node.type) {
    case 'Literal':
      if (typeof node.value === 'string' && node.value !== '') out.push(node);
      break;
    case 'TemplateLiteral':
      node.quasis.forEach((quasi, i) => {
        out.push(quasi);
        if (node.expressions[i]) collect(node.expressions[i], out);
      });
      break;
    case 'ConditionalExpression':
      collect(node.consequent, out);
      collect(node.alternate, out);
      break;
    case 'LogicalExpression':
      collect(node.right, out);
      break;
    case 'ArrayExpression':
      for (const element of node.elements) collect(element, out);
      break;
    case 'ObjectExpression':
      for (const property of node.properties) {
        if (property.type === 'Property' && property.key.type === 'Literal') collect(property.key, out);
      }
      break;
    case 'JSXExpressionContainer':
      collect(node.expression, out);
      break;
    default:
      break;
  }
}

/**
 * Returns the name a call or tagged template is made through (`clsx(...)`, `utils.clsx(...)`).
 * @param {import('estree').Node} callee Callee or tag.
 * @returns {string} Name, or `''`.
 */
function calleeName(callee) {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') return callee.property.name;
  return '';
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: { description: "Keep Tailwind classes in Tailwind's official order, without duplicates, contradictions or needless longhands and arbitrary values." },
    schema: [
      {
        type: 'object',
        properties: {
          cssPath: { type: 'string' },
          cacheFile: { type: 'string' },
          callees: { type: 'array', items: { type: 'string' } },
          seedDirs: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      order: "Classes are not in Tailwind's official order.",
      duplicate: "Duplicate class '{{className}}'.",
      important: "Write '{{className}}' as '{{replacement}}' (Tailwind v4 puts '!' at the end).",
      negativeArbitrary: "Write '{{className}}' as '{{replacement}}'.",
      unnecessaryArbitrary: "No need for arbitrary '{{className}}'; use '{{replacement}}'.",
      shorthand: "'{{longhands}}' can be merged into '{{replacement}}'.",
      contradicting: "'{{className}}' conflicts with {{others}}.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {};
    const cwd = context.cwd;
    const target = {
      cwd,
      cssFile: path.resolve(cwd, options.cssPath ?? DEFAULT_CSS_PATH),
      cacheFile: path.resolve(cwd, options.cacheFile ?? DEFAULT_CACHE_FILE),
      seedDirs: options.seedDirs ?? DEFAULT_SEED_DIRS,
    };
    const callees = new Set(options.callees ?? DEFAULT_CALLEES);
    const sourceCode = context.sourceCode;
    /** @type {Array<import('estree').Node>} */
    const pieces = [];
    const seen = new Set();
    const add = (list) => {
      for (const node of list) {
        if (!seen.has(node)) {
          seen.add(node);
          pieces.push(node);
        }
      }
    };

    return {
      JSXAttribute(node) {
        const name = node.name.type === 'JSXIdentifier' ? node.name.name : '';
        if (!CLASS_ATTRIBUTES.has(name) || !node.value) return;
        const out = [];
        if (node.value.type === 'JSXExpressionContainer' && node.value.expression.type === 'CallExpression') return;
        collect(node.value, out);
        add(out);
      },
      CallExpression(node) {
        if (!callees.has(calleeName(node.callee))) return;
        const out = [];
        for (const argument of node.arguments) collect(argument, out);
        add(out);
      },
      TaggedTemplateExpression(node) {
        if (!callees.has(calleeName(node.tag))) return;
        const out = [];
        collect(node.quasi, out);
        add(out);
      },
      'Program:exit'() {
        if (pieces.length === 0) return;
        const entries = pieces.map((node) => describe(node, sourceCode)).filter((entry) => entry.tokens.length > 0);
        if (entries.length === 0) return;
        const needed = new Set();
        for (const entry of entries) {
          for (const token of entry.tokens) needed.add(token);
          for (const token of derivedCandidates(entry.tokens)) needed.add(token);
        }
        let snapshot = loadSnapshot(target, needed);
        // Token equivalents of arbitrary values are only known once the snapshot is: ask for those too.
        const replacements = [];
        for (const token of needed) {
          const result = token in snapshot.classes ? rewrite(token, snapshot) : undefined;
          if (result) replacements.push(result.replacement);
        }
        snapshot = loadSnapshot(target, replacements);
        for (const entry of entries) check(context, entry, snapshot);
      },
    };
  },
};

/**
 * Describes one string piece: its editable range, layout and the tokens the rule may move. In a
 * template literal, a token glued to an interpolation (`bg-${tone}`) is pinned in place.
 * @param {import('estree').Node} node `Literal` or `TemplateElement`.
 * @param {import('eslint').SourceCode} sourceCode Source.
 * @returns {{ node: import('estree').Node, start: number, layout: ReturnType<typeof tokenize>, tokens: string[], pinnedHead: string[], pinnedTail: string[] }} Piece.
 */
function describe(node, sourceCode) {
  const [from, to] = node.range;
  const start = from + 1;
  let end = to - 1;
  let pinHead = false;
  let pinTail = false;
  if (node.type === 'TemplateElement') {
    const parent = node.parent;
    const index = parent.quasis.indexOf(node);
    end = node.tail ? to - 1 : to - 2;
    const raw = sourceCode.text.slice(start, end);
    pinHead = index > 0 && !/^\s/.test(raw);
    pinTail = !node.tail && !/\s$/.test(raw);
  }
  const text = sourceCode.text.slice(start, end);
  const layout = tokenize(text);
  let tokens = layout.tokens;
  const pinnedHead = pinHead && tokens.length > 0 ? [tokens[0]] : [];
  tokens = tokens.slice(pinnedHead.length);
  const pinnedTail = pinTail && tokens.length > 0 ? [tokens[tokens.length - 1]] : [];
  tokens = tokens.slice(0, tokens.length - pinnedTail.length);
  return { node, start, end, layout, tokens: tokens.filter((t) => !t.includes('${')), pinnedHead, pinnedTail, all: layout.tokens };
}

/**
 * Runs every check on one piece and reports problems, each carrying the full fix for the piece.
 * @param {import('eslint').Rule.RuleContext} context Rule context.
 * @param {ReturnType<typeof describe>} entry Piece.
 * @param {ReturnType<typeof prepare>} snapshot Snapshot.
 */
function check(context, entry, snapshot) {
  const { node, tokens } = entry;
  if (tokens.length !== entry.all.length - entry.pinnedHead.length - entry.pinnedTail.length) return;
  const fixed = fixTokens(tokens, snapshot);
  const next = join(entry.layout, [...entry.pinnedHead, ...fixed, ...entry.pinnedTail]);
  const current = context.sourceCode.text.slice(entry.start, entry.end);
  const fix = next === current ? undefined : (fixer) => fixer.replaceTextRange([entry.start, entry.end], next);
  const report = (messageId, data) => context.report({ node, messageId, data, fix });
  const known = (t) => t in snapshot.classes;
  let reported = false;

  const seenTokens = new Set();
  for (const token of tokens) {
    if (seenTokens.has(token)) {
      report('duplicate', { className: token });
      reported = true;
    }
    seenTokens.add(token);
  }
  for (const token of seenTokens) {
    if (!known(token)) continue;
    const result = rewrite(token, snapshot);
    if (result && known(result.replacement)) {
      report(result.kind, { className: token, replacement: result.replacement });
      reported = true;
    }
  }
  for (const merge of knownShorthands([...seenTokens].filter(known), snapshot)) {
    report('shorthand', { longhands: merge.longhands.join(' '), replacement: merge.shorthand });
    reported = true;
  }
  for (const group of findContradictions([...seenTokens], snapshot)) {
    for (const token of group) {
      const others = group.filter((t) => t !== token).map((t) => `'${t}'`).join(', ');
      context.report({ node, messageId: 'contradicting', data: { className: token, others } });
    }
  }
  if (!reported && fix) report('order', {});
}

export default rule;
