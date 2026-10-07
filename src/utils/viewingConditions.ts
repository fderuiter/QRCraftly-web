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

import type { QRConfig } from '../types';
import { createScannabilityEvaluator, type PixelFrame, type ScannabilityStatus } from '@/packages/scannability';
import { formatDistance } from './printGuidance';

/** Side of the square frame each condition is drawn into and decoded from, in pixels. */
const FRAME_PX = 512;
/** Width a phone scan frame captures (a 720p preview). */
const CAMERA_FRAME_PX = 1280;
/** A phone camera sees a scene about 1.27 times as wide as the distance to it (a 65 degree lens). */
const CAMERA_VIEW_FACTOR = 1.27;
/** Smallest raster the distance test shrinks the code to. */
const MIN_RASTER_PX = 4;
/** Distances the test looks from, in centimetres. */
const TEST_DISTANCES_CM = [100, 200, 300];
/** Tilt of the code away from the camera in the angle test, in degrees. */
const TEST_TILT_DEGREES = 60;

/** One real-world condition to try the code under. */
export type ViewingCondition =
  | { id: string; label: string; kind: 'none' }
  | { id: string; label: string; kind: 'distance'; distanceCm: number; widthCm: number }
  | { id: string; label: string; kind: 'glare' | 'low-light' | 'angle' };

/** The outcome of one condition. `passed` is null when the check could not run. */
export interface ViewingResult {
  id: string;
  label: string;
  passed: boolean | null;
}

/**
 * How many pixels across a phone sees a printed code from a distance. Fewer pixels than the code
 * has modules means it cannot be read, which is what the distance test reproduces.
 * @param widthCm - Printed width of the code in centimetres.
 * @param distanceCm - Distance from the camera in centimetres.
 * @returns Pixels across the code in a typical scan frame.
 */
export function pixelsAcross(widthCm: number, distanceCm: number): number {
  return (CAMERA_FRAME_PX * widthCm) / (distanceCm * CAMERA_VIEW_FACTOR);
}

/**
 * The conditions the viewing test tries: the design as it is, three distances at the printed size,
 * glare, low light and a steep angle.
 * @param widthCm - Printed width of the code in centimetres.
 * @returns The conditions, in the order they are shown.
 */
export function viewingConditions(widthCm: number): ViewingCondition[] {
  return [
    { id: 'as-designed', label: 'As designed', kind: 'none' },
    ...TEST_DISTANCES_CM.map((distanceCm): ViewingCondition => ({
      id: `distance-${distanceCm}`,
      label: `From ${formatDistance(distanceCm)} away`,
      kind: 'distance',
      distanceCm,
      widthCm,
    })),
    { id: 'glare', label: 'Glare across the print', kind: 'glare' },
    { id: 'low-light', label: 'Dim light', kind: 'low-light' },
    { id: 'angle', label: `Tilted ${TEST_TILT_DEGREES}°`, kind: 'angle' },
  ];
}

/** Reusable pool of offscreen canvas instances to prevent memory churn and frame drops during condition analysis. */
class CanvasPool {
  private frameCanvas: HTMLCanvasElement | null = null;
  private frameCtx: CanvasRenderingContext2D | null = null;
  private auxCanvas: HTMLCanvasElement | null = null;
  private auxCtx: CanvasRenderingContext2D | null = null;

  /**
   * Acquires the main 512x512 frame canvas, resetting context properties and clearing state.
   */
  getFrame(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    if (!this.frameCanvas) {
      if (typeof document === 'undefined') return null;
      this.frameCanvas = document.createElement('canvas');
      this.frameCanvas.width = FRAME_PX;
      this.frameCanvas.height = FRAME_PX;
    }
    if (!this.frameCtx) {
      this.frameCtx = this.frameCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this.frameCtx) return null;

    if (this.frameCanvas.width !== FRAME_PX) this.frameCanvas.width = FRAME_PX;
    if (this.frameCanvas.height !== FRAME_PX) this.frameCanvas.height = FRAME_PX;

    this.frameCtx.setTransform?.(1, 0, 0, 1, 0, 0);
    this.frameCtx.imageSmoothingEnabled = true;
    this.frameCtx.globalAlpha = 1.0;
    this.frameCtx.globalCompositeOperation = 'source-over';
    this.frameCtx.clearRect(0, 0, FRAME_PX, FRAME_PX);

    return { canvas: this.frameCanvas, ctx: this.frameCtx };
  }

  /**
   * Acquires an auxiliary transformation canvas resized to (width x height) and cleared.
   */
  getAux(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
    if (!this.auxCanvas) {
      if (typeof document === 'undefined') return null;
      this.auxCanvas = document.createElement('canvas');
    }
    if (!this.auxCtx) {
      this.auxCtx = this.auxCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this.auxCtx) return null;

    if (this.auxCanvas.width !== width) this.auxCanvas.width = width;
    if (this.auxCanvas.height !== height) this.auxCanvas.height = height;

    this.auxCtx.setTransform?.(1, 0, 0, 1, 0, 0);
    this.auxCtx.imageSmoothingEnabled = true;
    this.auxCtx.globalAlpha = 1.0;
    this.auxCtx.globalCompositeOperation = 'source-over';
    this.auxCtx.clearRect(0, 0, width, height);

    return { canvas: this.auxCanvas, ctx: this.auxCtx };
  }
}

const canvasPool = new CanvasPool();

