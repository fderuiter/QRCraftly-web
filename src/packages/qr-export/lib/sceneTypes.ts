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
 * The drawing steps the SVG reader produces and the EPS and PDF writers consume (#1359, #1605).
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** An affine matrix `[a b c d e f]`, mapping (x, y) to (a·x + c·y + e, b·x + d·y + f). */
export type Matrix = readonly [number, number, number, number, number, number];

export interface GradientStop {
  offset: number;
  color: RgbColor;
}

export interface SceneGradient {
  type: 'linear' | 'radial';
  /** Linear: `[x1 y1 x2 y2]`. Radial: `[fx fy fr cx cy r]` (start circle, end circle). */
  coords: number[];
  /** Stops sorted by offset, running from 0 to 1. */
  stops: GradientStop[];
  /** `gradientTransform`, or null for none. */
  transform: Matrix | null;
}

export type ScenePaint = { color: RgbColor } | { gradient: SceneGradient };

/** A rectangle the drawing is clipped to, as a polygon in page coordinates. */
export type SceneClip = ReadonlyArray<readonly [number, number]>;

export interface SceneBase {
  /** Transform from the element's coordinates to the page, or null for none. */
  matrix: Matrix | null;
  clips: SceneClip[];
}

export interface ScenePath extends SceneBase {
  kind: 'path';
  d: string;
  fill: ScenePaint | null;
  evenOdd: boolean;
  stroke: { color: RgbColor; width: number; dash: number[] } | null;
}

export interface SceneText extends SceneBase {
  kind: 'text';
  /** Latin-1 character codes; characters outside Latin-1 are `?`. */
  codes: number[];
  x: number;
  /** The baseline, with `dominant-baseline` already applied. */
  y: number;
  color: RgbColor;
  fontSize: number;
  bold: boolean;
  anchor: 'start' | 'middle' | 'end';
  /** Width the text is squeezed to (`textLength`), or null. */
  textLength: number | null;
}

export interface SceneImage extends SceneBase {
  kind: 'image';
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SceneElement = ScenePath | SceneText | SceneImage;

export interface SvgScene {
  width: number;
  height: number;
  title: string;
  elements: SceneElement[];
}
