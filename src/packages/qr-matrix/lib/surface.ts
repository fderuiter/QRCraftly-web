/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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
 * The drawing surface every renderer in this package draws on (#1604): a canvas 2D context, or
 * the SVG export's SvgContext, which records the same calls as SVG. It lists only the parts of
 * the canvas API the drawing code uses, so a call outside it fails to compile instead of failing
 * at SVG export time.
 *
 * The optional members are canvas features the SVG context does not reproduce: reading pixels,
 * line caps and joins, and compositing. Code that needs pixels checks for `getImageData` first.
 */
export type RenderSurface = Pick<
  CanvasRenderingContext2D,
  | 'arc'
  | 'beginPath'
  | 'bezierCurveTo'
  | 'clearRect'
  | 'closePath'
  | 'createLinearGradient'
  | 'createRadialGradient'
  | 'drawImage'
  | 'fill'
  | 'fillRect'
  | 'fillStyle'
  | 'fillText'
  | 'font'
  | 'lineTo'
  | 'lineWidth'
  | 'measureText'
  | 'moveTo'
  | 'quadraticCurveTo'
  | 'rect'
  | 'restore'
  | 'rotate'
  | 'save'
  | 'scale'
  | 'setLineDash'
  | 'stroke'
  | 'strokeRect'
  | 'strokeStyle'
  | 'textAlign'
  | 'textBaseline'
  | 'translate'
> &
  Partial<Pick<CanvasRenderingContext2D, 'getImageData' | 'globalCompositeOperation' | 'lineCap' | 'lineJoin'>>;
