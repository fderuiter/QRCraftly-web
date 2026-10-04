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
 * Determinism: only `+ - * /` on integers and doubles, and one `Math.round`, so every JavaScript
 * engine returns the same bits. Nothing here is gamma-aware; the model is fitted on the coded values
 * a camera frame holds, which is what the correction is applied to.
 */

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

/** Smallest swing, in levels of 255, a channel must show between its own off and on. Below it the channel cannot be read. */
export const MIN_CHANNEL_SWING = 40;
/** Largest residual, in levels, between the fitted model and any swatch. Past it the patch was not read cleanly. */
export const MAX_FIT_RESIDUAL = 40;
/** A channel's white level that moves by more than this many levels counts as white balance drift. */
export const WHITE_DRIFT_LEVELS = 10;
/** Smallest ratio of the determinant to the product of the diagonal. Below it the channels are too mixed to separate. */
const MIN_CONDITION = 0.25;

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

const times = (m: Matrix3, e: Rgb): Rgb => [
  m[0][0] * e[0] + m[0][1] * e[1] + m[0][2] * e[2],
  m[1][0] * e[0] + m[1][1] * e[1] + m[1][2] * e[2],
  m[2][0] * e[0] + m[2][1] * e[1] + m[2][2] * e[2],
];

/**
 * Inverts a 3x3 matrix through its cofactors.
 * @param m - The matrix.
 * @returns The inverse, or null when it is singular or the channels are too mixed to separate.
 */
function invertMatrix3(m: Matrix3): Matrix3 | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const c00 = e * i - f * h;
  const c01 = f * g - d * i;
  const c02 = d * h - e * g;
  const det = a * c00 + b * c01 + c * c02;
  const diagonal = a * e * i;
  if (!(Math.abs(det) > 0) || !(Math.abs(det) >= MIN_CONDITION * Math.abs(diagonal))) return null;
  return [
    [c00 / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [c01 / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [c02 / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

/**
 * Fits the cross-talk model to the eight swatches a camera saw.
 * @param observed - What the camera reported for each of {@link CALIBRATION_SWATCHES}, in order, in levels.
 * @returns The model, or null when the patch cannot be trusted: a channel with too little swing, a
 * channel that follows another more than itself, channels too mixed to separate, or a swatch the fit
 * misses by more than {@link MAX_FIT_RESIDUAL}.
 */
export function fitCrossTalk(observed: readonly Rgb[]): CrossTalkModel | null {
  if (observed.length !== CALIBRATION_SWATCHES.length) return null;
  const rows: number[][] = [[], [], []];
  const offset: number[] = [];
  for (let i = 0; i < 3; i++) {
    let total = 0;
    for (const swatch of observed) total += swatch[i];
    for (let j = 0; j < 3; j++) {
      let on = 0;
      let off = 0;
      CALIBRATION_SWATCHES.forEach((emitted, s) => {
        if (emitted[j] === 1) on += observed[s][i];
        else off += observed[s][i];
      });
      rows[i].push((on - off) / 4);
    }
    offset.push(total / 8 - (rows[i][0] + rows[i][1] + rows[i][2]) / 2);
  }
  const matrix: Matrix3 = [
    [rows[0][0], rows[0][1], rows[0][2]],
    [rows[1][0], rows[1][1], rows[1][2]],
    [rows[2][0], rows[2][1], rows[2][2]],
  ];
  for (let i = 0; i < 3; i++) {
    if (!(matrix[i][i] >= MIN_CHANNEL_SWING)) return null;
    for (let j = 0; j < 3; j++) if (j !== i && Math.abs(matrix[i][j]) > matrix[i][i]) return null;
  }
  const inverse = invertMatrix3(matrix);
  if (!inverse) return null;
  const offsetRgb: Rgb = [offset[0], offset[1], offset[2]];
  let residual = 0;
  CALIBRATION_SWATCHES.forEach((emitted, s) => {
    const predicted = times(matrix, emitted);
    for (let i = 0; i < 3; i++) residual = Math.max(residual, Math.abs(observed[s][i] - (predicted[i] + offset[i])));
  });
  if (residual > MAX_FIT_RESIDUAL) return null;
  const sum = times(matrix, [1, 1, 1]);
  return {
    matrix,
    offset: offsetRgb,
    inverse,
    white: [sum[0] + offset[0], sum[1] + offset[1], sum[2] + offset[2]],
    residual: Math.round(residual),
  };
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

/**
 * Follows a white balance change without a new patch: every camera channel is scaled so that white
 * lands where it was seen, matrix and black level together.
 * @param model - The model to adjust.
 * @param white - The white the camera reports now, in levels.
 * @returns The adjusted model, or the same model when the new white is unusable.
 */
function rescaleToWhite(model: CrossTalkModel, white: Rgb): CrossTalkModel {
  const gain = [white[0] / model.white[0], white[1] / model.white[1], white[2] / model.white[2]];
  if (!gain.every((g) => g > 0 && Number.isFinite(g))) return model;
  const scaleRow = (row: Rgb, g: number): Rgb => [row[0] * g, row[1] * g, row[2] * g];
  const matrix: Matrix3 = [scaleRow(model.matrix[0], gain[0]), scaleRow(model.matrix[1], gain[1]), scaleRow(model.matrix[2], gain[2])];
  const inverse = invertMatrix3(matrix);
  if (!inverse) return model;
  return {
    ...model,
    matrix,
    inverse,
    offset: [model.offset[0] * gain[0], model.offset[1] * gain[1], model.offset[2] * gain[2]],
    white: [white[0], white[1], white[2]],
  };
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

const IDENTITY: Matrix3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

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
  const plane = (): GreyPlane => ({ data: new Uint8ClampedArray(box.width * box.height), width: box.width, height: box.height });
  const planes: [GreyPlane, GreyPlane, GreyPlane] = [plane(), plane(), plane()];
  const inv = model?.inverse ?? IDENTITY;
  const off = model?.offset ?? [0, 0, 0];
  // The model gives the emitted channel as 0 (off) to 1 (on); the planes are bytes.
  const scale = model ? 255 : 1;
  for (let row = 0; row < box.height; row++) {
    let source = ((box.y + row) * image.width + box.x) * 4;
    let target = row * box.width;
    for (let column = 0; column < box.width; column++, source += 4, target++) {
      const r = image.data[source] - off[0];
      const g = image.data[source + 1] - off[1];
      const b = image.data[source + 2] - off[2];
      planes[0].data[target] = (inv[0][0] * r + inv[0][1] * g + inv[0][2] * b) * scale;
      planes[1].data[target] = (inv[1][0] * r + inv[1][1] * g + inv[1][2] * b) * scale;
      planes[2].data[target] = (inv[2][0] * r + inv[2][1] * g + inv[2][2] * b) * scale;
    }
  }
  return planes;
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
   * Checks the white of a tile's quiet zone (all three channels on) against the model.
   * @param white - The mean colour of the quiet zone, in levels.
   * @returns True when the model was rescaled to follow it.
   */
  public observeWhite(white: Rgb): boolean {
    if (!this.current || whiteShift(this.current.white, white) <= WHITE_DRIFT_LEVELS) return false;
    const next = rescaleToWhite(this.current, white);
    if (next === this.current) return false;
    this.current = next;
    this.rescaleCount += 1;
    return true;
  }
}
