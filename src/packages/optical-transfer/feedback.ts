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
 * Webcam back channel (#1146). Experimental and off unless both pages opt in: the sender's "Let
 * the receiver steer" and the receiver's "Help the sender pick its speed" preview switches.
 */

export {
  SPEED_LADDER,
  SWITCHABLE_SYMBOL_SIZE,
  MAX_RECEIVERS,
  RECEIVER_EXPIRY_MS,
  SETTLE_MS,
  RISE_AFTER_MS,
  switchableProfile,
  createSpeedController,
  type ControllerDecision,
  type SpeedController,
  type SpeedControllerOptions,
} from './lib/feedback/controller';
export {
  createFeedbackLink,
  type CameraPermission,
  type FeedbackLink,
  type FeedbackLinkOptions,
  type FeedbackLinkState,
} from './lib/feedback/link';
export {
  FEEDBACK_WINDOW_FRAMES,
  createFeedbackMeter,
  type FeedbackMeter,
  type ReadCode,
  type ReadingMeasure,
} from './lib/feedback/meter';
