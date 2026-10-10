/**
 * Block-level Markdown: headings, paragraphs, fenced and indented code, lists (with task items),
 * blockquotes, GFM tables, thematic breaks, HTML comments and link reference definitions.
 * Containers are parsed line by line; inline content is tokenized afterwards, once every
 * reference definition is known.
 */
import { MarkdownSyntaxError } from './errors.js';
import { normalizeLabel, unescapePunctuation } from './inline.js';

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/;
const QUOTE = /^ {0,3}>/;
const QUOTE_MARKER = /^ {0,3}> ?/;
const BULLET = /^( {0,3})([*+-]|\d{1,9}[.)])(?=[ \t]|$)/;
const PARAGRAPH_LIST_INTERRUPT = /^ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t]/;
const HTML_COMMENT = /^ {0,3}<!--/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const DELIMITER_ROW = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const DEFINITION =
  /^ {0,3}\[((?:\\.|[^\\[\]])+)\]:[ \t]*(?:<([^>]*)>|(\S+))(?:[ \t]+("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\((?:\\.|[^()\\])*\)))?[ \t]*$/;
const TASK = /^\[([ xX])\] +(?=\S)/;

/**
 * @typedef {{ text: string, line: number }} Line
 * @typedef {{ defs: Map<string, { href: string, title: string | null }>, file?: string }} Context
 */

const isBlank = text => /^[ \t]*$/.test(text);

/**
 * Number of leading spaces (tabs count as four columns).
 * @param {string} text Line.
 * @returns {number} Indentation width.
 */
function indentOf(text) {
  let width = 0;
  for (const ch of text) {
    if (ch === ' ') width++;
    else if (ch === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

/**
 * Removes up to `width` columns of indentation.
 * @param {string} text Line.
 * @param {number} width Columns to remove.
 * @returns {string} The de-indented line.
 */
function dedent(text, width) {
  let col = 0;
  let i = 0;
  while (i < text.length && col < width) {
    if (text[i] === ' ') col++;
    else if (text[i] === '\t') col += 4 - (col % 4);
    else break;
    i++;
  }
  return text.slice(i);
}

/**
 * Splits a table row into trimmed cells, honouring `\|` escapes.
 * @param {string} row Table row.
 * @param {number} [count] Pad or cut the row to this many cells.
 * @returns {string[]} Cell sources.
 */
function splitCells(row, count) {
  const cells = [];
  let current = '';
  let backslashes = 0;
  for (const ch of row.trim()) {
    if (ch === '|' && backslashes % 2 === 0) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
    backslashes = ch === '\\' ? backslashes + 1 : 0;
  }
  cells.push(current);
  if (!cells[0].trim()) cells.shift();
  if (cells.length > 0 && !cells.at(-1).trim()) cells.pop();
  if (count !== undefined) {
    cells.length = Math.min(cells.length, count);
    while (cells.length < count) cells.push('');
  }
  return cells.map(cell => cell.trim().replace(/\\\|/g, '|'));
}

/**
 * Alignment of each column from a delimiter row.
 * @param {string} row Delimiter row.
 * @returns {Array<'left' | 'right' | 'center' | null>} Alignments.
 */
function parseAlignments(row) {
  return row
    .trim()
    .replace(/^\||\|[ \t]*$/g, '')
    .split('|')
    .map(cell => {
      const value = cell.trim();
      const left = value.startsWith(':');
      const right = value.endsWith(':');
      if (left && right) return 'center';
      if (right) return 'right';
      if (left) return 'left';
      return null;
    });
}

/**
 * Whether lines[index] starts a GFM table (header row followed by a matching delimiter row).
 * @param {Line[]} lines Lines.
 * @param {number} index Candidate header row.
 * @returns {boolean} True for a table.
 */
function startsTable(lines, index) {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (!header || !delimiter || !header.text.includes('|') || !DELIMITER_ROW.test(delimiter.text)) return false;
  return splitCells(header.text).length === parseAlignments(delimiter.text).length;
}

/**
 * Whether a line ends a paragraph without a blank line.
 * @param {Line[]} lines Lines.
 * @param {number} index Line to test.
 * @param {boolean} top Whether the paragraph is outside list items (CommonMark interruption rules).
 * @returns {boolean} True when a new block starts here.
 */
function interruptsParagraph(lines, index, top) {
  const text = lines[index].text;
  if (FENCE.test(text) || ATX.test(text) || HR.test(text) || QUOTE.test(text) || HTML_COMMENT.test(text)) return true;
  if (top ? PARAGRAPH_LIST_INTERRUPT.test(text) : BULLET.test(text)) return true;
  return startsTable(lines, index);
}

/**
 * Block parser for one container.
 */
class BlockParser {
  /**
   * @param {Context} ctx Shared state.
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * @param {string} what What is unsupported.
   * @param {number} line Line number.
   * @returns {never} Always throws.
   */
  fail(what, line) {
    throw new MarkdownSyntaxError(what, this.ctx.file, line);
  }

  /**
   * Parses a run of lines into block tokens.
   * @param {Line[]} lines Lines of this container.
   * @param {boolean} top False inside list items, where paragraphs are tight `text` tokens.
   * @returns {object[]} Block tokens.
   */
  parse(lines, top) {
    const tokens = [];
    let i = 0;
    let blankBefore = false;
    while (i < lines.length) {
      const { text, line } = lines[i];
      if (isBlank(text)) {
        blankBefore = true;
        i++;
        continue;
      }
      const result = this.parseBlock(lines, i, top);
      i = result.next;
      if (!result.token) continue;
      result.token.line = line;
      result.token.blankBefore = blankBefore && tokens.length > 0;
      // A list keeps the blank lines after its last item; they still separate the next block.
      blankBefore = isBlank(lines[i - 1].text);
      tokens.push(result.token);
    }
    return tokens;
  }

  /**
   * Parses the block starting at lines[i].
   * @param {Line[]} lines Lines.
   * @param {number} i Start index.
   * @param {boolean} top Paragraph context.
   * @returns {{ token: object | null, next: number }} The token and the next index.
   */
  parseBlock(lines, i, top) {
    const text = lines[i].text;
    if (indentOf(text) >= 4) return this.indentedCode(lines, i);
    if (FENCE.test(text)) return this.fencedCode(lines, i);
    const atx = ATX.exec(text);
    if (atx) return { token: this.heading(atx, lines[i].line), next: i + 1 };
    if (HR.test(text)) return { token: { type: 'hr', raw: text }, next: i + 1 };
    if (QUOTE.test(text)) return this.blockquote(lines, i);
    if (BULLET.test(text)) return this.list(lines, i);
    if (HTML_COMMENT.test(text)) return this.htmlComment(lines, i);
    // Other raw HTML is not used by our docs; it stays paragraph text and is escaped on render.
    const definition = DEFINITION.exec(text);
    if (definition) {
      const key = normalizeLabel(definition[1]);
      if (!this.ctx.defs.has(key)) {
        const title = definition[4] ? unescapePunctuation(definition[4].slice(1, -1)) : null;
        this.ctx.defs.set(key, { href: unescapePunctuation(definition[2] ?? definition[3]), title });
      }
      return { token: null, next: i + 1 };
    }
    if (startsTable(lines, i)) return this.table(lines, i);
    return this.paragraph(lines, i, top);
  }

  /**
   * @param {RegExpExecArray} match ATX match.
   * @param {number} line Line number.
   * @returns {object} Heading token.
   */
  heading(match, line) {
    let content = match[2].trim();
    if (content.endsWith('#')) {
      const stripped = content.replace(/#+$/, '');
      if (!stripped || /[ \t]$/.test(stripped)) content = stripped.trim();
    }
    return { type: 'heading', raw: match[0], depth: match[1].length, text: content, inline: { src: content, line } };
  }

  /**
   * @param {Line[]} lines Lines.
   * @param {number} i Index of the opening fence.
   * @returns {{ token: object, next: number }} Code token.
   */
  fencedCode(lines, i) {
    const [, indent, fence, info] = FENCE.exec(lines[i].text);
    if (fence[0] === '`' && info.includes('`')) {
      return this.paragraph(lines, i, true);
    }
    const closing = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
    const body = [];
    let j = i + 1;
    while (j < lines.length && !closing.test(lines[j].text)) {
      body.push(dedent(lines[j].text, indent.length));
      j++;
    }
    const lang = unescapePunctuation(info.trim());
    const raw = lines.slice(i, Math.min(j + 1, lines.length)).map(l => l.text).join('\n');
    return { token: { type: 'code', raw, lang, text: body.join('\n') }, next: Math.min(j + 1, lines.length) };
  }

  /**
   * @param {Line[]} lines Lines.
   * @param {number} i First indented line.
   * @returns {{ token: object, next: number }} Code token.
   */
  indentedCode(lines, i) {
    let j = i;
    let end = i;
    while (j < lines.length && (isBlank(lines[j].text) || indentOf(lines[j].text) >= 4)) {
      if (!isBlank(lines[j].text)) end = j + 1;
      j++;
    }
    const body = lines.slice(i, end).map(l => dedent(l.text, 4));
    return {
      token: { type: 'code', raw: lines.slice(i, end).map(l => l.text).join('\n'), codeBlockStyle: 'indented', lang: '', text: body.join('\n') },
      next: end
    };
  }

  /**
   * @param {Line[]} lines Lines.
   * @param {number} i First line of the comment.
   * @returns {{ token: object, next: number }} HTML comment token (passed through by the renderer).
   */
  htmlComment(lines, i) {
    let j = i;
    while (j < lines.length && !lines[j].text.includes('-->')) j++;
    if (j >= lines.length) this.fail('unterminated HTML comment', lines[i].line);
    const raw = lines.slice(i, j + 1).map(l => l.text).join('\n');
    if (!/^ {0,3}<!--(?:(?!-->)[\s\S])*-->[ \t]*$/.test(raw)) {
      this.fail('text around an HTML comment on the same line is not supported', lines[j].line);
    }
    // A comment directly followed by text keeps its line break; before a blank line it does not.
    const next = lines[j + 1];
    const text = next && !isBlank(next.text) ? `${raw}\n` : raw;
    return { token: { type: 'html', raw, text }, next: j + 1 };
  }

  /**
   * @param {Line[]} lines Lines.
   * @param {number} i First `>` line.
   * @returns {{ token: object, next: number }} Blockquote token.
   */
  blockquote(lines, i) {
    const inner = [];
    let j = i;
    while (j < lines.length) {
      const { text, line } = lines[j];
      if (QUOTE.test(text)) {
        inner.push({ text: text.replace(QUOTE_MARKER, ''), line });
      } else if (!isBlank(text) && inner.length > 0 && !isBlank(inner.at(-1).text) && !interruptsParagraph(lines, j, true)) {
        inner.push({ text, line });
      } else {
        break;
      }
      j++;
    }
    const raw = lines.slice(i, j).map(l => l.text).join('\n');
    return { token: { type: 'blockquote', raw, tokens: this.parse(inner, true) }, next: j };
  }

  /**
   * @param {Line[]} lines Lines.
   * @param {number} i First header row.
   * @returns {{ token: object, next: number }} Table token.
   */
  table(lines, i) {
    const headerCells = splitCells(lines[i].text);
    const align = parseAlignments(lines[i + 1].text);
    const cell = (source, line, header, column) => ({ text: source, header, align: align[column], inline: { src: source, line } });
    const header = headerCells.map((source, column) => cell(source, lines[i].line, true, column));
    const rows = [];
    let j = i + 2;
    while (j < lines.length) {
      const text = lines[j].text;
      if (isBlank(text) || indentOf(text) >= 4 || FENCE.test(text) || ATX.test(text) || HR.test(text) || QUOTE.test(text) || PARAGRAPH_LIST_INTERRUPT.test(text) || HTML_COMMENT.test(text)) break;
      rows.push(splitCells(text, header.length).map((source, column) => cell(source, lines[j].line, false, column)));
      j++;
    }
    const raw = lines.slice(i, j).map(l => l.text).join('\n');
    return { token: { type: 'table', raw, align, header, rows }, next: j };
  }

  /**
   * @param {Line[]} lines Lines.
   * @param {number} i First line.
   * @param {boolean} top Paragraph (true) or tight list text (false).
   * @returns {{ token: object, next: number }} Paragraph or text token.
   */
  paragraph(lines, i, top) {
    let j = i + 1;
    while (j < lines.length && !isBlank(lines[j].text)) {
      if (SETEXT.test(lines[j].text)) this.fail('setext headings are not supported; use an ATX heading (#)', lines[j].line);
      if (interruptsParagraph(lines, j, top)) break;
      j++;
    }
    const text = lines
      .slice(i, j)
      .map(l => l.text)
      .join('\n');
    return { token: { type: top ? 'paragraph' : 'text', raw: text, text, inline: { src: text, line: lines[i].line } }, next: j };
  }

  /**
   * Parses a list the way GitHub-flavoured Markdown does: items continue while lines are indented
   * to the item's content column (or lazily continue its paragraph).
   * @param {Line[]} lines Lines.
   * @param {number} i First bullet line.
   * @returns {{ token: object, next: number }} List token.
   */
  list(lines, i) {
    const first = BULLET.exec(lines[i].text);
    const marker = first[2];
    const ordered = /\d/.test(marker);
    const delimiter = marker.slice(-1);
    const list = { type: 'list', raw: '', ordered, start: ordered ? Number(marker.slice(0, -1)) : '', loose: false, items: [] };
    const sameList = match => (ordered ? /\d/.test(match[2]) && match[2].slice(-1) === delimiter : match[2] === marker);
    let endsWithBlankLine = false;
    const raws = [];

    while (i < lines.length) {
      const bullet = BULLET.exec(lines[i].text);
      if (!bullet || !sameList(bullet) || HR.test(lines[i].text)) break;
      const markerWidth = bullet[0].length;
      const after = lines[i].text.slice(markerWidth);
      const contents = [];
      const rawLines = [lines[i].text];
      let blank = isBlank(after);
      let contentIndent;
      let previous = after;
      if (blank) {
        contentIndent = markerWidth + 1;
      } else {
        let spaces = indentOf(after);
        if (spaces > 4) spaces = 1;
        contentIndent = markerWidth + spaces;
        contents.push({ text: dedent(after, spaces), line: lines[i].line });
      }
      i++;

      if (blank && i < lines.length && isBlank(lines[i].text)) {
        rawLines.push(lines[i].text);
        i++;
      } else {
        const lead = ` {0,${Math.max(0, Math.min(3, contentIndent - 1))}}`;
        const ends = [
          new RegExp(`^${lead}(?:\`\`\`|~~~)`),
          new RegExp(`^${lead}#`),
          new RegExp(`^${lead}<(?:[a-z].*>|!--)`, 'i'),
          new RegExp(`^${lead}>`),
          new RegExp(`^${lead}(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|$)`),
          new RegExp(`^${lead}(?:(?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})$`)
        ];
        const [fenceStart, headingStart, , , , hrStart] = ends;
        while (i < lines.length) {
          const { text, line } = lines[i];
          if (ends.some(re => re.test(text))) break;
          if (isBlank(text) || indentOf(text) >= contentIndent) {
            contents.push({ text: dedent(text, contentIndent), line });
          } else {
            if (blank) break;
            if (indentOf(previous) >= 4 || fenceStart.test(previous) || headingStart.test(previous) || hrStart.test(previous)) break;
            contents.push({ text, line });
          }
          blank = isBlank(text);
          previous = dedent(text, contentIndent);
          rawLines.push(text);
          i++;
        }
      }

      if (!list.loose) {
        if (endsWithBlankLine) list.loose = true;
        else if (rawLines.length > 1 && isBlank(rawLines.at(-1))) endsWithBlankLine = true;
      }
      raws.push(rawLines.join('\n'));
      list.items.push({ type: 'list_item', raw: rawLines.join('\n'), task: false, loose: false, contents });
    }

    const last = list.items.at(-1);
    while (last.contents.length > 0 && isBlank(last.contents.at(-1).text)) last.contents.pop();
    if (last.contents.length > 0) {
      const end = last.contents.at(-1);
      last.contents[last.contents.length - 1] = { ...end, text: end.text.trimEnd() };
    }

    for (const item of list.items) {
      const task = item.contents.length > 0 ? TASK.exec(item.contents[0].text) : null;
      if (task) {
        const contents = [{ ...item.contents[0], text: item.contents[0].text.slice(task[0].length) }, ...item.contents.slice(1)];
        const tokens = this.parse(contents, false);
        // A checkbox only counts in front of text; `- [ ] # x` keeps its brackets.
        if (tokens[0].type === 'text') {
          item.contents = contents;
          item.task = true;
          item.checked = task[1] !== ' ';
        }
      }
      item.tokens = this.parse(item.contents, false);
      item.text = item.contents.map(l => l.text).join('\n');
      delete item.contents;
      if (!list.loose && item.tokens.some(token => token.blankBefore)) list.loose = true;
    }

    if (list.loose) {
      for (const item of list.items) {
        item.loose = true;
        for (const token of item.tokens) {
          if (token.type === 'text') token.type = 'paragraph';
        }
      }
    }
    list.raw = raws.join('\n').trimEnd();
    return { token: list, next: i };
  }
}

/**
 * Parses Markdown blocks.
 * @param {Line[]} lines Source lines.
 * @param {Context} ctx Shared state.
 * @returns {object[]} Block tokens whose inline content is still pending (`inline` field).
 */
export function parseBlocks(lines, ctx) {
  return new BlockParser(ctx).parse(lines, true);
}
