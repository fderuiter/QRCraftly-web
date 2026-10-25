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

// @vitest-environment jsdom
// Imports only the reader entry, so this suite proves the reader runs without the PDF and EPS
// writers (#1605).
import { describe, it, expect } from 'vitest';
import { parseColor, parseTransform, readSvgScene } from '../scene';

describe('SVG scene reader on its own (#1605)', () => {
  it('reads the page size from the viewBox when width and height are missing', () => {
    const scene = readSvgScene('<svg viewBox="0 0 200 100"><title> Menu </title></svg>');
    expect(scene).toEqual({ width: 200, height: 100, title: 'Menu', elements: [] });
  });

  it('reads paths with their fill rule, stroke and dash pattern', () => {
    const scene = readSvgScene(
      '<svg width="10" height="10"><path d="M0 0 H10" fill-rule="evenodd" stroke="#f00" stroke-width="2" stroke-dasharray="1 2"/></svg>'
    );
    expect(scene.elements).toEqual([
      {
        kind: 'path',
        d: 'M0 0 H10',
        fill: { color: { r: 0, g: 0, b: 0 } },
        evenOdd: true,
        stroke: { color: { r: 1, g: 0, b: 0 }, width: 2, dash: [1, 2] },
        matrix: null,
        clips: [],
      },
    ]);
  });

  it('encodes text, shifts its baseline and reads the font weight and anchor', () => {
    const scene = readSvgScene(
      '<svg width="100" height="100"><text x="5" y="50" font-size="10" font-weight="700" text-anchor="middle" dominant-baseline="hanging" fill="#fff">Hé</text></svg>'
    );
    const [text] = scene.elements;
    if (text.kind !== 'text') throw new Error('expected text');
    expect(text.codes).toEqual([72, 0xe9]);
    expect(text.y).toBeCloseTo(57.18);
    expect(text).toMatchObject({ x: 5, fontSize: 10, bold: true, anchor: 'middle', color: { r: 1, g: 1, b: 1 } });
  });

  it('applies transforms to every step and skips definitions', () => {
    const scene = readSvgScene(
      '<svg width="10" height="10"><defs><path d="M0 0"/></defs><g transform="translate(3 4)"><image href="x" width="2" height="2"/></g></svg>'
    );
    expect(scene.elements).toHaveLength(1);
    expect(scene.elements[0].matrix).toEqual(parseTransform('translate(3 4)'));
    expect(parseColor('white')).toEqual({ r: 1, g: 1, b: 1 });
  });

  it('refuses markup that is not SVG', () => {
    expect(() => readSvgScene('<html></html>')).toThrow('could not read the SVG');
  });
});
