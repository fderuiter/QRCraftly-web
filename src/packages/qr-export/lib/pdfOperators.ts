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

/**
 * PostScript and PDF operator writers shared by the EPS and PDF exports (#1605): number and
 * colour formatting, gradient shading dictionaries and path operators.
 */

import { rgbToCmyk, type CmykColor } from '@/packages/core/encoding';
import { parseSvgPath, type PathCommandVisitor } from './pathParser';
import type { Matrix, RgbColor, SceneGradient } from './sceneTypes';

/** Formats a number for PostScript and PDF: at most 3 decimals, no exponent. */
export function formatNum(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/** `r g b` as three numbers. */
export const formatRgb = (c: RgbColor): string => `${formatNum(c.r)} ${formatNum(c.g)} ${formatNum(c.b)}`;

/** `c m y k` as four numbers. */
export const formatCmyk = (c: CmykColor): string =>
  `${formatNum(c.c)} ${formatNum(c.m)} ${formatNum(c.y)} ${formatNum(c.k)}`;

export const formatMatrix = (m: Matrix): string => m.map(formatNum).join(' ');

// --- shading -----------------------------------------------------------------------------

const exponential = (c0: RgbColor, c1: RgbColor, colorSpace: 'rgb' | 'cmyk' = 'rgb'): string => {
  if (colorSpace === 'cmyk') {
    return `<< /FunctionType 2 /Domain [0 1] /C0 [${formatCmyk(rgbToCmyk(c0))}] /C1 [${formatCmyk(rgbToCmyk(c1))}] /N 1 >>`;
  }
  return `<< /FunctionType 2 /Domain [0 1] /C0 [${formatRgb(c0)}] /C1 [${formatRgb(c1)}] /N 1 >>`;
};

/**
 * Builds the shading dictionary for a gradient. PostScript (LanguageLevel 3) and PDF use
 * the same syntax: an axial or radial shading over a stitching function with one segment per
 * pair of stops.
 */
export function shadingDictionary(gradient: SceneGradient, colorSpace: 'rgb' | 'cmyk' = 'rgb'): string {
  const { stops } = gradient;
  let fn: string;
  if (stops.length <= 2) {
    fn = exponential(stops[0].color, stops[stops.length - 1].color, colorSpace);
  } else {
    const segments = stops.slice(1).map((stop, i) => exponential(stops[i].color, stop.color, colorSpace));
    const bounds = stops.slice(1, -1).map((stop) => formatNum(stop.offset));
    const encode = segments.map(() => '0 1').join(' ');
    fn = `<< /FunctionType 3 /Domain [0 1] /Functions [${segments.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${encode}] >>`;
  }
  const type = gradient.type === 'linear' ? 2 : 3;
  const cs = colorSpace === 'cmyk' ? '/DeviceCMYK' : '/DeviceRGB';
  return `<< /ShadingType ${type} /ColorSpace ${cs} /Coords [${gradient.coords.map(formatNum).join(' ')}] /Function ${fn} /Extend [true true] >>`;
}

// --- paths -------------------------------------------------------------------------------

/**
 * Writes an SVG path with a writer's operators.
 * @param d - SVG path data.
 * @param ops - Operator names for move, line, curve and close.
 */
export function pathOperators(d: string, ops: { move: string; line: string; curve: string; close: string }): string {
  const out: string[] = [];
  const visitor: PathCommandVisitor = {
    moveTo: (x, y) => out.push(`${formatNum(x)} ${formatNum(y)} ${ops.move}`),
    lineTo: (x, y) => out.push(`${formatNum(x)} ${formatNum(y)} ${ops.line}`),
    curveTo: (a, b, c, d2, x, y) => out.push(`${[a, b, c, d2, x, y].map(formatNum).join(' ')} ${ops.curve}`),
    closePath: () => out.push(ops.close),
  };
  parseSvgPath(d, visitor);
  return out.join('\n');
}
