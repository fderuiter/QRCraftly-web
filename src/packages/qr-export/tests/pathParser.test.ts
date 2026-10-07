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
import { parseSvgPath, type PathCommandVisitor } from '../index';

describe('pathParser', () => {
  it('parses basic absolute and relative moveTo and lineTo commands', () => {
    const events: string[] = [];
    const visitor: PathCommandVisitor = {
      moveTo(x, y) {
        events.push(`M ${x} ${y}`);
      },
      lineTo(x, y) {
        events.push(`L ${x} ${y}`);
      },
    };

    parseSvgPath('M 10 20 L 30 40 m 5 5 l 10 20', visitor);

    expect(events).toEqual([
      'M 10 20',
      'L 30 40',
      'M 35 45',
      'L 45 65',
    ]);
  });

  it('parses horizontal and vertical lineto commands (H, h, V, v)', () => {
    const events: string[] = [];
    const visitor: PathCommandVisitor = {
      moveTo(x, y) {
        events.push(`M ${x} ${y}`);
      },
      lineTo(x, y) {
        events.push(`L ${x} ${y}`);
      },
    };

    parseSvgPath('M 10 20 H 50 v 30 h -20 V 10', visitor);

    expect(events).toEqual([
      'M 10 20',
      'L 50 20',
      'L 50 50',
      'L 30 50',
      'L 30 10',
    ]);
  });

  it('handles multiple numeric parameters following H/h or V/v commands', () => {
    const events: string[] = [];
    const visitor: PathCommandVisitor = {
      moveTo(x, y) {
        events.push(`M ${x} ${y}`);
      },
      lineTo(x, y) {
        events.push(`L ${x} ${y}`);
      },
    };

    parseSvgPath('M 0 0 h 10 20 30 V 5 15', visitor);

    expect(events).toEqual([
      'M 0 0',
      'L 10 0',
      'L 30 0',
      'L 60 0',
      'L 60 5',
      'L 60 15',
    ]);
  });

  it('parses cubic (C/c) and quadratic (Q/q) curve commands', () => {
    const events: string[] = [];
    const visitor: PathCommandVisitor = {
      moveTo(x, y) {
        events.push(`M ${x} ${y}`);
      },
      curveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
        events.push(`C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)}`);
      },
    };

    parseSvgPath('M 0 0 C 10 20 30 40 50 60 q 15 30 30 0', visitor);

    expect(events).toEqual([
      'M 0 0',
      'C 10.00 20.00 30.00 40.00 50.00 60.00',
      // Q (15, 30) relative to (50, 60) -> control point (65, 90), target (80, 60)
      // Cubic conversion: cp1 = (50 + 2/3*15, 60 + 2/3*30) = (60, 80)
      // cp2 = (80 + 2/3*(65-80), 60 + 2/3*(90-60)) = (70, 80)
      'C 60.00 80.00 70.00 80.00 80.00 60.00',
    ]);
  });

  it('resets current position to subpath start (startX, startY) on Z/z and handles subsequent relative commands', () => {
    const events: string[] = [];
    const visitor: PathCommandVisitor = {
      moveTo(x, y) {
        events.push(`M ${x} ${y}`);
      },
      lineTo(x, y) {
        events.push(`L ${x} ${y}`);
      },
      closePath() {
        events.push('Z');
      },
    };

    parseSvgPath('M 10 20 L 30 40 h 10 Z l 5 5', visitor);

    expect(events).toEqual([
      'M 10 20',
      'L 30 40',
      'L 40 40',
      'Z',
      'L 15 25',
    ]);
  });

  it('handles scientific notation numbers and leading decimal points', () => {
    const events: string[] = [];
    const visitor: PathCommandVisitor = {
      moveTo(x, y) {
        events.push(`M ${x} ${y}`);
      },
      lineTo(x, y) {
        events.push(`L ${x} ${y}`);
      },
    };

    parseSvgPath('M 1.2e-2 .5 h 1e1 v -.25', visitor);

    expect(events).toEqual([
      'M 0.012 0.5',
      'L 10.012 0.5',
      'L 10.012 0.25',
    ]);
  });
});
