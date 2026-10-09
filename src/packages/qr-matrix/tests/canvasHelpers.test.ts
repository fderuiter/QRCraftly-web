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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clampCornerRadius, drawRoundRect, drawPoly, drawStar, drawRoughRect, drawScribble, drawCircularModule, drawCircuitModule, drawStandardModule } from '../canvas';

describe('canvasHelpers', () => {
  let ctx: any;

  describe('clampCornerRadius', () => {
    it('clamps radius to half of shortest side', () => {
      expect(clampCornerRadius(10, 100, 50)).toBe(10);
      expect(clampCornerRadius(30, 100, 50)).toBe(25);
      expect(clampCornerRadius(-5, 100, 50)).toBe(0);
    });

    it('correctly handles negative width and height values using their absolute values', () => {
      expect(clampCornerRadius(15, -100, -50)).toBe(15);
      expect(clampCornerRadius(30, -100, -50)).toBe(25);
    });
  });

  beforeEach(() => {
    // specific cast to allow optional methods like roundRect
    ctx = {
      roundRect: vi.fn(),
      quadraticCurveTo: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillRect: vi.fn(),
      rect: vi.fn(),
      arc: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
  });

  describe('drawRoundRect', () => {
    it('should always use unified manual path commands (quadraticCurveTo) even if roundRect is available', () => {
      drawRoundRect(ctx, 10, 20, 100, 50, 5);
      expect(ctx.roundRect).not.toHaveBeenCalled();
      
      expect(ctx.moveTo).toHaveBeenCalled(); // Starting point
      expect(ctx.lineTo).toHaveBeenCalled(); // Sides
      expect(ctx.quadraticCurveTo).toHaveBeenCalledTimes(4); // 4 corners
      expect(ctx.closePath).toHaveBeenCalled();
    });

    it('should clamp the radius if it exceeds half the width or height', () => {
      drawRoundRect(ctx, 0, 0, 100, 50, 50); // r=50 is larger than h/2 (25)

      // Expected safe radius = min(50, 50, 25) = 25
      // Verify the first moveTo command starts at safeR
      expect(ctx.moveTo).toHaveBeenCalledWith(25, 0);
    });
  });

  describe('drawPoly', () => {
    it('should draw a polygon with correct number of sides', () => {
      const sides = 6;
      drawPoly(ctx, 50, 50, 20, sides);

      expect(ctx.beginPath).toHaveBeenCalled();
      // First point is moveTo, subsequent are lineTo. Total calls = sides.
      // logic: loop 0 to sides-1. i=0 is moveTo, else lineTo.
      expect(ctx.moveTo).toHaveBeenCalledTimes(1);
      expect(ctx.lineTo).toHaveBeenCalledTimes(sides - 1);
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled(); // Default fill=true
      expect(ctx.stroke).not.toHaveBeenCalled();
    });

    it('should stroke instead of fill when fill is false', () => {
      drawPoly(ctx, 50, 50, 20, 3, 0, false);
      expect(ctx.fill).not.toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('should add to path without beginPath/fill if addToPath is true', () => {
      drawPoly(ctx, 50, 50, 20, 6, 0, true, true);
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.fill).not.toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.closePath).toHaveBeenCalled();
    });
  });

  describe('drawStar', () => {
    it('should draw a star with correct spikes', () => {
      const spikes = 5;
      drawStar(ctx, 50, 50, 20, 10, spikes);

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledTimes(1);
      // loop runs `spikes` times. Inside loop: 2 lineTo calls.
      // Plus one final lineTo after loop.
      // Total lineTo = (spikes * 2) + 1
      expect(ctx.lineTo).toHaveBeenCalledTimes((spikes * 2) + 1);
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
    });

    it('should stroke instead of fill when fill is false', () => {
      drawStar(ctx, 50, 50, 20, 10, 5, false);
      expect(ctx.fill).not.toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it('should add to path without beginPath/fill if addToPath is true', () => {
      drawStar(ctx, 50, 50, 20, 10, 5, true, true);
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.fill).not.toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.closePath).toHaveBeenCalled();
    });
  });

  describe('drawRoughRect', () => {
    it('should draw rotated path vertex commands and fill without context state saves', () => {
      drawRoughRect(ctx, 10, 10, 100, 50);

      expect(ctx.save).not.toHaveBeenCalled();
      expect(ctx.translate).not.toHaveBeenCalled();
      expect(ctx.rotate).not.toHaveBeenCalled();
      expect(ctx.restore).not.toHaveBeenCalled();
      expect(ctx.fillRect).not.toHaveBeenCalled();
      expect(ctx.rect).not.toHaveBeenCalled();

      expect(ctx.beginPath).toHaveBeenCalledTimes(1);
      expect(ctx.moveTo).toHaveBeenCalledTimes(1);
      expect(ctx.lineTo).toHaveBeenCalledTimes(3);
      expect(ctx.closePath).toHaveBeenCalledTimes(1);
      expect(ctx.fill).toHaveBeenCalledTimes(1);
    });

    it('should append rotated path vertex commands without beginPath/fill if addToPath is true', () => {
      drawRoughRect(ctx, 10, 10, 100, 50, true);

      expect(ctx.save).not.toHaveBeenCalled();
      expect(ctx.restore).not.toHaveBeenCalled();
      expect(ctx.beginPath).not.toHaveBeenCalled();
      expect(ctx.fill).not.toHaveBeenCalled();

      expect(ctx.moveTo).toHaveBeenCalledTimes(1);
      expect(ctx.lineTo).toHaveBeenCalledTimes(3);
      expect(ctx.closePath).toHaveBeenCalledTimes(1);
    });
  });

  describe('drawScribble', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Mock random to be deterministic
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it('should draw a scribble path deterministically', () => {
      drawScribble(ctx, 10, 10, 100);

      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.translate).toHaveBeenCalledWith(60, 60); // x + s/2, y + s/2
      expect(ctx.rotate).toHaveBeenCalledWith(0.1);

      expect(ctx.beginPath).toHaveBeenCalled();
      // Loop runs 8 times. i=0 moveTo, else lineTo.
      expect(ctx.moveTo).toHaveBeenCalledTimes(1);
      expect(ctx.lineTo).toHaveBeenCalledTimes(7);

      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();
    });
  });

  describe('drawCircularModule', () => {
    it('should call moveTo and arc with the scaled radius', () => {
      drawCircularModule(ctx, 50, 50, 10, 1.05);
      const expectedR = 5 * 1.05;
      expect(ctx.moveTo).toHaveBeenCalledWith(50 + expectedR, 50);
      expect(ctx.arc).toHaveBeenCalledWith(50, 50, expectedR, 0, Math.PI * 2);
    });
  });

  describe('drawCircuitModule', () => {
    it('should draw a round rect and correct links to neighbors', () => {
      drawCircuitModule(ctx, 10, 10, 15, 15, 10, true, false, true, false);
      expect(ctx.moveTo).toHaveBeenCalled();
      expect(ctx.rect).toHaveBeenCalledWith(10, 13, 6, 4);
      expect(ctx.rect).toHaveBeenCalledWith(13, 10, 4, 6);
    });
  });

  describe('drawStandardModule', () => {
    it('should use floor and Math.ceil for non-virtual rendering', () => {
      drawStandardModule(ctx, 10.2, 10.8, 10, false);
      expect(ctx.rect).toHaveBeenCalledWith(10, 10, 10, 10);
    });

    it('should use Math.round for virtual rendering', () => {
      drawStandardModule(ctx, 10.2, 10.8, 10.1, true);
      expect(ctx.rect).toHaveBeenCalledWith(10, 11, 10, 10);
    });
  });
});
