/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
import { SvgContext } from '../index';
import { drawRoundRect } from '@/packages/qr-matrix/canvas';

/** Draws a rounded rect the way production does: the shared helper, on the SVG context. */
const roundRect = (ctx: SvgContext, x: number, y: number, w: number, h: number, r: number) =>
  drawRoundRect(ctx as unknown as CanvasRenderingContext2D, x, y, w, h, r);

describe('SvgContext', () => {
  describe('serialize', () => {
    it('produces a valid SVG wrapper', () => {
      const ctx = new SvgContext(100, 100);
      const svg = ctx.serialize();
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
      expect(svg).toContain('width="100"');
      expect(svg).toContain('height="100"');
      expect(svg).toContain('viewBox="0 0 100 100"');
    });
  });

  describe('fillRect', () => {
    it('emits a <path> element with fill color', () => {
      const ctx = new SvgContext(200, 200);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(10, 10, 50, 50);
      const svg = ctx.serialize();
      expect(svg).toContain('fill="#ff0000"');
      // Should form a closed rect path
      expect(svg).toContain('<path');
    });
  });

  describe('strokeRect', () => {
    it('emits a <path> with stroke and no fill', () => {
      const ctx = new SvgContext(200, 200);
      ctx.strokeStyle = '#0000ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(5, 5, 40, 40);
      const svg = ctx.serialize();
      expect(svg).toContain('stroke="#0000ff"');
      expect(svg).toContain('fill="none"');
      expect(svg).toContain('stroke-width="2"');
    });

    it('includes stroke-dasharray when setLineDash is called', () => {
      const ctx = new SvgContext(200, 200);
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(0, 0, 100, 100);
      const svg = ctx.serialize();
      expect(svg).toContain('stroke-dasharray="8 4"');
    });
  });

  describe('path operations', () => {
    it('fill() emits path element with current fillStyle', () => {
      const ctx = new SvgContext(200, 200);
      ctx.fillStyle = '#123456';
      ctx.beginPath();
      ctx.rect(10, 10, 30, 30);
      ctx.fill();
      const svg = ctx.serialize();
      expect(svg).toContain('fill="#123456"');
      expect(svg).toContain('<path');
    });

    it('fill() does nothing when path is empty', () => {
      const ctx = new SvgContext(200, 200);
      ctx.beginPath();
      ctx.fill(); // no path commands
      const svg = ctx.serialize();
      // Only the SVG wrapper, no paths
      expect(svg).not.toContain('<path');
    });

    it('moveTo/lineTo/closePath builds correct path data', () => {
      const ctx = new SvgContext(200, 200);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(100, 0);
      ctx.lineTo(100, 100);
      ctx.closePath();
      ctx.fill();
      const svg = ctx.serialize();
      expect(svg).toContain('M 0 0');
      expect(svg).toContain('L 100 0');
      expect(svg).toContain('L 100 100');
      expect(svg).toContain('Z');
    });

    it('arc draws a full circle as transformed cubic Bezier curves', () => {
      const ctx = new SvgContext(200, 200);
      ctx.beginPath();
      ctx.arc(50, 50, 20, 0, Math.PI * 2);
      ctx.fill();
      const svg = ctx.serialize();
      // Full circle uses four C commands
      const cCount = (svg.match(/ C /g) || []).length;
      expect(cCount).toBe(4);
    });

    it('drawRoundRect produces a closed path with Q curve commands', () => {
      const ctx = new SvgContext(200, 200);
      ctx.beginPath();
      roundRect(ctx, 10, 10, 80, 80, 10);
      ctx.fill();
      const svg = ctx.serialize();
      // Q = quadratic Bezier (used for corner curves), Z closes the path
      expect(svg).toMatch(/d="M [^"]* Q [^"]* Z"/);
    });

    it('quadraticCurveTo emits Q path command', () => {
      const ctx = new SvgContext(200, 200);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(50, 0, 50, 50);
      ctx.fill();
      const svg = ctx.serialize();
      expect(svg).toContain('Q');
    });
  });

  describe('transforms', () => {
    it('translate shifts coordinates', () => {
      const ctx = new SvgContext(200, 200);
      ctx.translate(10, 20);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.fill();
      const svg = ctx.serialize();
      // moveTo(0,0) after translate(10,20) should result in point (10,20)
      expect(svg).toContain('M 10 20');
    });

    it('save/restore restores fillStyle and transform', () => {
      const ctx = new SvgContext(200, 200);
      ctx.fillStyle = '#aabbcc';
      ctx.save();
      ctx.fillStyle = '#112233';
      ctx.translate(50, 50);
      ctx.restore();
      // After restore, fillStyle is back
      expect(ctx.fillStyle).toBe('#aabbcc');
      // And translate is undone
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.fill();
      const svg = ctx.serialize();
      expect(svg).toContain('M 0 0');
    });

    it('rotate transforms rect corners', () => {
      const ctx = new SvgContext(200, 200);
      // A small rotation should move the corners
      ctx.save();
      ctx.translate(50, 50);
      ctx.rotate(0.1);
      ctx.fillRect(-10, -10, 20, 20);
      ctx.restore();
      const svg = ctx.serialize();
      // The rect should have been drawn but with rotated coordinates (non-trivial values)
      expect(svg).toContain('<path');
    });
  });

  describe('fillText', () => {
    it('emits a <text> element', () => {
      const ctx = new SvgContext(200, 200);
      ctx.fillStyle = '#000000';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Hello', 100, 50);
      const svg = ctx.serialize();
      expect(svg).toContain('<text');
      expect(svg).toContain('Hello');
      expect(svg).toContain('text-anchor="middle"');
      expect(svg).toContain('dominant-baseline="middle"');
    });

    it('splits the canvas font shorthand into SVG font attributes (#1467)', () => {
      const ctx = new SvgContext(200, 200);
      ctx.font = 'bold 52px sans-serif';
      ctx.fillText('Headline', 10, 10);
      const svg = ctx.serialize();
      expect(svg).toContain('font-size="52"');
      expect(svg).toContain('font-weight="bold"');
      expect(svg).toContain('font-family="sans-serif"');
      expect(svg).not.toContain(' font="');
      expect(svg).not.toContain('font-style');
    });

    it('writes font-style for an italic font and escapes a quoted family', () => {
      const ctx = new SvgContext(200, 200);
      ctx.font = 'italic 600 24px "Open Sans", sans-serif';
      ctx.fillText('Sub', 10, 10);
      const svg = ctx.serialize();
      expect(svg).toContain('font-style="italic"');
      expect(svg).toContain('font-weight="600"');
      expect(svg).toContain('font-size="24"');
      expect(svg).toContain('font-family="&quot;Open Sans&quot;, sans-serif"');
    });

    it('keeps the canvas default font when none is set', () => {
      const ctx = new SvgContext(200, 200);
      ctx.fillText('Plain', 10, 10);
      const svg = ctx.serialize();
      expect(svg).toContain('font-size="10"');
      expect(svg).toContain('font-weight="normal"');
    });

    const textAttrs = (font: string): Record<string, string> => {
      const ctx = new SvgContext(200, 200);
      ctx.font = font;
      ctx.fillText('T', 0, 0);
      const tag = /<text ([^>]*)>/.exec(ctx.serialize())?.[1] ?? '';
      return Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), (m) => [m[1], m[2]]));
    };

    it('reads style, variant and line-height in any keyword order', () => {
      expect(textAttrs('small-caps italic bold 12.5px/1.2 serif')).toMatchObject({
        'font-family': 'serif', 'font-size': '12.5', 'font-weight': 'bold', 'font-style': 'italic',
      });
    });

    it('converts pt and em sizes to pixels', () => {
      expect(textAttrs('12pt serif')['font-size']).toBe('16');
      expect(textAttrs('2em serif')['font-size']).toBe('32');
    });

    it.each(['', '   ', 'sans-serif', 'bold', '16px', 'huge 16px serif'])('falls back to 16px sans-serif for %j', (font) => {
      const attrs = textAttrs(font);
      expect(attrs).toMatchObject({ 'font-family': 'sans-serif', 'font-size': '16', 'font-weight': 'normal' });
      expect(attrs).not.toHaveProperty('font-style');
    });

    it('estimates width from a fractional font size', () => {
      const ctx = new SvgContext(200, 200);
      ctx.font = 'bold 52.5px sans-serif';
      // 4 chars * 52.5 * 0.55 = 115.5; the old /(\d+)px/ read "5px" and estimated 11.
      expect(ctx.measureText('Wide').width).toBeCloseTo(115.5);
    });

    it('escapes special characters in text', () => {
      const ctx = new SvgContext(200, 200);
      ctx.fillText('<scan&me>', 10, 10);
      const svg = ctx.serialize();
      expect(svg).toContain('&lt;scan&amp;me&gt;');
    });

    it('appends textLength and lengthAdjust when maxWidth is exceeded', () => {
      const ctx = new SvgContext(200, 200);
      ctx.font = '20px sans-serif'; // Estimated char width = 20 * 0.55 = 11px per char
      // Length of "Very Long Headline Text" is 23 characters. Estimated width = 23 * 11 = 253
      ctx.fillText('Very Long Headline Text', 10, 10, 100);
      const svg = ctx.serialize();
      expect(svg).toContain('textLength="100"');
      expect(svg).toContain('lengthAdjust="spacingAndGlyphs"');
    });

    it('does not append textLength when text length is within maxWidth', () => {
      const ctx = new SvgContext(200, 200);
      ctx.font = '10px sans-serif'; // Estimated width per char = 5.5px
      ctx.fillText('Short', 10, 10, 100); // 5 chars * 5.5 = 27.5px < 100
      const svg = ctx.serialize();
      expect(svg).not.toContain('textLength');
      expect(svg).not.toContain('lengthAdjust');
    });
  });

  describe('drawImage', () => {
    it('emits an <image> element with the given src', () => {
      const ctx = new SvgContext(200, 200);
      const img = { src: 'data:image/png;base64,abc123' } as HTMLImageElement;
      ctx.drawImage(img, 10, 10, 50, 50);
      const svg = ctx.serialize();
      expect(svg).toContain('<image');
      expect(svg).toContain('data:image/png;base64,abc123');
    });

    it('skips drawImage when src is empty', () => {
      const ctx = new SvgContext(200, 200);
      const img = { src: '' } as HTMLImageElement;
      ctx.drawImage(img, 10, 10, 50, 50);
      const svg = ctx.serialize();
      expect(svg).not.toContain('<image');
    });
  });

  describe('clearRect', () => {
    it('is a no-op and does not add elements', () => {
      const ctx = new SvgContext(200, 200);
      ctx.clearRect(0, 0, 200, 200);
      const svg = ctx.serialize();
      expect(svg).not.toContain('<path');
      expect(svg).not.toContain('<rect');
    });
  });

  describe('setLineDash', () => {
    it('resets dash when called with empty array', () => {
      const ctx = new SvgContext(200, 200);
      ctx.setLineDash([5, 5]);
      ctx.setLineDash([]);
      ctx.strokeRect(0, 0, 50, 50);
      const svg = ctx.serialize();
      expect(svg).not.toContain('stroke-dasharray');
    });
  });

  describe('accessibility metadata', () => {
    it('serializes title and desc elements directly underneath the opening svg tag', () => {
      const ctx = new SvgContext(100, 100, 'Test Title', 'Test Description');
      const svg = ctx.serialize();
      expect(svg).toContain('<title>Test Title</title>');
      expect(svg).toContain('<desc>Test Description</desc>');

      // Verify they are positioned directly after the opening svg tag
      const lines = svg.split(/\r?\n/);
      const svgOpenTagIndex = lines.findIndex(line => line.startsWith('<svg'));
      expect(svgOpenTagIndex).toBeGreaterThanOrEqual(0);
      expect(lines[svgOpenTagIndex + 3]).toBe('  <title>Test Title</title>');
      expect(lines[svgOpenTagIndex + 4]).toBe('  <desc>Test Description</desc>');
    });

    it('cleanly omits title and desc tags if they are not provided', () => {
      const ctx = new SvgContext(100, 100);
      const svg = ctx.serialize();
      expect(svg).not.toContain('<title>');
      expect(svg).not.toContain('</title>');
      expect(svg).not.toContain('<desc>');
      expect(svg).not.toContain('</desc>');
    });

    it('escapes special characters inside title and description', () => {
      const ctx = new SvgContext(100, 100, 'Custom <Title> & More', 'Special <Description> & Payload');
      const svg = ctx.serialize();
      expect(svg).toContain('<title>Custom &lt;Title&gt; &amp; More</title>');
      expect(svg).toContain('<desc>Special &lt;Description&gt; &amp; Payload</desc>');
    });
  });

  describe('High-Fidelity Affine-Compliant features', () => {
    it('supports linear gradient definitions and maps to linearGradient tags in defs', () => {
      const ctx = new SvgContext(200, 200);
      const grad = ctx.createLinearGradient(10, 20, 150, 160);
      grad.addColorStop(0, '#ff0000');
      grad.addColorStop(1, '#0000ff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 200, 200);
      
      const svg = ctx.serialize();
      expect(svg).toContain('<linearGradient id="linear-grad-1" x1="10" y1="20" x2="150" y2="160"');
      expect(svg).toContain('<stop offset="0%" stop-color="#ff0000" />');
      expect(svg).toContain('<stop offset="100%" stop-color="#0000ff" />');
      expect(svg).toContain('fill="url(#linear-grad-1)"');
    });

    it('supports 3-parameter and 9-parameter image drawing operations', () => {
      const ctx = new SvgContext(300, 300);
      const img = { src: 'data:image/png;base64,foo', width: 100, height: 100 };
      
      // 3-parameter drawImage
      ctx.drawImage(img, 10, 20);
      
      // 9-parameter drawImage
      ctx.drawImage(img, 5, 5, 40, 40, 50, 60, 80, 80);
      
      const svg = ctx.serialize();
      // Expect 3-parameter image output
      expect(svg).toContain('x="10" y="20" width="100" height="100"');
      // Expect 9-parameter image output (nested svg viewBox)
      expect(svg).toContain('viewBox="5 5 40 40"');
      expect(svg).toContain('x="50" y="60" width="80" height="80"');
    });

    it('retains path coordinate data after fill to allow subsequent stroke on same path', () => {
      const ctx = new SvgContext(200, 200);
      ctx.beginPath();
      ctx.rect(10, 10, 50, 50);
      ctx.fillStyle = '#ff0000';
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 4;
      ctx.fill();
      ctx.stroke();

      const svg = ctx.serialize();
      // Should have two paths with same coordinate data
      const paths = svg.match(/<path d="M 10 10 L 60 10 L 60 60 L 10 60 Z"/g);
      expect(paths).not.toBeNull();
      expect(paths!.length).toBe(2);
      expect(svg).toContain('fill="#ff0000"');
      expect(svg).toContain('stroke="#00ff00"');
    });

    it('converts curved arcs into transformed cubic Bezier curves with rotation applied', () => {
      const ctx = new SvgContext(200, 200);
      ctx.rotate(0.5); // Apply non-identity matrix
      ctx.beginPath();
      ctx.arc(50, 50, 10, 0, Math.PI / 2); // 90 degree partial arc
      ctx.fill();

      const svg = ctx.serialize();
      // Active transform should be reflected in the computed bezier control points.
      // There shouldn't be any 'A' commands, only 'C' commands.
      expect(svg).not.toContain(' A ');
      expect(svg).toContain(' C ');
    });

    it('supports radial gradient with a zero inner radius and completely omits the fr parameter', () => {
      const ctx = new SvgContext(200, 200);
      const grad = ctx.createRadialGradient(100, 100, 0, 100, 100, 50);
      grad.addColorStop(0, '#ff0000');
      grad.addColorStop(1, '#0000ff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 200, 200);

      const svg = ctx.serialize();
      expect(svg).toContain('<radialGradient id="radial-grad-1" cx="100" cy="100" r="50" fx="100" fy="100"');
      expect(svg).not.toContain('fr=');
      expect(svg).toContain('<stop offset="0%" stop-color="#ff0000" />');
      expect(svg).toContain('<stop offset="100%" stop-color="#0000ff" />');
      expect(svg).toContain('fill="url(#radial-grad-1)"');
    });

    it('supports radial gradient with a non-zero inner radius and outputs the fr parameter', () => {
      const ctx = new SvgContext(200, 200);
      const grad = ctx.createRadialGradient(100, 100, 15, 100, 100, 50);
      grad.addColorStop(0, '#ff0000');
      grad.addColorStop(1, '#0000ff');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 200, 200);

      const svg = ctx.serialize();
      expect(svg).toContain('<radialGradient id="radial-grad-1" cx="100" cy="100" r="50" fx="100" fy="100" fr="15"');
      expect(svg).toContain('<stop offset="0%" stop-color="#ff0000" />');
      expect(svg).toContain('<stop offset="100%" stop-color="#0000ff" />');
      expect(svg).toContain('fill="url(#radial-grad-1)"');
    });

    it('ensures standard rectangle shapes match canvas coordinate boundaries and transforms precisely using _pt helper', () => {
      const ctx = new SvgContext(200, 200);
      ctx.translate(10, 10);
      ctx.rect(0, 0, 100, 50);
      ctx.fill();

      const svg = ctx.serialize();
      // rect (0,0) with translate(10,10) should have corners: (10,10), (110,10), (110,60), (10,60)
      expect(svg).toContain('d="M 10 10 L 110 10 L 110 60 L 10 60 Z"');
    });

    it('clamps corner radii on exported elements to never exceed half of shortest side', () => {
      const ctx = new SvgContext(200, 200);
      ctx.beginPath();
      // Shortest side is 50, so max safeR should be 25. Let's pass radius 40.
      roundRect(ctx, 0, 0, 100, 50, 40);
      ctx.fill();

      const svg = ctx.serialize();
      // First point at x + safeR, y => 25, 0
      expect(svg).toContain('d="M 25 0 L 75 0 Q 100 0 100 25 L 100 25 Q 100 50 75 50 L 25 50 Q 0 50 0 25 L 0 25 Q 0 0 25 0 Z"');
    });

    it('produces identical rounded corner vectors under positive and negative scales', () => {
      // Under scale(2, 2)
      const ctxPos = new SvgContext(200, 200);
      ctxPos.scale(2, 2);
      ctxPos.beginPath();
      roundRect(ctxPos, 0, 0, 50, 25, 10);
      ctxPos.fill();
      const svgPos = ctxPos.serialize();

      // Under scale(-2, -2)
      const ctxNeg = new SvgContext(200, 200);
      ctxNeg.scale(-2, -2);
      ctxNeg.beginPath();
      // Draw standard clockwise sequence with scaled dimensions
      roundRect(ctxNeg, 0, 0, 50, 25, 10);
      ctxNeg.fill();
      const svgNeg = ctxNeg.serialize();

      // Verify positive scale coordinates match the shape scaling directly
      expect(svgPos).toContain('d="M 20 0 L 80 0 Q 100 0 100 20 L 100 30 Q 100 50 80 50 L 20 50 Q 0 50 0 30 L 0 20 Q 0 0 20 0 Z"');

      // Verify negative scale produces identical clockwise structure in coordinate output
      // Since it's scaled by -2, coordinates are multiplied by -2, and any -0 or 0 is normalized appropriately
      expect(svgNeg).toContain('d="M -20 0 L -80 0 Q -100 0 -100 -20 L -100 -30 Q -100 -50 -80 -50 L -20 -50 Q 0 -50 0 -30 L 0 -20 Q 0 0 -20 0 Z"');
    });
  });
});
