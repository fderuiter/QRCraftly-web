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
 * Colour cross-talk (#1147). A camera does not keep the red, green and blue emitted by a screen
 * apart: each sensor channel sees a share of the other two, and the white balance scales them again.
 * A calibration patch of eight swatches (black, R, G, B, C, M, Y, white) lets the receiver fit
 *
 *     observed = matrix · emitted + offset        (emitted is 0 or 1 per channel)
 *
 * and undo it. The eight swatches are the corners of the colour cube, so the least-squares fit has a
 * closed form with no iteration: each matrix entry is the mean over the four swatches where the
 * emitting channel is on minus the mean over the four where it is off.
 *
 * The fit, the inverse and the channel split run in the modem module (`crates/modem/src/crosstalk.rs`,
 * #1198), which rejects a patch with a channel swing under 40 levels, a channel that follows another
 * more than itself, channels too mixed to separate (determinant under a quarter of the diagonal's
 * product) or a swatch the fit misses by more than 40 levels. Only `+ - * /` on doubles, so every
 * engine returns the same bits. Nothing here is gamma-aware; the model is fitted on the coded values
 * a camera frame holds, which is what the correction is applied to. Call
 * {@link loadCrossTalkKernels} once before using it.
 */
import { fitCrossTalkKernel, rescaleCrossTalkKernel, splitCrossTalkKernel, type CrossTalkNumbers } from '@/packages/optical-modem/crosstalk';

export { loadCrossTalkKernels } from '@/packages/optical-modem/crosstalk';

/** Three channel values, red first. */
export type Rgb = readonly [number, number, number];

/** Three rows of three: row i is what camera channel i sees of each emitted channel. */
export type Matrix3 = readonly [Rgb, Rgb, Rgb];

/** Black, the primaries, the secondaries and white: the corners of the colour cube, in this order. */
export const CALIBRATION_SWATCHES: readonly Rgb[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [0, 1, 1],
  [1, 0, 1],
  [1, 1, 0],
  [1, 1, 1],
];

/** A channel's white level that moves by more than this many levels counts as white balance drift. */
export const WHITE_DRIFT_LEVELS = 10;
/** A quiet-zone white further than this share from the model's is taken for a bad sample (a box on the wrong thing), not for drift. */
const MAX_WHITE_RESCALE = 0.3;

/** The fitted camera response and its inverse. */
export interface CrossTalkModel {
  /** Row i is what camera channel i sees of emitted R, G and B (in levels). */
  matrix: Matrix3;
  /** What the camera reports with every channel off (black level, in levels). */
  offset: Rgb;
  /** Inverse of {@link CrossTalkModel.matrix}. */
  inverse: Matrix3;
  /** What the camera reports with every channel on, as the model predicts it. */
  white: Rgb;
  /** Largest difference between a swatch and the model's prediction of it, in whole levels. */
  residual: number;
}

const matrixOf = (m: readonly number[]): Matrix3 => [
  [m[0], m[1], m[2]],
  [m[3], m[4], m[5]],
  [m[6], m[7], m[8]],
];

const flat = (m: Matrix3): number[] => [...m[0], ...m[1], ...m[2]];

function modelOf(numbers: CrossTalkNumbers): CrossTalkModel {
  const { offset, white } = numbers;
  return {
    matrix: matrixOf(numbers.matrix),
    offset: [offset[0], offset[1], offset[2]],
    inverse: matrixOf(numbers.inverse),
    white: [white[0], white[1], white[2]],
    residual: numbers.residual,
  };
}

/**
 * Fits the cross-talk model to the eight swatches a camera saw.
 * @param observed - What the camera reported for each of {@link CALIBRATION_SWATCHES}, in order, in levels.
 * @returns The model, or null when the patch cannot be trusted: a channel with too little swing, a
 * channel that follows another more than itself, channels too mixed to separate, or a swatch the fit
 * misses by too much.
 */
export function fitCrossTalk(observed: readonly Rgb[]): CrossTalkModel | null {
  if (observed.length !== CALIBRATION_SWATCHES.length) return null;
  const fit = fitCrossTalkKernel(observed.flatMap((swatch) => [swatch[0], swatch[1], swatch[2]]));
  return fit ? modelOf(fit) : null;
}

/**
 * Largest per-channel difference between two white points.
 * @param a - One white point, in levels.
 * @param b - The other.
 * @returns The difference in levels.
 */
function whiteShift(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** An RGBA picture, as a canvas `ImageData` holds one. */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A single-channel picture, one byte per pixel, 0 for an emitted channel that is off and 255 for on. */
export interface GreyPlane {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A box in pixels. */
interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Splits a picture into its red, green and blue channels, undoing the cross-talk first. Each plane is
 * what that emitted channel looked like on the screen, so thresholding it alone gives that channel's
 * QR code.
 * @param image - The camera frame.
 * @param region - The part to split (the whole frame when null).
 * @param model - The fitted model; null splits the raw channels with no correction.
 * @returns The three planes, red first, each `region.width` by `region.height`.
 */
export function splitChannels(image: RgbaImage, region: Region | null, model: CrossTalkModel | null): [GreyPlane, GreyPlane, GreyPlane] {
  const box = region ?? { x: 0, y: 0, width: image.width, height: image.height };
  const count = box.width * box.height;
  const fill = (input: Uint8Array): void => {
    const pixels = new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.length);
    for (let row = 0; row < box.height; row++) {
      const source = ((box.y + row) * image.width + box.x) * 4;
      input.set(pixels.subarray(source, source + box.width * 4), row * box.width * 4);
    }
  };
  // The model gives the emitted channel as 0 (off) to 1 (on); the planes are bytes.
  const planes = splitCrossTalkKernel(count, fill, model ? flat(model.inverse) : IDENTITY, model?.offset ?? [0, 0, 0], model ? 255 : 1);
  const plane = (c: number): GreyPlane => ({ data: new Uint8ClampedArray(planes.subarray(c * count, (c + 1) * count)), width: box.width, height: box.height });
  return [plane(0), plane(1), plane(2)];
}

/** What a calibration update did. */
export type CalibrationEvent = 'fitted' | 'refit' | 'steady' | 'rejected';

/**
 * Keeps the receiver's colour model current. A patch refits it; a white balance that has moved is
 * counted as a refit; between patches the white of a tile's quiet zone rescales it.
 */
export class ColourCalibrator {
  private current: CrossTalkModel | null = null;
  private fitCount = 0;
  private driftCount = 0;
  private rejectCount = 0;
  private rescaleCount = 0;

  /** The model in use, or null before the first good patch. */
  public get model(): CrossTalkModel | null {
    return this.current;
  }

  /** Patches that gave a model. */
  public get fits(): number {
    return this.fitCount;
  }

  /** Patches whose white had moved from the model before it: white balance drift that forced a refit. */
  public get driftRefits(): number {
    return this.driftCount;
  }

  /** Patches that could not be trusted. */
  public get rejects(): number {
    return this.rejectCount;
  }

  /** Times the quiet-zone white rescaled the model between patches. */
  public get rescales(): number {
    return this.rescaleCount;
  }

  /**
   * Takes a calibration patch.
   * @param observed - The eight swatches as the camera saw them.
   * @returns "fitted" for the first model, "refit" when the white had drifted, "steady" when it had
   * not, and "rejected" when the patch was unusable (the previous model stays).
   */
  public update(observed: readonly Rgb[]): CalibrationEvent {
    const fit = fitCrossTalk(observed);
    if (!fit) {
      this.rejectCount += 1;
      return 'rejected';
    }
    const previous = this.current;
    this.current = fit;
    this.fitCount += 1;
    if (!previous) return 'fitted';
    if (whiteShift(previous.white, fit.white) > WHITE_DRIFT_LEVELS) {
      this.driftCount += 1;
      return 'refit';
    }
    return 'steady';
  }

  /**
   * Checks the white of a tile's quiet zone (all three channels on) against the model. When it has
   * moved, every camera channel is scaled so that white lands where it was seen, matrix and black
   * level together.
   * @param white - The mean colour of the quiet zone, in levels.
   * @returns True when the model was rescaled to follow it.
   */
  public observeWhite(white: Rgb): boolean {
    const model = this.current;
    if (!model || whiteShift(model.white, white) <= WHITE_DRIFT_LEVELS) return false;
    if (white.some((level, i) => Math.abs(level - model.white[i]) > MAX_WHITE_RESCALE * model.white[i])) return false;
    const next = rescaleCrossTalkKernel({ matrix: flat(model.matrix), offset: [...model.offset], inverse: flat(model.inverse), white: [...model.white], residual: model.residual }, white);
    if (!next) return false;
    this.current = modelOf(next);
    this.rescaleCount += 1;
    return true;
  }
}
