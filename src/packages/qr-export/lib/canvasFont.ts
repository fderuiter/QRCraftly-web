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

/** The parts of a canvas `font` shorthand that SVG text needs as separate attributes. */
export interface CanvasFont {
  fontFamily: string;
  /** Size in CSS pixels. */
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
}

const DEFAULT_FONT: Readonly<CanvasFont> = { fontFamily: 'sans-serif', fontSize: 16, fontWeight: 'normal', fontStyle: 'normal' };

const STYLES = new Set(['italic', 'oblique']);
const WEIGHTS = new Set(['bold', 'bolder', 'lighter']);
// Keywords the shorthand allows before the size that SVG text does not need: font-variant and font-stretch.
const IGNORED = new Set([
  'normal', 'small-caps', 'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed',
  'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded',
]);
const PX_PER_UNIT: Record<string, number> = { px: 1, pt: 4 / 3, em: 16, rem: 16 };

// Size token, with an optional `/line-height` that SVG text ignores.
const SIZE_RE = /^(\d+(?:\.\d+)?|\.\d+)(px|pt|em|rem)(?:\/\S+)?$/i;

/**
 * Parses a CSS font shorthand as a canvas `font` property holds it,
 * e.g. `italic bold 52px "Open Sans", sans-serif`. A string it cannot read
 * falls back to 16px normal sans-serif, the canvas default family.
 */
export function parseCanvasFont(font: string): CanvasFont {
  const tokens = (font || '').trim().split(/\s+/);
  let fontStyle = 'normal';
  let fontWeight = 'normal';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].toLowerCase();
    const size = SIZE_RE.exec(token);
    if (size) {
      const fontFamily = tokens.slice(i + 1).join(' ');
      if (!fontFamily) return { ...DEFAULT_FONT };
      const fontSize = parseFloat(size[1]) * PX_PER_UNIT[size[2]];
      return { fontFamily, fontSize: fontSize > 0 ? fontSize : DEFAULT_FONT.fontSize, fontWeight, fontStyle };
    }
    if (STYLES.has(token)) fontStyle = token;
    else if (WEIGHTS.has(token) || /^[1-9]00$/.test(token)) fontWeight = token;
    else if (!IGNORED.has(token)) return { ...DEFAULT_FONT };
  }
  return { ...DEFAULT_FONT };
}
