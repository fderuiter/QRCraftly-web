/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
 * Colour layer (#1147). Experimental and off: `createColourSender` returns null unless a caller
 * passes `enabled: true`, and nothing in the app imports it.
 */

export {
  CALIBRATION_SWATCHES,
  ColourCalibrator,
  fitCrossTalk,
  loadCrossTalkKernels,
  splitChannels,
  type CalibrationEvent,
  type CrossTalkModel,
  type GreyPlane,
  type Matrix3,
  type Rgb,
  type RgbaImage,
} from './lib/colour/crosstalk';
export { beaconPatchRects, meanColour, samplePatch, tileRectsFromBeacon } from './lib/colour/geometry';
export {
  EMIT_DARK,
  EMIT_LIGHT,
  composeBeacon,
  composeColourTile,
  type ComposeOptions,
  type ModuleGrid,
} from './lib/colour/compose';
export {
  COLOUR_FALLBACK_BEACONS,
  COLOUR_FALLBACK_HINT,
  COLOUR_PROFILE,
  createColourSender,
  shouldFallBackToMono,
  type ColourFrame,
  type ColourLinkReport,
  type ColourProfile,
  type ColourSender,
  type ColourSenderOptions,
} from './lib/colour/profile';
export {
  ColourReceiver,
  type ColourFallbackReason,
  type ColourReceiverOptions,
  type ColourState,
  type ColourStats,
  type DecodedCode,
} from './lib/colour/receiver';
