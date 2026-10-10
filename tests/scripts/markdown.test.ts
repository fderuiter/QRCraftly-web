import { describe, it, expect } from 'vitest';
import {
  tokenize,
  render,
  walk,
  slugify,
  createSlugger,
  escapeHtml,
  escapeTextContent,
  MarkdownSyntaxError
} from '../../scripts/utils/markdown/index.js';

const html = (src: string) => render(tokenize(src));

interface Token {
  type: string;
  href?: string;
  text?: string;
  lang?: string;
  depth?: number;
}

const collect = (src: string, type: string): Token[] => {
  const found: Token[] = [];
  walk(tokenize(src), (token: Token) => {
    if (token.type === type) found.push(token);
  });
  return found;
};

describe('markdown parser', () => {
  describe('headings', () => {
    it('renders ATX headings and strips closing hashes', () => {
      expect(html('# One\n\n### Three ###')).toBe('<h1>One</h1>\n<h3>Three</h3>\n');
      expect(collect('## A *b*', 'heading')).toMatchObject([{ depth: 2, text: 'A *b*' }]);
    });

    it('needs a space after the hashes', () => {
      expect(html('#5 is not a heading')).toBe('<p>#5 is not a heading</p>\n');
    });
  });

  describe('paragraphs', () => {
    it('keeps soft breaks and makes hard breaks from two spaces or a backslash', () => {
      expect(html('one\ntwo')).toBe('<p>one\ntwo</p>\n');
      expect(html('one  \ntwo\\\nthree')).toBe('<p>one<br>two<br>three</p>\n');
    });
  });

  describe('emphasis', () => {
    it('renders em and strong with * and _', () => {
      expect(html('*a* _b_ **c** __d__ ***e***')).toBe(
        '<p><em>a</em> <em>b</em> <strong>c</strong> <strong>d</strong> <em><strong>e</strong></em></p>\n'
      );
    });

    it('leaves intraword underscores and unmatched delimiters alone', () => {
      expect(html('snake_case_name and 2 * 3')).toBe('<p>snake_case_name and 2 * 3</p>\n');
      expect(html('**bold *nested* text**')).toBe('<p><strong>bold <em>nested</em> text</strong></p>\n');
    });
  });

  describe('code', () => {
    it('renders code spans, trimming one space on each side', () => {
      expect(html('use `` a`b `` and `<x>`')).toBe('<p>use <code>a`b</code> and <code>&lt;x&gt;</code></p>\n');
    });

    it('renders fenced code with a language, and tilde fences', () => {
      const src = '```ts title\nconst a = 1 < 2 && "x";\n```\n\n~~~\nplain\n~~~';
      expect(html(src)).toBe(
        '<pre><code class="language-ts">const a = 1 &lt; 2 &amp;&amp; &quot;x&quot;;\n</code></pre>\n<pre><code>plain\n</code></pre>\n'
      );
      expect(collect(src, 'code').map(t => [t.lang, t.text])).toEqual([
        ['ts title', 'const a = 1 < 2 && "x";'],
        ['', 'plain']
      ]);
    });

    it('renders indented code', () => {
      expect(html('para\n\n    code line\n      more')).toBe('<p>para</p>\n<pre><code>code line\n  more\n</code></pre>\n');
    });

    it('keeps an unclosed fence open to the end', () => {
      expect(collect('```js\nlet a;', 'code')).toMatchObject([{ lang: 'js', text: 'let a;' }]);
    });
  });

  describe('lists', () => {
    it('renders tight unordered and ordered lists with a start number', () => {
      expect(html('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n');
      expect(html('3. c\n4. d')).toBe('<ol start="3">\n<li>c</li>\n<li>d</li>\n</ol>\n');
    });

    it('nests lists by indentation', () => {
      expect(html('- a\n  - b\n    1. c\n- d')).toBe(
        '<ul>\n<li>a<ul>\n<li>b<ol>\n<li>c</li>\n</ol>\n</li>\n</ul>\n</li>\n<li>d</li>\n</ul>\n'
      );
    });

    it('makes a list loose when items are separated by a blank line', () => {
      expect(html('- a\n\n- b')).toBe('<ul>\n<li><p>a</p>\n</li>\n<li><p>b</p>\n</li>\n</ul>\n');
      expect(html('- a\n\n  more')).toBe('<ul>\n<li><p>a</p>\n<p>more</p>\n</li>\n</ul>\n');
    });

    it('continues an item lazily and keeps code inside it', () => {
      expect(html('- one\ntwo\n- ```sh\n  ls\n  ```')).toBe(
        '<ul>\n<li>one\ntwo</li>\n<li><pre><code class="language-sh">ls\n</code></pre>\n</li>\n</ul>\n'
      );
    });

    it('renders task items', () => {
      expect(html('- [ ] todo\n- [x] done')).toBe(
        '<ul>\n<li><input disabled="" type="checkbox"> todo</li>\n<li><input checked="" disabled="" type="checkbox"> done</li>\n</ul>\n'
      );
      expect(html('- [x] done\n\n- [ ] later')).toBe(
        '<ul>\n<li><p><input checked="" disabled="" type="checkbox"> done</p>\n</li>\n<li><p><input disabled="" type="checkbox"> later</p>\n</li>\n</ul>\n'
      );
      expect(html('- [ ] # not a task')).toBe('<ul>\n<li>[ ] # not a task</li>\n</ul>\n');
    });

    it('starts a new list for a different bullet', () => {
      expect(html('- a\n* b')).toBe('<ul>\n<li>a</li>\n</ul>\n<ul>\n<li>b</li>\n</ul>\n');
    });
  });

  describe('tables', () => {
    it('renders alignment, escaped pipes and short rows', () => {
      const src = '| L | C | R | N |\n| :-- | :-: | --: | --- |\n| a \\| b | `c` | d |';
      expect(html(src)).toBe(
        '<table>\n<thead>\n<tr>\n<th align="left">L</th>\n<th align="center">C</th>\n<th align="right">R</th>\n<th>N</th>\n</tr>\n</thead>\n' +
          '<tbody><tr>\n<td align="left">a | b</td>\n<td align="center"><code>c</code></td>\n<td align="right">d</td>\n<td></td>\n</tr>\n</tbody></table>\n'
      );
    });

    it('interrupts a paragraph and ends at a blank line', () => {
      expect(html('intro\n| a |\n| - |\n| 1 |\n\nafter')).toBe(
        '<p>intro</p>\n<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n</tr>\n</tbody></table>\n<p>after</p>\n'
      );
    });

    it('is not a table when the delimiter row has a different column count', () => {
      expect(html('| a | b |\n| - |')).toBe('<p>| a | b |\n| - |</p>\n');
    });

    it('walks into table cells', () => {
      expect(collect('| [x](a.md) |\n| --- |\n| [y](b.md) |', 'link').map(t => t.href)).toEqual(['a.md', 'b.md']);
    });
  });

  describe('links', () => {
    it('renders inline links with titles and angle-bracket destinations', () => {
      expect(html('[a](./x.md#y "T") [b](<s p.md>)')).toBe('<p><a href="./x.md#y" title="T">a</a> <a href="s%20p.md">b</a></p>\n');
    });

    it('resolves full, collapsed and shortcut reference links, case-insensitively', () => {
      const src = '[one][Ref] [ref][] [ref]\n\n[ref]: https://example.com/a "Title"';
      expect(html(src)).toBe(
        '<p><a href="https://example.com/a" title="Title">one</a> <a href="https://example.com/a" title="Title">ref</a> <a href="https://example.com/a" title="Title">ref</a></p>\n'
      );
      expect(html('[missing] and [x][nope]')).toBe('<p>[missing] and [x][nope]</p>\n');
    });

    it('renders autolinks and bare URLs', () => {
      expect(html('<https://example.com/a?b=1&c=2> <me@example.com>')).toBe(
        '<p><a href="https://example.com/a?b=1&c=2">https://example.com/a?b=1&amp;c=2</a> <a href="mailto:me@example.com">me@example.com</a></p>\n'
      );
      expect(html('see https://example.com/x. or www.example.com')).toBe(
        '<p>see <a href="https://example.com/x">https://example.com/x</a>. or <a href="http://www.example.com">www.example.com</a></p>\n'
      );
    });

    it('keeps link text raw in the token and allows code and brackets in it', () => {
      expect(collect('[`a]` \\[b\\]](c.md)', 'link')).toMatchObject([{ href: 'c.md', text: '`a]` [b]' }]);
    });

    it('does not nest links and renders images', () => {
      expect(html('[![alt *x*](i.svg)](https://e.com)')).toBe('<p><a href="https://e.com"><img src="i.svg" alt="alt x"></a></p>\n');
      expect(collect('[a [b](c) d](e)', 'link').map(t => t.href)).toEqual(['e']);
    });
  });

  describe('blocks', () => {
    it('renders blockquotes with nested blocks and lazy continuation', () => {
      expect(html('> **Note:** a\nlazy\n> - item')).toBe(
        '<blockquote>\n<p><strong>Note:</strong> a\nlazy</p>\n<ul>\n<li>item</li>\n</ul>\n</blockquote>\n'
      );
    });

    it('renders thematic breaks', () => {
      expect(html('a\n\n---\n\n* * *')).toBe('<p>a</p>\n<hr>\n<hr>\n');
    });

    it('passes HTML comments through', () => {
      expect(html('<!-- marker -->\n\ntext')).toBe('<!-- marker --><p>text</p>\n');
    });
  });

  describe('escaping', () => {
    it('escapes <, & and quotes in text but keeps entities', () => {
      expect(html('a < b & "c" \'d\' &amp; &#169; &copy;')).toBe('<p>a &lt; b &amp; &quot;c&quot; &#39;d&#39; &amp; &#169; &copy;</p>\n');
    });

    it('escapes raw inline HTML instead of passing it through', () => {
      expect(html('x <script>alert(1)</script> <kbd>K</kbd>')).toBe(
        '<p>x &lt;script&gt;alert(1)&lt;/script&gt; &lt;kbd&gt;K&lt;/kbd&gt;</p>\n'
      );
      expect(html('<div onclick="x">\nhi\n</div>')).toBe('<p>&lt;div onclick=&quot;x&quot;&gt;\nhi\n&lt;/div&gt;</p>\n');
    });

    it('escapes quotes and angle brackets in attributes', () => {
      expect(html('[a](x"y<z> \'t"<\') ![i"](p.png "q\\"")')).toBe(
        '<p><a href="x%22y%3Cz%3E" title="t&quot;&lt;">a</a> <img src="p.png" alt="i&quot;" title="q&quot;"></p>\n'
      );
    });

    it('applies backslash escapes', () => {
      expect(html('\\*not em\\* \\[x\\] \\\\ \\a')).toBe('<p>*not em* [x] \\ \\a</p>\n');
    });

    it('drops links with script-capable schemes', () => {
      expect(html('[x](javascript:alert(1)) [y](JaVaScRiPt:a) [z](data:text/html,x)')).toBe('<p>x y z</p>\n');
    });

    it('exports the escapers', () => {
      expect(escapeHtml('<a href="x">&amp; & \'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp; &amp; &#39;&lt;/a&gt;');
      expect(escapeTextContent('A & "B" <i>')).toBe('A & "B" &lt;i&gt;');
    });
  });

  describe('hooks', () => {
    it('rewrites links through the link hook', () => {
      const out = render(tokenize('[a](#Intro) [b](other.md#x) [c](https://e.com)'), {
        link: (href: string) => (href.startsWith('#') ? `#doc-${href.slice(1).toLowerCase()}` : href.replace('.md', ''))
      });
      expect(out).toBe('<p><a href="#doc-intro">a</a> <a href="other#x">b</a> <a href="https://e.com">c</a></p>\n');
    });

    it('lets the heading hook set ids, and the slugger keeps colliding ids unique', () => {
      const slugger = createSlugger();
      const out = render(tokenize('## Setup\n\n## Setup\n\n### Set-up!'), {
        heading: ({ text, depth }: { text: string; depth: number }, inner: string) =>
          `<h${depth} id="${slugger.slug(text)}">${inner}</h${depth}>\n`
      });
      expect(out).toBe('<h2 id="setup">Setup</h2>\n<h2 id="setup-1">Setup</h2>\n<h3 id="set-up">Set-up!</h3>\n');
      expect(slugify('Heading <span>New</span> & More!')).toBe('heading-new-more');
    });
  });

  describe('unsupported constructs', () => {
    const failure = (src: string, options = {}) => {
      try {
        tokenize(src, options);
      } catch (err) {
        return err;
      }
      return null;
    };

    it('throws with file and line for a setext heading', () => {
      // lineOffset counts the frontmatter lines the caller removed.
      const err = failure('intro\n\nTitle\n=====', { file: 'docs/x.md', lineOffset: 3 });
      expect(err).toBeInstanceOf(MarkdownSyntaxError);
      expect((err as Error).message).toBe('docs/x.md:7: setext headings are not supported; use an ATX heading (#)');
    });

    it('throws for footnotes and strikethrough', () => {
      expect((failure('a\n\nb[^1]', { file: 'f.md' }) as Error).message).toMatch(/^f\.md:3: footnotes/);
      expect((failure('a ~~b~~', { file: 'f.md' }) as Error).message).toMatch(/^f\.md:1: strikethrough/);
    });

    it('does not throw for the same characters in code', () => {
      expect(html('`~~x~~` and `[^1]`')).toBe('<p><code>~~x~~</code> and <code>[^1]</code></p>\n');
    });
  });
});
