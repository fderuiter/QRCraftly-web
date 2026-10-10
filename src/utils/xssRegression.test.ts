/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { describe, it, expect } from 'vitest';
// @ts-expect-error - jsdom type declarations might not be installed
import { JSDOM } from 'jsdom';

if (typeof globalThis.DOMParser === 'undefined') {
  const dom = new JSDOM();
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Node = dom.window.Node;
}

import { escapeHtml, isDangerousUrl, safeJsonLdStringify, sanitizeSvg } from './security';

/**
 * Adversarial corpus for the browser trust boundaries in docs/SECURITY.md (#1350). Each SVG
 * payload is a known way to run script or make a request from an uploaded logo; whatever
 * `sanitizeSvg` returns must hold no script, handler, foreign content or remote reference.
 */

const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';
const svg = (body: string, attributes = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${XLINK} ${attributes}>${body}</svg>`;

const SVG_PAYLOADS: Record<string, string> = {
  'script element': svg('<script>window.pwned=1</script><rect width="1" height="1"/>'),
  'CDATA script': svg('<script><![CDATA[alert(1)]]></script>'),
  'namespaced script': svg('<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>'),
  'onload on the root': svg('<rect/>', 'onload="alert(1)"'),
  'mixed-case handler': svg('<rect OnClick="alert(1)" oNmOuSeOvEr="alert(2)"/>'),
  'handler on a nested element': svg('<g><circle r="1" onbegin="alert(1)"/></g>'),
  'foreignObject with HTML': svg('<foreignObject><iframe xmlns="http://www.w3.org/1999/xhtml" src="javascript:alert(1)"></iframe></foreignObject>'),
  'anchor with javascript: href': svg('<a href="javascript:alert(1)"><text>x</text></a>'),
  'animate rewriting href': svg('<a><animate attributeName="href" to="javascript:alert(1)"/><text>x</text></a>'),
  'set rewriting href': svg('<set attributeName="xlink:href" to="javascript:alert(1)"/>'),
  'iframe, embed and object': svg('<iframe src="https://evil.example"/><embed src="https://evil.example"/><object data="https://evil.example"/>'),
  'image from a remote host': svg('<image href="https://tracker.example/pixel.png" width="1" height="1"/>'),
  'xlink:href to a remote host': svg('<image xlink:href="//tracker.example/pixel.png"/>'),
  'XLink under another prefix': svg('<image xmlns:q="http://www.w3.org/1999/xlink" q:href="https://tracker.example/q.png"/>'),
  'use pointing at a remote sprite': svg('<use href="https://evil.example/sprite.svg#a"/>'),
  'javascript: with whitespace and entities': svg('<image href=" &#x6A;avascript:alert(1)"/>'),
  'HTML data URI': svg('<image href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;"/>'),
  'SVG data URI holding script': svg(`<image href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')}"/>`),
  'style @import': svg('<style>@import url(https://evil.example/a.css);</style>'),
  'style url() to a remote host': svg('<style>rect{fill:url(https://evil.example/a.svg#p)}</style><rect/>'),
  'style image-set() with a bare string': svg('<style>rect{background:image-set("https://evil.example/a.png" 1x)}</style><rect/>'),
  'style attribute url()': svg('<rect style="fill:url(//evil.example/a.svg#p)"/>'),
  'style attribute expression()': svg('<rect style="width:expression(alert(1))"/>'),
  'malformed markup': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</svg',
  'HTML document instead of SVG': '<html><body><img src=x onerror=alert(1)></body></html>',
};

const ALLOWED = new Set([
  'svg', 'g', 'defs', 'style', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path',
  'lineargradient', 'radialgradient', 'stop', 'pattern', 'image', 'text', 'tspan', 'clippath',
  'mask', 'use', 'symbol', 'marker', 'title', 'desc', 'metadata',
]);

/**
 * Lists every way a sanitized SVG could still run script or reach the network.
 * @param output - What sanitizeSvg returned.
 * @returns A description of each problem; empty when the SVG is inert.
 */
function findActiveContent(output: string): string[] {
  if (output === '') return [];
  const doc = new DOMParser().parseFromString(output, 'image/svg+xml');
  const problems: string[] = [];
  for (const element of Array.from(doc.getElementsByTagName('*'))) {
    const tag = element.localName.toLowerCase();
    if (!ALLOWED.has(tag) && tag !== 'parsererror') problems.push(`element <${tag}>`);
    for (const attr of Array.from(element.attributes)) {
      const name = attr.localName.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) problems.push(`handler ${attr.name}`);
      if (name === 'href' && value !== '' && !value.startsWith('#') && !/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/.test(value)) {
        problems.push(`${attr.name}="${attr.value}"`);
      }
      if (name === 'style' && /url\(\s*['"]?(?!#|data:image\/)[^)]/.test(value)) problems.push(`style ${attr.value}`);
    }
    if (tag === 'style' && /@import|image-set|url\(\s*['"]?(?!#|data:image\/)[^)]/i.test(element.textContent ?? '')) {
      problems.push(`style block ${element.textContent}`);
    }
  }
  return problems;
}

describe('XSS regression corpus (#1350)', () => {
  describe('sanitizeSvg leaves no active content', () => {
    for (const [name, payload] of Object.entries(SVG_PAYLOADS)) {
      it(name, () => {
        const output = sanitizeSvg(payload);
        expect(findActiveContent(output)).toEqual([]);
        expect(output).not.toMatch(/alert\(|window\.pwned|evil\.example|tracker\.example/);
      });
    }
  });

  it('keeps a plain logo intact', () => {
    const logo = svg('<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>', 'viewBox="0 0 10 10"');
    const output = sanitizeSvg(logo);
    expect(output).toContain('viewBox="0 0 10 10"');
    expect(output).toContain('fill="url(#g)"');
    expect(output).toMatch(/<linearGradient id="g">/);
  });

  describe('isDangerousUrl refuses obfuscated script links from scanned codes', () => {
    const dangerous = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' \t\njavascript:alert(1)',
      'java\tscript:alert(1)',
      'java​script:alert(1)',
      '\u0000javascript:alert(1)',
      'javascript%3Aalert(1)',
      '&#106;avascript:alert(1)',
      'javascript: alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'data:image/svg+xml,<svg onload=alert(1)>',
    ];
    for (const url of dangerous) {
      it(JSON.stringify(url), () => expect(isDangerousUrl(url)).toBe(true));
    }

    it('still opens ordinary links', () => {
      for (const url of ['https://example.com/a?b=c#d', 'http://example.com', 'mailto:a@example.com', 'tel:+15551234567']) {
        expect(isDangerousUrl(url)).toBe(false);
      }
    });
  });

  it('escapeHtml turns markup in scanned text into inert characters', () => {
    const payload = `"><img src=x onerror=alert(1)><script>alert('x')</script>`;
    const escaped = escapeHtml(payload);
    expect(escaped).not.toMatch(/[<>"']/);
    const host = new JSDOM('<div id="out"></div>').window.document;
    host.getElementById('out').innerHTML = escaped;
    expect(host.getElementById('out').children).toHaveLength(0);
    expect(host.getElementById('out').textContent).toBe(payload);
  });

  it('safeJsonLdStringify cannot close its script element', () => {
    const json = safeJsonLdStringify({ name: '</script><script>alert(1)</script>', note: '<!-- -->' });
    expect(json).not.toMatch(/<\/?script|<!--/i);
    expect(JSON.parse(json)).toEqual({ name: '</script><script>alert(1)</script>', note: '<!-- -->' });
  });
});
