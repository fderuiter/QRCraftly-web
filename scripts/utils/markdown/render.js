/**
 * Renders Markdown tokens to HTML. Text, attributes and code are HTML-escaped by default; the
 * only raw HTML passed through is a block-level HTML comment, which cannot create markup.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const TEXT_ESCAPE = /[<>"']|&(?!(?:#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g;
const DANGEROUS_SCHEME = /^(?:javascript|vbscript|data|file):/i;

/**
 * Escapes text for HTML. Character references already in the Markdown (`&amp;`, `&#39;`) are
 * kept; every other `&`, `<`, `>`, `"` and `'` is escaped.
 * @param {string} text Text.
 * @returns {string} Escaped text, safe in element content and quoted attributes.
 */
export function escapeHtml(text) {
  return text.replace(TEXT_ESCAPE, ch => ESCAPES[ch]);
}

/**
 * Escapes every `&`, `<`, `>`, `"` and `'` (code, where references must show literally).
 * @param {string} text Text.
 * @returns {string} Escaped text.
 */
function escapeAll(text) {
  return text.replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

/**
 * Escapes only `<` and `>`: enough to keep text content from opening markup, while leaving
 * the text otherwise byte-for-byte as written.
 * @param {string} text Text for element content (never an attribute).
 * @returns {string} Escaped text.
 */
export function escapeTextContent(text) {
  return text.replace(/[<>]/g, ch => ESCAPES[ch]);
}

/**
 * Percent-encodes a link target for an attribute and refuses script-capable schemes.
 * @param {string} href Link target.
 * @returns {string | null} A safe attribute value, or null when the link must not be emitted.
 */
function safeUrl(href) {
  let encoded;
  try {
    encoded = encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  if (DANGEROUS_SCHEME.test(href.replace(/[\x00-\x20]/g, ''))) return null;
  return encoded;
}

/**
 * Plain text of inline tokens (image alt text).
 * @param {object[]} tokens Inline tokens.
 * @returns {string} Their text.
 */
function plainText(tokens) {
  return tokens
    .map(token => {
      if (token.tokens) return plainText(token.tokens);
      if (token.type === 'br') return '';
      return token.text ?? '';
    })
    .join('');
}

/**
 * @typedef {object} RenderHooks
 * @property {(token: object, html: string) => string} [heading] Returns the full HTML of a heading;
 *   `html` is its rendered, escaped inline content.
 * @property {(href: string, token: object) => string} [link] Rewrites a link target before it is encoded.
 */

class Renderer {
  /**
   * @param {RenderHooks} hooks Optional overrides.
   */
  constructor(hooks) {
    this.hooks = hooks;
  }

  /**
   * @param {object[]} tokens Block tokens.
   * @returns {string} HTML.
   */
  blocks(tokens) {
    return tokens.map(token => this.block(token)).join('');
  }

  /**
   * @param {object} token Block token.
   * @returns {string} HTML.
   */
  block(token) {
    switch (token.type) {
      case 'heading': {
        const html = this.inline(token.tokens);
        if (this.hooks.heading) return this.hooks.heading(token, html);
        return `<h${token.depth}>${html}</h${token.depth}>\n`;
      }
      case 'paragraph':
        return `<p>${this.inline(token.tokens)}</p>\n`;
      case 'text':
        return this.inline(token.tokens);
      case 'code': {
        const lang = (token.lang || '').split(/\s/)[0];
        const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        return `<pre><code${cls}>${escapeAll(token.text.replace(/\n$/, '') + '\n')}</code></pre>\n`;
      }
      case 'blockquote':
        return `<blockquote>\n${this.blocks(token.tokens)}</blockquote>\n`;
      case 'list':
        return this.list(token);
      case 'table':
        return this.table(token);
      case 'hr':
        return '<hr>\n';
      case 'html':
        return token.text;
      default:
        throw new Error(`Cannot render Markdown token "${token.type}".`);
    }
  }

  /**
   * @param {object} list List token.
   * @returns {string} HTML.
   */
  list(list) {
    const tag = list.ordered ? 'ol' : 'ul';
    const start = list.ordered && list.start !== 1 ? ` start="${list.start}"` : '';
    const items = list.items.map(item => {
      let body = this.blocks(item.tokens);
      if (item.task) {
        const checkbox = `<input ${item.checked ? 'checked="" ' : ''}disabled="" type="checkbox"> `;
        body = item.tokens[0].type === 'paragraph' ? body.replace(/^<p>/, `<p>${checkbox}`) : checkbox + body;
      }
      return `<li>${body}</li>\n`;
    });
    return `<${tag}${start}>\n${items.join('')}</${tag}>\n`;
  }

  /**
   * @param {object} table Table token.
   * @returns {string} HTML.
   */
  table(table) {
    const row = cells =>
      `<tr>\n${cells
        .map(cell => {
          const tag = cell.header ? 'th' : 'td';
          const open = cell.align ? `<${tag} align="${cell.align}">` : `<${tag}>`;
          return `${open}${this.inline(cell.tokens)}</${tag}>\n`;
        })
        .join('')}</tr>\n`;
    const body = table.rows.length > 0 ? `<tbody>${table.rows.map(row).join('')}</tbody>` : '';
    return `<table>\n<thead>\n${row(table.header)}</thead>\n${body}</table>\n`;
  }

  /**
   * @param {object[]} tokens Inline tokens.
   * @returns {string} HTML.
   */
  inline(tokens) {
    return tokens.map(token => this.inlineToken(token)).join('');
  }

  /**
   * @param {object} token Inline token.
   * @returns {string} HTML.
   */
  inlineToken(token) {
    switch (token.type) {
      case 'text':
      case 'escape':
        return escapeHtml(token.text);
      case 'codespan':
        return `<code>${escapeAll(token.text)}</code>`;
      case 'strong':
        return `<strong>${this.inline(token.tokens)}</strong>`;
      case 'em':
        return `<em>${this.inline(token.tokens)}</em>`;
      case 'br':
        return '<br>';
      case 'link': {
        const content = this.inline(token.tokens);
        const target = this.hooks.link ? this.hooks.link(token.href, token) : token.href;
        const href = safeUrl(target);
        if (href === null) return content;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<a href="${href}"${title}>${content}</a>`;
      }
      case 'image': {
        const src = safeUrl(token.href);
        const alt = escapeHtml(plainText(token.tokens));
        if (src === null) return alt;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
        return `<img src="${src}" alt="${alt}"${title}>`;
      }
      default:
        throw new Error(`Cannot render Markdown token "${token.type}".`);
    }
  }
}

/**
 * Renders block tokens to HTML.
 * @param {object[]} tokens Tokens from `tokenize`.
 * @param {RenderHooks} [hooks] Heading and link overrides.
 * @returns {string} HTML.
 */
export function render(tokens, hooks = {}) {
  return new Renderer(hooks).blocks(tokens);
}
