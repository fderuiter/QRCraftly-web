/**
 * A small parser for JavaScript regular expression sources, just deep enough to
 * find patterns that can backtrack catastrophically (ReDoS). Used by the
 * `qrcraftly/no-unsafe-regex` rule (GitHub issue #1193) instead of `safe-regex`.
 *
 * It flags two shapes:
 * - star height above one: an unbounded quantifier applied to something that
 *   already contains one, such as `(a+)+` or `(\w*)*`;
 * - an unbounded quantifier on an alternation whose branches can start with the
 *   same character, such as `(a|a)*` or `(\d|\w)+`.
 */

const INFINITY = Number.POSITIVE_INFINITY;

/**
 * @typedef {{ kind: 'char', set: (code: number) => boolean }} CharNode
 * @typedef {{ kind: 'group', branches: Node[][], lookaround: boolean }} GroupNode
 * @typedef {{ kind: 'empty' }} EmptyNode
 * @typedef {(CharNode | GroupNode | EmptyNode) & { min: number, max: number }} Node
 */

/** @param {number} code */
const isDigit = code => code >= 48 && code <= 57;
/** @param {number} code */
const isWord = code => isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
/** @param {number} code */
const isSpace = code => code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0xfeff || code === 0x2028 || code === 0x2029;
const ANY = () => true;

/**
 * The character set of an escape such as `\d`, `\n` or `\.`.
 * @param {string} ch the character after the backslash
 * @returns {(code: number) => boolean}
 */
function escapeSet(ch) {
  switch (ch) {
    case 'd': return isDigit;
    case 'D': return code => !isDigit(code);
    case 'w': return isWord;
    case 'W': return code => !isWord(code);
    case 's': return isSpace;
    case 'S': return code => !isSpace(code);
    case 'n': return code => code === 10;
    case 'r': return code => code === 13;
    case 't': return code => code === 9;
    case 'f': return code => code === 12;
    case 'v': return code => code === 11;
    case 'p':
    case 'P': return ANY;
    default: {
      const code = ch.charCodeAt(0);
      return other => other === code;
    }
  }
}

/**
 * Parses a regular expression source into a tree.
 * @param {string} source
 * @returns {Node[][]} the top-level branches
 */
export function parseRegex(source) {
  let pos = 0;

  /** @returns {Node[][]} */
  function parseAlternation() {
    /** @type {Node[][]} */
    const branches = [[]];
    while (pos < source.length && source[pos] !== ')') {
      if (source[pos] === '|') {
        branches.push([]);
        pos++;
        continue;
      }
      const atom = parseAtom();
      if (atom) branches[branches.length - 1].push(applyQuantifier(atom));
    }
    return branches;
  }

  /** @returns {Omit<Node, 'min' | 'max'> | null} */
  function parseAtom() {
    const ch = source[pos];
    if (ch === '(') {
      pos++;
      let lookaround = false;
      if (source[pos] === '?') {
        const next = source[pos + 1];
        if (next === ':') pos += 2;
        else if (next === '=' || next === '!') { pos += 2; lookaround = true; }
        else if (next === '<' && (source[pos + 2] === '=' || source[pos + 2] === '!')) { pos += 3; lookaround = true; }
        else if (next === '<') { pos = source.indexOf('>', pos) + 1; }
        else pos += 1;
      }
      const branches = parseAlternation();
      pos++; // ')'
      return { kind: 'group', branches, lookaround };
    }
    if (ch === '[') return { kind: 'char', set: parseClass() };
    if (ch === '\\') {
      const next = source[pos + 1] ?? '';
      pos += 2;
      if (next === 'b' || next === 'B' || /[1-9]/.test(next)) return { kind: 'empty' };
      if (next === 'k' && source[pos] === '<') { pos = source.indexOf('>', pos) + 1; return { kind: 'empty' }; }
      if ((next === 'p' || next === 'P') && source[pos] === '{') pos = source.indexOf('}', pos) + 1;
      if (next === 'x') pos += 2;
      if (next === 'u') pos += source[pos] === '{' ? source.indexOf('}', pos) + 1 - pos : 4;
      if (next === 'c') pos += 1;
      return { kind: 'char', set: escapeSet(next) };
    }
    pos++;
    if (ch === '^' || ch === '$') return { kind: 'empty' };
    if (ch === '.') return { kind: 'char', set: ANY };
    const code = ch.charCodeAt(0);
    return { kind: 'char', set: other => other === code };
  }

  /** @returns {(code: number) => boolean} */
  function parseClass() {
    pos++; // '['
    let negated = false;
    if (source[pos] === '^') { negated = true; pos++; }
    /** @type {Array<(code: number) => boolean>} */
    const parts = [];
    let first = true;
    while (pos < source.length && (source[pos] !== ']' || first)) {
      first = false;
      let lowSet;
      let low;
      if (source[pos] === '\\') {
        const next = source[pos + 1];
        pos += 2;
        lowSet = escapeSet(next);
        low = /[dDwWsSpP]/.test(next) ? -1 : (next === 'n' ? 10 : next === 'r' ? 13 : next === 't' ? 9 : next.charCodeAt(0));
      } else {
        low = source.charCodeAt(pos);
        lowSet = (/** @type {number} */ c) => c === low;
        pos++;
      }
      if (source[pos] === '-' && source[pos + 1] !== ']' && low >= 0) {
        pos++;
        let high = source.charCodeAt(pos);
        if (source[pos] === '\\') { pos++; high = source.charCodeAt(pos); }
        pos++;
        const lo = low;
        parts.push(c => c >= lo && c <= high);
      } else {
        parts.push(lowSet);
      }
    }
    pos++; // ']'
    const inClass = (/** @type {number} */ code) => parts.some(part => part(code));
    return negated ? code => !inClass(code) : inClass;
  }

  /**
   * @param {Omit<Node, 'min' | 'max'>} atom
   * @returns {Node}
   */
  function applyQuantifier(atom) {
    let min = 1;
    let max = 1;
    const ch = source[pos];
    if (ch === '*') { min = 0; max = INFINITY; pos++; }
    else if (ch === '+') { min = 1; max = INFINITY; pos++; }
    else if (ch === '?') { min = 0; max = 1; pos++; }
    else if (ch === '{') {
      const match = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(pos));
      if (match) {
        min = Number(match[1]);
        max = match[2] === undefined ? min : match[3] === '' ? INFINITY : Number(match[3]);
        pos += match[0].length;
      }
    }
    if (min !== 1 || max !== 1) {
      if (source[pos] === '?') pos++; // lazy
    }
    return /** @type {Node} */ ({ ...atom, min, max });
  }

  return parseAlternation();
}

