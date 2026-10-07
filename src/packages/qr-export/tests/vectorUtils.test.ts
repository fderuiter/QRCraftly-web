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
// @ts-expect-error - jsdom type declarations
import { JSDOM } from 'jsdom';

if (typeof globalThis.DOMParser === 'undefined') {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
  });
  globalThis.DOMParser = dom.window.DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer;
  globalThis.Node = dom.window.Node;
}

import {
  parseColor,
  formatNum,
  parseSvgDocument,
  extractSvgGradients,
  parseSvgPathCommands,
} from '../index';

describe('vectorUtils', () => {
  describe('parseColor', () => {
    it('returns null for empty, none, or transparent colors', () => {
      expect(parseColor('')).toBeNull();
      expect(parseColor('none')).toBeNull();
      expect(parseColor('transparent')).toBeNull();
    });

    it('parses 3-digit hex colors', () => {
      expect(parseColor('#f00')).toEqual({ r: 1, g: 0, b: 0 });
      expect(parseColor('#0f0')).toEqual({ r: 0, g: 1, b: 0 });
      expect(parseColor('#00f')).toEqual({ r: 0, g: 0, b: 1 });
    });

    it('parses 6-digit hex colors', () => {
      expect(parseColor('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
      expect(parseColor('#00ff00')).toEqual({ r: 0, g: 1, b: 0 });
      expect(parseColor('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    });

    it('parses rgb and rgba functions', () => {
      expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 1, g: 0, b: 0 });
      expect(parseColor('rgba(0, 255, 0, 0.5)')).toEqual({ r: 0, g: 1, b: 0 });
    });

    it('parses named colors and falls back for unknown', () => {
      expect(parseColor('black')).toEqual({ r: 0, g: 0, b: 0 });
      expect(parseColor('white')).toEqual({ r: 1, g: 1, b: 1 });
      expect(parseColor('unknown_color')).toEqual({ r: 0, g: 0, b: 0 });
    });
  });

  describe('formatNum', () => {
    it('formats numbers to at most 3 decimal places without trailing zeros', () => {
      expect(formatNum(12.34567)).toBe('12.346');
      expect(formatNum(10.0)).toBe('10');
      expect(formatNum(0.5)).toBe('0.5');
      expect(formatNum(0)).toBe('0');
    });
  });

  describe('parseSvgDocument', () => {
    it('extracts width, height, and title from SVG', () => {
      const svg = `<svg width="600" height="400"><title>Custom Title</title></svg>`;
      const doc = parseSvgDocument(svg);
      expect(doc.width).toBe(600);
      expect(doc.height).toBe(400);
      expect(doc.title).toBe('Custom Title');
    });

    it('falls back to viewBox when width and height are absent', () => {
      const svg = `<svg viewBox="0 0 800 600"></svg>`;
      const doc = parseSvgDocument(svg);
      expect(doc.width).toBe(800);
      expect(doc.height).toBe(600);
    });

    it('uses default dimensions and title when attributes are missing', () => {
      const svg = `<svg></svg>`;
      const doc = parseSvgDocument(svg);
      expect(doc.width).toBe(1080);
      expect(doc.height).toBe(1080);
      expect(doc.title).toBe('QR Code');
    });
  });

  describe('extractSvgGradients', () => {
    it('extracts linear and radial gradient definitions', () => {
      const svg = `
        <svg>
          <defs>
            <linearGradient id="grad1" x1="0" y1="0" x2="100" y2="100">
              <stop offset="0%" stop-color="#ff0000"/>
              <stop offset="100%" stop-color="#0000ff"/>
            </linearGradient>
            <radialGradient id="grad2" cx="50" cy="50" r="50">
              <stop offset="0%" stop-color="#ffffff"/>
              <stop offset="1" stop-color="#000000"/>
            </radialGradient>
          </defs>
        </svg>
      `;
      const gradients = extractSvgGradients(svg);

      expect(gradients.size).toBe(2);

      const grad1 = gradients.get('grad1');
      expect(grad1).toBeDefined();
      expect(grad1?.type).toBe('linear');
      expect(grad1?.x1).toBe(0);
      expect(grad1?.y1).toBe(0);
      expect(grad1?.x2).toBe(100);
      expect(grad1?.y2).toBe(100);
      expect(grad1?.stops.length).toBe(2);
      expect(grad1?.stops[0].offset).toBe(0);
      expect(grad1?.stops[0].color).toEqual({ r: 1, g: 0, b: 0 });

      const grad2 = gradients.get('grad2');
      expect(grad2).toBeDefined();
      expect(grad2?.type).toBe('radial');
      expect(grad2?.x1).toBe(50);
      expect(grad2?.y1).toBe(50);
      expect(grad2?.x2).toBe(100); // cx + r
      expect(grad2?.stops[1].offset).toBe(1);
      expect(grad2?.stops[1].color).toEqual({ r: 0, g: 0, b: 0 });
    });
  });

  describe('parseSvgPathCommands', () => {
    it('parses absolute move and line commands', () => {
      const d = 'M 10 20 L 30 40 Z';
      const cmds = parseSvgPathCommands(d);
      expect(cmds).toEqual([
        { type: 'M', x: 10, y: 20 },
        { type: 'L', x: 30, y: 40 },
        { type: 'Z' },
      ]);
    });

    it('normalizes relative move and line commands', () => {
      const d = 'm 10 20 l 20 20 z';
      const cmds = parseSvgPathCommands(d);
      expect(cmds).toEqual([
        { type: 'M', x: 10, y: 20 },
        { type: 'L', x: 30, y: 40 },
        { type: 'Z' },
      ]);
    });

    it('handles implicit lineTo commands after move', () => {
      const d = 'M 10 20 30 40 50 60';
      const cmds = parseSvgPathCommands(d);
      expect(cmds).toEqual([
        { type: 'M', x: 10, y: 20 },
        { type: 'L', x: 30, y: 40 },
        { type: 'L', x: 50, y: 60 },
      ]);
    });

    it('converts quadratic Bezier curves Q/q into cubic Bezier curves C', () => {
      const d = 'M 0 0 Q 30 60 60 0';
      const cmds = parseSvgPathCommands(d);

      expect(cmds.length).toBe(2);
      expect(cmds[0]).toEqual({ type: 'M', x: 0, y: 0 });

      const cCmd = cmds[1];
      expect(cCmd.type).toBe('C');
      if (cCmd.type === 'C') {
        // cp1 = 0 + (2/3)*(30-0) = 20
        expect(cCmd.cp1x).toBeCloseTo(20);
        expect(cCmd.cp1y).toBeCloseTo(40);
        // cp2 = 60 + (2/3)*(30-60) = 40
        expect(cCmd.cp2x).toBeCloseTo(40);
        expect(cCmd.cp2y).toBeCloseTo(40);
        expect(cCmd.x).toBe(60);
        expect(cCmd.y).toBe(0);
      }
    });

    it('parses absolute and relative cubic Bezier curves C/c', () => {
      const d = 'M 0 0 C 10 10 20 10 30 0 c 10 -10 20 -10 30 0';
      const cmds = parseSvgPathCommands(d);

      expect(cmds.length).toBe(3);
      expect(cmds[0]).toEqual({ type: 'M', x: 0, y: 0 });
      expect(cmds[1]).toEqual({ type: 'C', cp1x: 10, cp1y: 10, cp2x: 20, cp2y: 10, x: 30, y: 0 });
      expect(cmds[2]).toEqual({ type: 'C', cp1x: 40, cp1y: -10, cp2x: 50, cp2y: -10, x: 60, y: 0 });
    });
  });
});
