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

export { drawQR, drawQRInternal } from './lib/renderer';
export { buildMatrix, resolveEncodedValue, type QrEncoder, type MatrixSource } from './lib/buildMatrix';
export {
  loadQrEncoder,
  createQrEncoder,
  QrEncodeError,
  QR_ENCODE_WASM_URL,
  type QrSymbolEncoder,
  type QrSymbol,
  type QrModuleGrid,
  type QrEncodeOptions,
  type QrEncodeErrorKind,
  type QrEncodedSegment,
  type QrSegmentInput,
  type QrSegmentMode,
  type QrEccLetter,
} from './lib/encoder';
export { createMatrixWorker, createMazeWorker } from './lib/workerFactory';
export {
  calculateLayout,
  getLogoMetrics,
  getIsCoveredByLogo,
  iterateMatrix,
  isAlignmentPatternZone,
  getAlignmentPatternCenters,
  ALIGNMENT_PATTERN_COORDINATES,
  type LogoMetrics,
  type LayoutMetrics,
} from './lib/utils';
export { renderBorder, renderBorderDecoration } from './lib/border';
export { renderEyes } from './lib/eyes';
export { renderModules, sampleCellLuminances, type ModuleRenderOptions } from './lib/modules';
export {
  renderFluidModules,
  clearFluidCache,
  extractFluidContours,
  drawFluidContours,
  isFinderPattern,
  isFinderSeparatorZone,
  isFinderProtected,
  type Contour,
} from './lib/fluid';
export { renderLogo } from './lib/logo';
export {
  renderMaze,
  generateMaze,
  getMazeCacheKey,
  getCachedMaze,
  clearMazeCache,
  getStyleAdaptiveMazePathWidth,
  type MazeData,
} from './lib/maze';
