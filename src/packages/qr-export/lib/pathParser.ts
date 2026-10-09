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

export interface PathCommandVisitor {
  moveTo?: (x: number, y: number) => void;
  lineTo?: (x: number, y: number) => void;
  curveTo?: (cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) => void;
  closePath?: () => void;
}

/**
 * Tokenizes and parses an SVG path `d` string, executing visitor callbacks
 * with absolute coordinates for each standard path command.
 */
export function parseSvgPath(d: string, handler: PathCommandVisitor): void {
  // eslint-disable-next-line security/detect-unsafe-regex
  const tokens = d.match(/([a-zA-Z]|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)/g) || [];

  let idx = 0;
  let currentCmd = '';
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  while (idx < tokens.length) {
    const token = tokens[idx];
    if (/^[a-zA-Z]$/.test(token)) {
      currentCmd = token;
      idx++;
    }

    if (currentCmd === 'M' || currentCmd === 'm') {
      if (idx + 1 >= tokens.length) break;
      const xVal = parseFloat(tokens[idx++]);
      const yVal = parseFloat(tokens[idx++]);
      curX = currentCmd === 'm' ? curX + xVal : xVal;
      curY = currentCmd === 'm' ? curY + yVal : yVal;
      startX = curX;
      startY = curY;
      handler.moveTo?.(curX, curY);
      currentCmd = currentCmd === 'M' ? 'L' : 'l';
    } else if (currentCmd === 'L' || currentCmd === 'l') {
      if (idx + 1 >= tokens.length) break;
      const xVal = parseFloat(tokens[idx++]);
      const yVal = parseFloat(tokens[idx++]);
      curX = currentCmd === 'l' ? curX + xVal : xVal;
      curY = currentCmd === 'l' ? curY + yVal : yVal;
      handler.lineTo?.(curX, curY);
    } else if (currentCmd === 'H' || currentCmd === 'h') {
      if (idx >= tokens.length) break;
      const xVal = parseFloat(tokens[idx++]);
      curX = currentCmd === 'h' ? curX + xVal : xVal;
      handler.lineTo?.(curX, curY);
    } else if (currentCmd === 'V' || currentCmd === 'v') {
      if (idx >= tokens.length) break;
      const yVal = parseFloat(tokens[idx++]);
      curY = currentCmd === 'v' ? curY + yVal : yVal;
      handler.lineTo?.(curX, curY);
    } else if (currentCmd === 'C' || currentCmd === 'c') {
      if (idx + 5 >= tokens.length) break;
      const cp1xRel = parseFloat(tokens[idx++]);
      const cp1yRel = parseFloat(tokens[idx++]);
      const cp2xRel = parseFloat(tokens[idx++]);
      const cp2yRel = parseFloat(tokens[idx++]);
      const xRel = parseFloat(tokens[idx++]);
      const yRel = parseFloat(tokens[idx++]);

      const cp1x = currentCmd === 'c' ? curX + cp1xRel : cp1xRel;
      const cp1y = currentCmd === 'c' ? curY + cp1yRel : cp1yRel;
      const cp2x = currentCmd === 'c' ? curX + cp2xRel : cp2xRel;
      const cp2y = currentCmd === 'c' ? curY + cp2yRel : cp2yRel;
      const x = currentCmd === 'c' ? curX + xRel : xRel;
      const y = currentCmd === 'c' ? curY + yRel : yRel;

      curX = x;
      curY = y;
      handler.curveTo?.(cp1x, cp1y, cp2x, cp2y, x, y);
    } else if (currentCmd === 'Q' || currentCmd === 'q') {
      if (idx + 3 >= tokens.length) break;
      const cpxRel = parseFloat(tokens[idx++]);
      const cpyRel = parseFloat(tokens[idx++]);
      const xRel = parseFloat(tokens[idx++]);
      const yRel = parseFloat(tokens[idx++]);

      const cpx = currentCmd === 'q' ? curX + cpxRel : cpxRel;
      const cpy = currentCmd === 'q' ? curY + cpyRel : cpyRel;
      const x = currentCmd === 'q' ? curX + xRel : xRel;
      const y = currentCmd === 'q' ? curY + yRel : yRel;

      // Convert quadratic Bezier to cubic Bezier
      const cp1x = curX + (2 / 3) * (cpx - curX);
      const cp1y = curY + (2 / 3) * (cpy - curY);
      const cp2x = x + (2 / 3) * (cpx - x);
      const cp2y = y + (2 / 3) * (cpy - y);

      curX = x;
      curY = y;
      handler.curveTo?.(cp1x, cp1y, cp2x, cp2y, x, y);
    } else if (currentCmd === 'Z' || currentCmd === 'z') {
      curX = startX;
      curY = startY;
      handler.closePath?.();
      // Z takes no arguments: clear it so stray numbers after it are skipped instead of looping.
      currentCmd = '';
    } else {
      idx++;
    }
  }
}
