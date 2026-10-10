/**
 * Inline Markdown: code spans, emphasis, links, images, autolinks, escapes, entities and
 * line breaks. Emphasis follows the CommonMark delimiter-run rules.
 */
import { MarkdownSyntaxError } from './errors.js';

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const UNICODE_PUNCTUATION = /[\p{P}\p{S}]/u;
const UNICODE_WHITESPACE = /\s/u;
// CommonMark excludes control characters from autolinks and link destinations.
// eslint-disable-next-line no-control-regex
const AUTOLINK_URI = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*)>/;
const AUTOLINK_EMAIL =
  /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)>/;
const BARE_URL = /^(?:(?:https?|ftp):\/\/|www\.)[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.?[^\s<]*/i;
const BARE_EMAIL = /^[A-Za-z0-9._+-]+@[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]*[a-zA-Z0-9])+(?![-_])/;
const BARE_LINK_PRECEDERS = /[\s*_~(]/;
const FOOTNOTE_REFERENCE = /^\[\^[^\]\s]+\]/;

/**
 * Removes backslash escapes in front of ASCII punctuation (link destinations, titles, info strings).
 * @param {string} text Raw text.
 * @returns {string} Text without the escaping backslashes.
 */
export function unescapePunctuation(text) {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/**
 * Normalises a link label for reference lookup: collapsed whitespace, case-folded.
 * @param {string} label Raw label.
 * @returns {string} Lookup key.
 */
export function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Trims trailing punctuation from a bare URL the way GFM extended autolinks do.
 * @param {string} url Candidate URL.
 * @returns {string} The URL without trailing punctuation, unbalanced `)` or a trailing entity.
 */
function trimBareUrl(url) {
  let result = url;
  let previous;
  do {
    previous = result;
    result = result.replace(/[?!.,:;*_'"~]+$/, '');
    const entity = /&[a-zA-Z0-9]+;$/.exec(result);
    if (entity) result = result.slice(0, entity.index);
    if (result.endsWith(')')) {
      const opens = result.split('(').length - 1;
      const closes = result.split(')').length - 1;
      if (closes > opens) result = result.slice(0, -1);
    }
  } while (result !== previous);
  return result;
}

/**
 * Finds the end of a backtick run starting at `pos`.
 * @param {string} src Source.
 * @param {number} pos Index of the first backtick.
 * @returns {number} Index just after the run.
 */
function runEnd(src, pos) {
  let end = pos;
  while (src[end] === src[pos]) end++;
  return end;
}

/**
 * Finds the closing backtick run of the same length.
 * @param {string} src Source.
 * @param {number} from Index after the opening run.
 * @param {number} length Length of the opening run.
 * @returns {number} Index of the closing run, or -1.
 */
function findClosingBackticks(src, from, length) {
  let pos = src.indexOf('`', from);
  while (pos !== -1) {
    const end = runEnd(src, pos);
    if (end - pos === length) return pos;
    pos = src.indexOf('`', end);
  }
  return -1;
}

/**
 * Finds the `]` that closes the `[` at `open`, skipping escapes, code spans and nested brackets.
 * @param {string} src Source.
 * @param {number} open Index of `[`.
 * @returns {number} Index of the matching `]`, or -1.
 */
function findLabelEnd(src, open) {
  let depth = 0;
  for (let i = open + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
    } else if (ch === '`') {
      const end = runEnd(src, i);
      const close = findClosingBackticks(src, end, end - i);
      i = close === -1 ? end - 1 : runEnd(src, close) - 1;
    } else if (ch === '[') {
      depth++;
    } else if (ch === ']') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/**
 * Parses `(destination "title")` after a link label.
 * @param {string} src Source.
 * @param {number} pos Index of `(`.
 * @returns {{ href: string, title: string | null, end: number } | null} The parsed target.
 */
function parseInlineTarget(src, pos) {
  let i = pos + 1;
  const skipSpace = () => {
    let newlines = 0;
    while (i < src.length && /[ \t\n]/.test(src[i])) {
      if (src[i] === '\n' && ++newlines > 1) return false;
      i++;
    }
    return true;
  };
  if (!skipSpace()) return null;
  let href = '';
  if (src[i] === '<') {
    const close = src.indexOf('>', i + 1);
    if (close === -1) return null;
    href = src.slice(i + 1, close);
    if (/[\n<]/.test(href) || href.endsWith('\\')) return null;
    i = close + 1;
  } else {
    let depth = 0;
    const start = i;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\' && i + 1 < src.length && ASCII_PUNCTUATION.test(src[i + 1])) {
        i += 2;
        continue;
      }
      // eslint-disable-next-line no-control-regex
      if (/[\s\x00-\x1f]/.test(ch)) break;
      if (ch === '(') depth++;
      if (ch === ')') {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    if (depth !== 0) return null;
    href = src.slice(start, i);
  }
  const beforeTitle = i;
  if (!skipSpace()) return null;
  let title = null;
  const quote = src[i];
  if (i > beforeTitle && (quote === '"' || quote === "'" || quote === '(')) {
    const closeChar = quote === '(' ? ')' : quote;
    let j = i + 1;
    while (j < src.length && src[j] !== closeChar) {
      if (src[j] === '\\') j++;
      j++;
    }
    if (j >= src.length) return null;
    title = unescapePunctuation(src.slice(i + 1, j));
    i = j + 1;
    if (!skipSpace()) return null;
  }
  if (src[i] !== ')') return null;
  return { href: unescapePunctuation(href), title, end: i + 1 };
}

/**
 * Whether a delimiter run is left- or right-flanking (CommonMark 6.2).
 * @param {string} before Character before the run ('' at the start).
 * @param {string} after Character after the run ('' at the end).
 * @param {string} char The delimiter character.
 * @returns {{ canOpen: boolean, canClose: boolean }} Opening and closing ability.
 */
function flanking(before, after, char) {
  const beforeSpace = !before || UNICODE_WHITESPACE.test(before);
  const afterSpace = !after || UNICODE_WHITESPACE.test(after);
  const beforePunct = !!before && UNICODE_PUNCTUATION.test(before);
  const afterPunct = !!after && UNICODE_PUNCTUATION.test(after);
  const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
  const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
  if (char === '*') return { canOpen: left, canClose: right };
  return { canOpen: left && (!right || beforePunct), canClose: right && (!left || afterPunct) };
}

/**
 * Inline parser for one span of text.
 */
class InlineParser {
  /**
   * @param {{ defs: Map<string, { href: string, title: string | null }>, file?: string }} ctx Shared state.
   * @param {number} line Source line of the span (1-based), for errors.
   */
  constructor(ctx, line) {
    this.ctx = ctx;
    this.line = line;
  }

  /**
   * Throws an unsupported-construct error at the line of `pos`.
   * @param {string} what Description.
   * @param {string} src Span source.
   * @param {number} pos Offset in the span.
   */
  fail(what, src, pos) {
    const lineInSpan = src.slice(0, pos).split(/\r?\n/).length - 1;
    throw new MarkdownSyntaxError(what, this.ctx.file, this.line + lineInSpan);
  }

  /**
   * Tokenizes a span.
   * @param {string} src Inline source.
   * @param {boolean} inLink Whether links are disallowed (inside a link label).
   * @returns {object[]} Inline tokens.
   */
  parse(src, inLink = false) {
    /** @type {object[]} */
    const nodes = [];
    let text = '';
    const flush = () => {
      if (text) nodes.push({ type: 'text', raw: text, text });
      text = '';
    };
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      const rest = src.slice(i);

      if (ch === '\\') {
        const next = src[i + 1];
        if (next === '\n') {
          flush();
          nodes.push({ type: 'br', raw: '\\\n' });
          i += 2;
          continue;
        }
        if (next && ASCII_PUNCTUATION.test(next)) {
          flush();
          nodes.push({ type: 'escape', raw: `\\${next}`, text: next });
          i += 2;
          continue;
        }
      }

      if (ch === '`') {
        const end = runEnd(src, i);
        const close = findClosingBackticks(src, end, end - i);
        if (close === -1) {
          text += src.slice(i, end);
          i = end;
          continue;
        }
        let code = src.slice(end, close).replace(/\n/g, ' ');
        if (/[^ ]/.test(code) && code.startsWith(' ') && code.endsWith(' ')) code = code.slice(1, -1);
        flush();
        nodes.push({ type: 'codespan', raw: src.slice(i, close + (end - i)), text: code });
        i = close + (end - i);
        continue;
      }

      if (ch === ' ' || ch === '\n') {
        const spaces = /^( {2,})\n/.exec(rest);
        if (spaces && src.slice(i + spaces[0].length).trim()) {
          flush();
          nodes.push({ type: 'br', raw: spaces[0] });
          i += spaces[0].length;
          continue;
        }
      }

      if (ch === '<') {
        const auto = AUTOLINK_URI.exec(rest) || AUTOLINK_EMAIL.exec(rest);
        if (auto && !inLink) {
          const isMailAddress = auto[1].includes('@') && !auto[1].includes(':');
          flush();
          nodes.push({
            type: 'link',
            raw: auto[0],
            href: isMailAddress ? `mailto:${auto[1]}` : auto[1],
            title: null,
            text: auto[1],
            tokens: [{ type: 'text', raw: auto[1], text: auto[1] }]
          });
          i += auto[0].length;
          continue;
        }
      }

      if (ch === '[' || (ch === '!' && src[i + 1] === '[')) {
        if (FOOTNOTE_REFERENCE.test(ch === '!' ? rest.slice(1) : rest)) {
          this.fail('footnotes are not supported', src, i);
        }
        const link = this.parseLink(src, i, inLink);
        if (link) {
          flush();
          nodes.push(link.token);
          i = link.end;
          continue;
        }
      }

      if (ch === '*' || ch === '_') {
        const end = runEnd(src, i);
        const { canOpen, canClose } = flanking(src[i - 1] || '', src[end] || '', ch);
        flush();
        nodes.push({ type: 'delim', char: ch, count: end - i, origCount: end - i, canOpen, canClose });
        i = end;
        continue;
      }

      if (ch === '~' && src[i + 1] === '~') {
        this.fail('strikethrough (~~) is not supported', src, i);
      }

      if (!inLink && (i === 0 || BARE_LINK_PRECEDERS.test(src[i - 1]))) {
        const url = BARE_URL.exec(rest);
        if (url) {
          const value = trimBareUrl(url[0]);
          flush();
          nodes.push({
            type: 'link',
            raw: value,
            href: value.toLowerCase().startsWith('www.') ? `http://${value}` : value,
            title: null,
            text: value,
            tokens: [{ type: 'text', raw: value, text: value }]
          });
          i += value.length;
          continue;
        }
        const bareAddress = BARE_EMAIL.exec(rest);
        if (bareAddress) {
          flush();
          nodes.push({
            type: 'link',
            raw: bareAddress[0],
            href: `mailto:${bareAddress[0]}`,
            title: null,
            text: bareAddress[0],
            tokens: [{ type: 'text', raw: bareAddress[0], text: bareAddress[0] }]
          });
          i += bareAddress[0].length;
          continue;
        }
      }

      text += ch;
      i++;
    }
    flush();
    return mergeText(processEmphasis(nodes));
  }

  /**
   * Parses an inline, full-reference, collapsed or shortcut link (or image) at `pos`.
   * @param {string} src Source.
   * @param {number} pos Index of `[` or `!`.
   * @param {boolean} inLink Whether we are inside a link label already.
   * @returns {{ token: object, end: number } | null} The token, or null when this is plain text.
   */
  parseLink(src, pos, inLink) {
    const isImage = src[pos] === '!';
    const open = isImage ? pos + 1 : pos;
    const close = findLabelEnd(src, open);
    if (close === -1) return null;
    const label = src.slice(open + 1, close);
    let target = null;
    let end = close + 1;
    if (src[end] === '(') {
      const inline = parseInlineTarget(src, end);
      if (inline) {
        target = inline;
        end = inline.end;
      }
    }
    if (!target) {
      const full = /^\[((?:\\.|[^\\[\]])*)\]/.exec(src.slice(close + 1));
      const key = full && full[1].trim() ? full[1] : label;
      const def = this.ctx.defs.get(normalizeLabel(key));
      if (!def) return null;
      target = def;
      end = full ? close + 1 + full[0].length : close + 1;
    }
    if (inLink && !isImage) return null;
    const text = label.replace(/\\([[\]])/g, '$1');
    return {
      token: {
        type: isImage ? 'image' : 'link',
        raw: src.slice(pos, end),
        href: target.href,
        title: target.title || null,
        text,
        tokens: this.parse(text, true)
      },
      end
    };
  }
}

/**
 * Applies the CommonMark "process emphasis" procedure to a flat node list.
 * @param {object[]} nodes Flat inline nodes including `delim` nodes.
 * @returns {object[]} Nodes with `em` / `strong` tokens and leftover delimiters as text.
 */
function processEmphasis(nodes) {
  // Work on a doubly linked list so wrapping a range is cheap.
  const head = { next: null, prev: null };
  let tail = head;
  for (const node of nodes) {
    const cell = { node, prev: tail, next: null };
    tail.next = cell;
    tail = cell;
  }
  const isDelim = cell => cell && cell.node.type === 'delim';
  const openersBottom = new Map();

  let closer = head.next;
  while (closer) {
    if (!isDelim(closer) || !closer.node.canClose || closer.node.count === 0) {
      closer = closer.next;
      continue;
    }
    const c = closer.node;
    const key = `${c.char}${c.canOpen ? 1 : 0}${c.origCount % 3}`;
    const bottom = openersBottom.get(key) || null;
    let opener = closer.prev;
    let found = null;
    while (opener && opener !== head && opener !== bottom) {
      if (isDelim(opener) && opener.node.count > 0) {
        const o = opener.node;
        const oddMatch = (c.canOpen || o.canClose) && c.origCount % 3 !== 0 && (o.origCount + c.origCount) % 3 === 0;
        if (o.char === c.char && o.canOpen && !oddMatch) {
          found = opener;
          break;
        }
      }
      opener = opener.prev;
    }
    if (!found) {
      openersBottom.set(key, closer.prev);
      closer = closer.next;
      continue;
    }
    const o = found.node;
    const use = o.count >= 2 && c.count >= 2 ? 2 : 1;
    o.count -= use;
    c.count -= use;
    const children = [];
    for (let cell = found.next; cell && cell !== closer; cell = cell.next) {
      children.push(delimToText(cell.node));
    }
    const wrapper = { node: { type: use === 2 ? 'strong' : 'em', tokens: mergeText(children) }, prev: found, next: closer };
    found.next = wrapper;
    closer.prev = wrapper;
    if (c.count > 0) continue;
    closer = closer.next;
  }

  const out = [];
  for (let cell = head.next; cell; cell = cell.next) {
    const node = delimToText(cell.node);
    if (node.type !== 'text' || node.text) out.push(node);
  }
  return out;
}

/**
 * Turns a leftover delimiter node into text.
 * @param {object} node Inline node.
 * @returns {object} The node, or a text node for a delimiter.
 */
function delimToText(node) {
  if (node.type !== 'delim') return node;
  const text = node.char.repeat(node.count);
  return { type: 'text', raw: text, text };
}

/**
 * Merges adjacent text tokens.
 * @param {object[]} nodes Inline tokens.
 * @returns {object[]} Tokens with runs of text joined.
 */
function mergeText(nodes) {
  const out = [];
  for (const node of nodes) {
    const last = out.at(-1);
    if (node.type === 'text' && last && last.type === 'text') {
      last.raw += node.raw;
      last.text += node.text;
    } else if (node.type !== 'text' || node.text) {
      out.push(node.type === 'text' ? { ...node } : node);
    }
  }
  return out;
}

/**
 * Tokenizes inline Markdown.
 * @param {string} src Inline source.
 * @param {{ defs: Map<string, { href: string, title: string | null }>, file?: string }} ctx Shared state.
 * @param {number} line Source line where the span starts (1-based).
 * @returns {object[]} Inline tokens.
 */
export function tokenizeInline(src, ctx, line) {
  return new InlineParser(ctx, line).parse(src);
}
