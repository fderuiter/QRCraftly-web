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

import { lumaOf } from './colour';
import { getConstellation } from './constellation';
import { HEADER_CODEWORD_BYTES, MODEM_VERSION, decodeHeader, encodeHeader, type FrameHeader } from './header';
import { HEADER_BITS, createLayout, fiducialCentre, type FrameLayout, type GridGeometry, type RgbaImage } from './layout';
import { locateFiducials, solveHomography, type FiducialSearch } from './locate';
import { renderFrame } from './render';
import { readPalette, readReferencePatches, referenceMidpoint, sampleCell, sampleDataGrid, type Palette, type SampledGrid } from './sample';

/**
 * Draws a frame: fiducials, calibration strip, header and data.
 * @param header - What the frame says about itself; its constellation picks the colours.
 * @param data - One symbol per data cell.
 * @param pitch - Pixels per cell.
 * @returns The frame.
 */
export function drawFrame(header: FrameHeader, data: Uint8Array, pitch: number): RgbaImage {
  const constellation = getConstellation(header.constellation);
  const layout = createLayout(header.cols, header.rows, constellation.size);
  return renderFrame(layout, constellation.symbols, encodeHeader(header), data, pitch);
}

/** A frame whose fiducials and header were read. */
export interface AcquiredFrame {
  header: FrameHeader;
  layout: FrameLayout;
  /** Homography from cell coordinates to image pixels, as 32-bit floats. */
  homography: Float32Array;
  palette: Palette;
}

/** Why a frame could not be acquired. */
export type AcquireFailure = 'no-fiducials' | 'no-header' | 'low-contrast' | 'unsupported-version' | 'unknown-constellation';

/** Result of {@link acquireFrame}. */
export type AcquireResult = { ok: true; frame: AcquiredFrame; fiducials: FiducialSearch } | { ok: false; reason: AcquireFailure; fiducials?: FiducialSearch };

const MIN_CONTRAST = 48;

function homographyFor(points: readonly { x: number; y: number }[], geometry: GridGeometry, rotation: number): Float32Array | null {
  const layout = createLayout(geometry.cols, geometry.rows, 2);
  // Clockwise on screen: top-left, top-right, bottom-right, bottom-left.
  const ideal = [fiducialCentre(layout, 0), fiducialCentre(layout, 1), fiducialCentre(layout, 3), fiducialCentre(layout, 2)];
  const target = [0, 1, 2, 3].map((i) => points[(i + rotation) % 4]);
  const solved = solveHomography(ideal, target);
  return solved ? Float32Array.from(solved) : null;
}

function readHeaderCodeword(image: RgbaImage, h: Float32Array, layout: FrameLayout, midpoint: number, strips: readonly Uint32Array[]): Uint8Array {
  const votes = new Int32Array(HEADER_BITS);
  const cell = new Int32Array(3);
  for (const strip of strips) {
    for (let t = 0; t < strip.length; t++) {
      const col = strip[t] % layout.cols;
      sampleCell(image, h, col, (strip[t] - col) / layout.cols, cell, 0);
      votes[t % HEADER_BITS] += lumaOf(cell[0], cell[1], cell[2]) - midpoint;
    }
  }
  const codeword = new Uint8Array(HEADER_CODEWORD_BYTES);
  for (let bit = 0; bit < HEADER_BITS; bit++) if (votes[bit] > 0) codeword[bit >> 3] |= 0x80 >> (bit & 7);
  return codeword;
}

/**
 * Finds a frame in a captured image: the fiducials, then the header against each known geometry
 * and each of the four ways the fiducials could be numbered.
 * @param image - The captured frame.
 * @param geometries - Grid sizes the receiver knows about.
 * @returns The acquired frame with its live palette, or why it failed.
 */
export function acquireFrame(image: RgbaImage, geometries: readonly GridGeometry[]): AcquireResult {
  const fiducials = locateFiducials(image);
  if (!fiducials) return { ok: false, reason: 'no-fiducials' };
  let sawContrast = false;
  for (let rotation = 0; rotation < 4; rotation++) {
    for (const geometry of geometries) {
      const h = homographyFor(fiducials.points, geometry, rotation);
      if (!h) continue;
      const probe = createLayout(geometry.cols, geometry.rows, 2);
      const patches = readReferencePatches(image, h, probe);
      const contrast = lumaOf(patches.white[0], patches.white[1], patches.white[2]) - lumaOf(patches.black[0], patches.black[1], patches.black[2]);
      if (contrast < MIN_CONTRAST) continue;
      sawContrast = true;
      // A screen refresh during readout leaves different headers in the two strips, so each is tried alone before both together.
      const midpoint = referenceMidpoint(patches);
      let header: FrameHeader | null = null;
      for (const strips of [[probe.headerTop], [probe.headerBottom], [probe.headerTop, probe.headerBottom]]) {
        header = decodeHeader(readHeaderCodeword(image, h, probe, midpoint, strips));
        if (header) break;
      }
      if (!header || header.cols !== geometry.cols || header.rows !== geometry.rows) continue;
      if (header.version !== MODEM_VERSION) return { ok: false, reason: 'unsupported-version', fiducials };
      let layout: FrameLayout;
      try {
        layout = createLayout(header.cols, header.rows, getConstellation(header.constellation).size);
      } catch {
        return { ok: false, reason: 'unknown-constellation', fiducials };
      }
      return { ok: true, frame: { header, layout, homography: h, palette: readPalette(image, h, layout) }, fiducials };
    }
  }
  return { ok: false, reason: sawContrast ? 'no-header' : 'low-contrast', fiducials };
}

/**
 * Samples every data cell of an acquired frame.
 * @param image - The captured frame.
 * @param frame - The acquired frame.
 * @returns A symbol, a confidence and the mean colour for each data cell.
 */
export function readDataCells(image: RgbaImage, frame: AcquiredFrame): SampledGrid {
  return sampleDataGrid(image, frame.homography, frame.layout, frame.palette);
}
