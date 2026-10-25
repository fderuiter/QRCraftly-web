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
 * Canvas drawing primitives shared by the module renderers, the SVG context and the
 * social templates (rounded rects, polygons, stars and the module shape painters).
 */
export {
  clampCornerRadius,
  drawRoundRect,
  drawPoly,
  drawStar,
  drawRoughRect,
  drawScribble,
} from './lib/canvasHelpers';
export type { RenderSurface } from './lib/surface';
export { drawCircularModule, drawCircuitModule, drawStandardModule } from './lib/modulePainters';
