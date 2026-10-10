/**
 * QRCraftly's own Markdown parser for repository docs (the docs audit and the /security page).
 * It supports the GitHub-flavoured subset our docs use and throws `MarkdownSyntaxError`
 * (`file:line`) for constructs it does not support, so a doc that needs more syntax fails
 * loudly in `docs:lint` instead of rendering differently. No dependencies.
 */
import { parseBlocks } from './block.js';
import { tokenizeInline } from './inline.js';

export { MarkdownSyntaxError } from './errors.js';
export { render, escapeHtml, escapeTextContent } from './render.js';

/**
 * Visits every token depth-first: block tokens, list items, table cells' inline tokens and
 * nested inline tokens.
 * @param {object[]} tokens Tokens.
 * @param {(token: object) => void} fn Visitor.
 */
export function walk(tokens, fn) {
  for (const token of tokens) {
    fn(token);
    if (token.type === 'table') {
      for (const cell of token.header) walk(cell.tokens, fn);
      for (const row of token.rows) for (const cell of row) walk(cell.tokens, fn);
    } else if (token.type === 'list') {
      walk(token.items, fn);
    } else if (token.tokens) {
      walk(token.tokens, fn);
    }
  }
}

/**
 * Runs the inline tokenizer over every block that has pending inline content.
 * @param {object[]} tokens Block tokens.
 * @param {object} ctx Parser state.
 */
function resolveInline(tokens, ctx) {
  const visit = holder => {
    if (holder.inline) {
      holder.tokens = tokenizeInline(holder.inline.src, ctx, holder.inline.line);
      delete holder.inline;
    }
  };
  for (const token of tokens) {
    delete token.blankBefore;
    if (token.type === 'table') {
      for (const cell of token.header) visit(cell);
      for (const row of token.rows) for (const cell of row) visit(cell);
    } else if (token.type === 'list') {
      for (const item of token.items) resolveInline(item.tokens, ctx);
    } else if (token.type === 'blockquote') {
      resolveInline(token.tokens, ctx);
    } else {
      visit(token);
    }
  }
}

/**
 * Tokenizes Markdown.
 * @param {string} src Markdown source (without frontmatter).
 * @param {{ file?: string, lineOffset?: number }} [options] File name and the number of lines
 *   before `src` in that file (frontmatter), used in error messages.
 * @returns {object[]} Block tokens with nested `tokens` (`type`, `raw`, `text`, `href`, `lang`,
 *   `depth`, `items`, ...).
 */
export function tokenize(src, options = {}) {
  const ctx = { defs: new Map(), file: options.file };
  const offset = options.lineOffset ?? 0;
  const lines = src
    .split(/\r\n?|\n/)
    .map((text, index) => ({ text, line: index + 1 + offset }));
  const tokens = parseBlocks(lines, ctx);
  resolveInline(tokens, ctx);
  return tokens;
}

/**
 * Heading slug as the docs audit and the /security page use it: tags removed, lowercase,
 * punctuation dropped, spaces to hyphens.
 * @param {string} text Heading text.
 * @returns {string} Slug.
 */
export function slugify(text) {
  let previous;
  let value = text;
  do {
    previous = value;
    value = value.replace(/<[^>]*>/g, '');
  } while (value !== previous);
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');
}

/**
 * Returns a slugger that keeps ids unique within one document: a repeated heading gets
 * `-1`, `-2`, ... appended, as GitHub does.
 * @returns {{ slug: (text: string) => string }} The slugger.
 */
export function createSlugger() {
  const used = new Set();
  return {
    slug(text) {
      const base = slugify(text);
      let slug = base;
      for (let n = 1; used.has(slug); n++) slug = `${base}-${n}`;
      used.add(slug);
      return slug;
    }
  };
}
