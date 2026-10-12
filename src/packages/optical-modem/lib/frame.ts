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

import { getConstellation, constellationShape } from './constellation';
import { encodeHeader, parseHeader, type FrameHeader } from './header';
import { ACQUIRE_FAILURES, modemKernels, type AcquireFailure, type FiducialSearch } from './kernels';
import { BAND_ROWS, createLayout, type GridGeometry, type RgbaImage } from './layout';
import { renderFrame } from './render';

export type { AcquireFailure } from './kernels';

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
  /** Data cells across. */
  cols: number;
  /** Data cell rows. */
  dataRows: number;
  /** Homography from cell coordinates to image pixels, as 32-bit floats. */
  homography: Float32Array;
  /** Calibration colours read from the frame, three integers per symbol. */
  palette: Int32Array;
  /**
   * The sequence the top and the bottom header strip each gave when read alone, or null for a strip
   * that did not. Two different numbers mean a screen refresh tore the capture between two frames.
   */
  strips: [number | null, number | null];
}

/** Result of {@link acquireFrame}. */
export type AcquireResult = { ok: true; frame: AcquiredFrame; fiducials: FiducialSearch } | { ok: false; reason: AcquireFailure; fiducials?: FiducialSearch };

/**
 * Finds a frame in a captured image: the fiducials, then the header against each known geometry
 * and each of the four ways the fiducials could be numbered. The search runs in the modem module,
 * which keeps the image for the sampling that follows.
 * @param image - The captured frame.
 * @param geometries - Grid sizes the receiver knows about.
 * @returns The acquired frame with its live palette, or why it failed.
 */
export function acquireFrame(image: RgbaImage, geometries: readonly GridGeometry[]): AcquireResult {
  const kernels = modemKernels();
  kernels.setImage(image);
  return acquired(kernels.acquire(geometries));
}

/** Where a receiver last found a frame, so the next search can stay near it. */
export interface TrackHint {
  /** The fiducials of the last frame acquired. */
  fiducials: FiducialSearch;
  /** Cells across that frame. */
  cols: number;
}

/**
 * Cells of movement between two camera frames a tracked search allows, on top of the 4.5 cells from
 * a fiducial's centre to its edge. A handheld phone at 30 fps moves a few cells per frame; a faster
 * move falls back to the full search, which costs time but loses nothing.
 */
export const TRACK_MARGIN_CELLS = 12;

/**
 * Finds a frame near where the last one was: each fiducial is looked for in a small window around
 * its last centre, then the header is read as {@link acquireFrame} does. Locked receivers spend most
 * of their time here, and the full search, which labels every pixel, only runs to lock on (#1161).
 * @param image - The captured frame.
 * @param geometries - Grid sizes the receiver knows about.
 * @param hint - Where the last frame was.
 * @returns The acquired frame, or why it failed; the caller then falls back to {@link acquireFrame}.
 */
export function trackFrame(image: RgbaImage, geometries: readonly GridGeometry[], hint: TrackHint): AcquireResult {
  const [a, b] = hint.fiducials.points;
  // The top two fiducial centres are cols - 9 cells apart, whichever way the frame is turned.
  const cell = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, hint.cols - 9);
  const kernels = modemKernels();
  kernels.setImage(image);
  return acquired(kernels.track(geometries, hint.fiducials, cell * (4.5 + TRACK_MARGIN_CELLS)));
}

function acquired(status: number): AcquireResult {
  const kernels = modemKernels();
  const fiducials = kernels.fiducials();
  if (status !== 0) {
    const reason = ACQUIRE_FAILURES[status - 1];
    return fiducials ? { ok: false, reason, fiducials } : { ok: false, reason };
  }
  const header = parseHeader(kernels.headerMessage());
  const { size } = constellationShape(header.constellation);
  const frame: AcquiredFrame = { header, cols: header.cols, dataRows: header.rows - 2 * BAND_ROWS, homography: kernels.homography(), palette: kernels.palette(size), strips: kernels.strips() };
  return { ok: true, frame, fiducials: fiducials ?? { points: [], coreAreas: [] } };
}
