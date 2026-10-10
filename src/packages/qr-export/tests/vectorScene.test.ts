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
import { describe, it, expect } from 'vitest';
import {
  alphaToMask,
  decodeSceneImages,
  formatNum,
  parseColor,
  parseTransform,
  readSvgScene,
  shadingDictionary,
  splitAlpha,
  textWidth,
  toLatin1Codes,
} from '../index';

describe('vector scene reader (#1359)', () => {
  it('reads colours the SVG builder writes', () => {
    expect(parseColor('#f00')).toEqual({ r: 1, g: 0, b: 0 });
    expect(parseColor('#00ff0080')).toEqual({ r: 0, g: 1, b: 0 });
    expect(parseColor('rgb(0, 0, 255)')).toEqual({ r: 0, g: 0, b: 1 });
    expect(parseColor('rgba(0, 0, 255, 0)')).toBeNull();
    expect(parseColor('transparent')).toBeNull();
    expect(parseColor('none')).toBeNull();
  });

  it('formats numbers without exponents or negative zero', () => {
    expect(formatNum(-0.0001)).toBe('0');
    expect(formatNum(1 / 3)).toBe('0.333');
  });

  it('combines transform lists', () => {
    expect(parseTransform('translate(10 20) scale(2)')).toEqual([2, 0, 0, 2, 10, 20]);
    const rotated = parseTransform('rotate(90)');
    expect(rotated?.map((n) => Math.round(n))).toEqual([0, 1, -1, 0, 0, 0]);
    expect(parseTransform(null)).toBeNull();
  });

  it('pads gradient stops to run from 0 to 1 and turns one-colour gradients into a fill', () => {
    const scene = readSvgScene(
      `<svg width="10" height="10"><defs><linearGradient id="a" x1="0" y1="0" x2="10" y2="0"><stop offset="20%" stop-color="#000"/><stop offset="80%" stop-color="#fff"/></linearGradient><linearGradient id="b"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#123456"/></linearGradient></defs><path d="M0 0 H10" fill="url(#a)"/><path d="M0 0 H10" fill="url(#b)"/></svg>`
    );
    const [a, b] = scene.elements;
    if (a.kind !== 'path' || !a.fill || !('gradient' in a.fill)) throw new Error('expected a gradient');
    expect(a.fill.gradient.stops.map((stop) => stop.offset)).toEqual([0, 0.2, 0.8, 1]);
    expect(shadingDictionary(a.fill.gradient)).toContain('/Bounds [0.2 0.8]');
    expect(b.kind === 'path' && b.fill).toEqual({ color: { r: 0x12 / 255, g: 0x34 / 255, b: 0x56 / 255 } });
  });

  it('maps a cropping nested <svg> onto its box and clips to it', () => {
    const scene = readSvgScene(
      `<svg width="100" height="100"><g transform="matrix(1 0 0 1 5 5)"><svg x="10" y="10" width="20" height="20" viewBox="0 0 40 40"><image href="x" x="0" y="0" width="80" height="80"/></svg></g></svg>`
    );
    const [image] = scene.elements;
    expect(image.kind).toBe('image');
    expect(image.matrix).toEqual([0.5, 0, 0, 0.5, 15, 15]);
    expect(image.clips).toEqual([
      [
        [15, 15],
        [35, 15],
        [35, 35],
        [15, 35],
      ],
    ]);
  });

  it('measures Helvetica text and keeps only Latin-1 characters', () => {
    expect(toLatin1Codes('Aé中')).toEqual([65, 0xe9, 63]);
    expect(textWidth(toLatin1Codes('HI'), 10, false)).toBe(10);
    expect(textWidth(toLatin1Codes('é'), 10, false)).toBe(textWidth(toLatin1Codes('e'), 10, false));
  });
});

describe('vector images (#1362)', () => {
  it('decodes each image once at its largest placement, capped in size', async () => {
    const scene = readSvgScene(
      `<svg width="1000" height="1000"><image href="a" x="0" y="0" width="10" height="20"/><image href="a" x="0" y="0" width="500" height="250"/></svg>`
    );
    const asked: Array<[string, number, number]> = [];
    const images = await decodeSceneImages(scene, async (href, width, height) => {
      asked.push([href, width, height]);
      return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(255) };
    });
    expect(asked).toEqual([['a', 1024, 512]]);
    expect(images.get('a')?.alpha).toBeNull();
  });

  it('packs alpha into a 1-bit mask with padded rows', () => {
    const data = new Uint8ClampedArray(9 * 1 * 4).fill(255);
    data[3] = 0;
    const image = splitAlpha({ width: 9, height: 1, data });
    expect(image.alpha).not.toBeNull();
    expect(Array.from(alphaToMask(image, image.alpha ?? new Uint8Array()))).toEqual([0x7f, 0x80]);
  });
});