const PROBE_CODES = Array.from({ length: 128 }, (_, i) => i).concat([0xa0, 0xe9, 0x2028, 0x4e2d, 0x1f600]);

/**
 * Every character a node can match anywhere inside it, sampled over the probe codes.
 * @param {Node} node
 * @param {Set<number>} into
 * @returns {Set<number>}
 */
function allChars(node, into = new Set()) {
  if (node.kind === 'char') {
    for (const code of PROBE_CODES) if (node.set(code)) into.add(code);
  } else if (node.kind === 'group' && !node.lookaround) {
    for (const branch of node.branches) for (const inner of branch) allChars(inner, into);
  }
  return into;
}

/**
 * Whether every match of the branch is pinned by a delimiter: a required atom whose
 * characters the rest of the branch can never match, next to other required content.
 * Repeating such a branch can't split the same text two ways, as in `(?:-[a-z]+)*`
 * or `(?:[a-z]+\.)+`.
 * @param {Node[]} branch
 * @returns {boolean}
 */
function isDelimited(branch) {
  const required = branch.filter(node => node.min > 0 && node.kind !== 'empty');
  if (required.length < 2) return false;
  return required.some(delimiter => {
    const own = allChars(delimiter);
    const rest = new Set();
    for (const node of branch) if (node !== delimiter) allChars(node, rest);
    for (const code of own) if (rest.has(code)) return false;
    return own.size > 0;
  });
}

/**
 * The largest number of nested unbounded quantifiers in a sequence. A repeated group
 * whose every branch is delimited adds no level of its own.
 * @param {Node[]} nodes
 * @returns {number}
 */
function starHeight(nodes) {
  let height = 0;
  for (const node of nodes) {
    if (node.kind !== 'group') {
      height = Math.max(height, node.max === INFINITY ? 1 : 0);
      continue;
    }
    const inner = Math.max(0, ...node.branches.map(starHeight));
    if (node.max !== INFINITY) {
      height = Math.max(height, inner);
    } else if (node.branches.every(isDelimited)) {
      height = Math.max(height, inner, 1);
    } else {
      height = Math.max(height, inner + 1);
    }
  }
  return height;
}

/**
 * The characters a branch can start with, sampled over ASCII and a few others.
 * @param {Node[]} branch
 * @returns {Set<number> | null} null when the branch can match the empty string
 */
function firstChars(branch) {
  /** @type {Set<number>} */
  const result = new Set();
  for (const node of branch) {
    if (node.kind === 'empty') continue;
    if (node.kind === 'char') {
      for (const code of PROBE_CODES) if (node.set(code)) result.add(code);
    } else if (!node.lookaround) {
      let nullable = false;
      for (const inner of node.branches) {
        const chars = firstChars(inner);
        if (chars === null) nullable = true;
        else for (const code of chars) result.add(code);
      }
      if (!nullable && node.min > 0) return result;
      continue;
    } else {
      continue;
    }
    if (node.min > 0) return result;
  }
  return result.size === 0 ? null : result;
}

/**
 * Whether two branches of a repeated alternation can start with the same character.
 * @param {Node[][]} branches
 * @returns {boolean}
 */
function branchesOverlap(branches) {
  const sets = branches.map(firstChars);
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i];
      const b = sets[j];
      if (a === null || b === null) return true;
      for (const code of a) if (b.has(code)) return true;
    }
  }
  return false;
}

/**
 * @param {Node[]} nodes
 * @returns {boolean}
 */
function hasRepeatedOverlap(nodes) {
  for (const node of nodes) {
    if (node.kind !== 'group') continue;
    if (node.max === INFINITY && node.branches.length > 1 && branchesOverlap(node.branches)) return true;
    if (node.branches.some(hasRepeatedOverlap)) return true;
  }
  return false;
}

/**
 * Explains why a pattern can backtrack catastrophically, or returns null.
 * @param {string} source the pattern, without slashes or flags
 * @returns {string | null}
 */
export function findUnsafeRegex(source) {
  const branches = parseRegex(source);
  if (Math.max(0, ...branches.map(starHeight)) > 1) {
    return 'it nests one unbounded quantifier inside another';
  }
  if (branches.some(hasRepeatedOverlap)) {
    return 'it repeats an alternation whose branches can match the same text';
  }
  return null;
}
