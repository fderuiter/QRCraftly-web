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
 * The colour cross-talk kernels of the QR colour layer (#1147), which live in the modem module
 * with the rest of the optical kernels (#1198). A separate entry point, so the transfer package
 * reaches them without the modem's frame code.
 */
import { modemKernels, type CrossTalkNumbers } from './lib/kernels';

export { loadModemKernels as loadCrossTalkKernels, type CrossTalkNumbers } from './lib/kernels';

/**
 * Fits `observed = matrix · emitted + offset` to the eight calibration swatches.
 * @param observed - 24 levels: black, R, G, B, C, M, Y, white, red first in each.
 * @returns The model, or null when the patch cannot be trusted.
 */
export function fitCrossTalkKernel(observed: readonly number[]): CrossTalkNumbers | null {
  return modemKernels().crossTalkFit(observed);
}

/**
 * Scales every camera channel of a model so that white lands on a new white.
 * @param model - The model.
 * @param white - The white the camera reports now.
 * @returns The scaled model, or null when the new white cannot be used.
 */
export function rescaleCrossTalkKernel(model: CrossTalkNumbers, white: readonly number[]): CrossTalkNumbers | null {
  return modemKernels().crossTalkRescale(model, white);
}

/**
 * Undoes the cross-talk on RGBA pixels and splits them into three byte planes.
 * @param count - Pixels.
 * @param fill - Writes the RGBA pixels, `count * 4` bytes, into the view it is given.
 * @param inverse - Inverse matrix, row by row.
 * @param offset - Black level.
 * @param scale - 255 to turn the model's 0 to 1 into bytes; 1 for raw channels.
 * @returns The red, green and blue planes one after another; a view into the module, valid until the next call.
 */
export function splitCrossTalkKernel(count: number, fill: (input: Uint8Array) => void, inverse: readonly number[], offset: readonly number[], scale: number): Uint8Array {
  return modemKernels().crossTalkSplit(count, fill, inverse, offset, scale);
}