/**
 * Tries each condition in turn: draws the code under it, then asks `evaluate` whether it still
 * scans. A condition that cannot be drawn or checked reports `null` rather than a guess.
 * @param conditions - What to try.
 * @param render - Draws the code under a condition, or returns null when it cannot.
 * @param evaluate - Resolves the scan status of a frame, or null when no answer came back.
 * @returns One result per condition.
 */
export async function runViewingTest(
  conditions: readonly ViewingCondition[],
  render: (condition: ViewingCondition) => PixelFrame | null,
  evaluate: (frame: PixelFrame) => Promise<ScannabilityStatus | null>
): Promise<ViewingResult[]> {
  const results: ViewingResult[] = [];
  for (const condition of conditions) {
    const frame = render(condition);
    let status: ScannabilityStatus | null = null;
    if (frame) {
      status = await evaluate(frame);
    }
    results.push({
      id: condition.id,
      label: condition.label,
      passed: status === null ? null : status === 'digital-pass' || status === 'physical-pass',
    });
  }
  return results;
}

/**
 * Draws a canvas into a square frame, kept in proportion on white, using the reusable canvas pool.
 * @param source - The preview canvas.
 * @returns The frame canvas, or null when no 2D context is available.
 */
function frameFrom(source: HTMLCanvasElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (source.width === 0 || source.height === 0) return null;
  const frame = canvasPool.getFrame();
  if (!frame) return null;
  const { canvas, ctx } = frame;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, FRAME_PX, FRAME_PX);
  const scale = Math.min(FRAME_PX / source.width, FRAME_PX / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  ctx.drawImage(source, (FRAME_PX - width) / 2, (FRAME_PX - height) / 2, width, height);
  return { canvas, ctx };
}

/**
 * Draws the preview under one viewing condition and reads its pixels.
 * @param source - The preview canvas.
 * @param condition - The condition to apply.
 * @returns The pixels, or null when the browser cannot draw them.
 */
export function renderCondition(source: HTMLCanvasElement, condition: ViewingCondition): PixelFrame | null {
  const frame = frameFrom(source);
  if (!frame) return null;
  const { canvas, ctx } = frame;

  switch (condition.kind) {
    case 'distance': {
      const raster = Math.round(Math.min(FRAME_PX, Math.max(MIN_RASTER_PX, pixelsAcross(condition.widthCm, condition.distanceCm))));
      if (raster < FRAME_PX) {
        // Shrink to what a camera would resolve, then stretch back so the decoder sees the blur.
        const aux = canvasPool.getAux(raster, raster);
        if (!aux) return null;
        const { canvas: small, ctx: smallCtx } = aux;
        smallCtx.imageSmoothingEnabled = true;
        smallCtx.drawImage(canvas, 0, 0, raster, raster);
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, FRAME_PX, FRAME_PX);
        ctx.drawImage(small, 0, 0, FRAME_PX, FRAME_PX);
      }
      break;
    }
    case 'glare': {
      const gradient = ctx.createRadialGradient(FRAME_PX * 0.68, FRAME_PX * 0.32, 0, FRAME_PX * 0.68, FRAME_PX * 0.32, FRAME_PX * 0.4);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      gradient.addColorStop(0.6, 'rgba(255, 255, 255, 0.55)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, FRAME_PX, FRAME_PX);
      break;
    }
    case 'low-light': {
      ctx.fillStyle = 'rgba(20, 20, 30, 0.62)';
      ctx.fillRect(0, 0, FRAME_PX, FRAME_PX);
      const image = ctx.getImageData(0, 0, FRAME_PX, FRAME_PX);
      // Sensor noise grows in the dark.
      for (let index = 0; index < image.data.length; index += 4) {
        const noise = (Math.random() - 0.5) * 36;
        image.data[index] = Math.min(255, Math.max(0, image.data[index] + noise));
        image.data[index + 1] = Math.min(255, Math.max(0, image.data[index + 1] + noise));
        image.data[index + 2] = Math.min(255, Math.max(0, image.data[index + 2] + noise));
      }
      ctx.putImageData(image, 0, 0);
      break;
    }
    case 'angle': {
      const aux = canvasPool.getAux(FRAME_PX, FRAME_PX);
      if (!aux) return null;
      const { canvas: copy, ctx: copyCtx } = aux;
      copyCtx.drawImage(canvas, 0, 0);
      const squash = Math.cos((TEST_TILT_DEGREES * Math.PI) / 180);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, FRAME_PX, FRAME_PX);
      ctx.drawImage(copy, (FRAME_PX * (1 - squash)) / 2, 0, FRAME_PX * squash, FRAME_PX);
      break;
    }
    case 'none':
      break;
  }

  return ctx.getImageData(0, 0, FRAME_PX, FRAME_PX);
}

/**
 * Runs the viewing test on the live preview with the headless scannability evaluator, so every
 * condition is judged by the same decoder and print simulation as the Scannability check.
 * @param source - The preview canvas.
 * @param config - The QR configuration being previewed.
 * @param moduleCount - Modules per side of the QR matrix.
 * @param widthCm - Printed width of the code in centimetres.
 * @returns One result per condition.
 */
export async function testViewingConditions(source: HTMLCanvasElement, config: QRConfig, moduleCount: number, widthCm: number): Promise<ViewingResult[]> {
  const evaluator = createScannabilityEvaluator({ config });
  try {
    return await runViewingTest(
      viewingConditions(widthCm),
      (condition) => renderCondition(source, condition),
      async (frame) => (await evaluator.check({ imageData: { data: new Uint8ClampedArray(frame.data), width: frame.width, height: frame.height }, moduleCount }))?.status ?? null
    );
  } finally {
    evaluator.destroy();
  }
}
