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
 * The vector-export surface the EPS and PDF writers import (#1359). Since #1605 it only
 * re-exports the layers: the SVG reader (sceneReader, svgValues), the shared text encoding
 * (winAnsi), the Helvetica metrics (pdfFont) and the PostScript/PDF operators (pdfOperators).
 */

export { rgbToCmyk } from '@/packages/core/encoding';
export type {
  SceneElement,
  SceneGradient,
  SceneImage,
  ScenePath,
  SceneText,
  SvgScene,
} from './sceneTypes';
export { matrixScale } from './svgValues';
export { readSvgScene } from './sceneReader';
export { toLatin1Codes } from './winAnsi';
export { literalString, textWidth, winAnsiExtraPuts } from './pdfFont';
export { formatCmyk, formatMatrix, formatNum, formatRgb, pathOperators, shadingDictionary } from './pdfOperators';
