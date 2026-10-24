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

import { MULTI_RATE_PROFILES, type MultiRateProfileName } from '../multicode/multirate';
import type { FeedbackLinkState } from './link';

/**
 * What the sender says about the back channel while it sends.
 * @param state - The back channel's state.
 * @param profile - The profile on screen.
 * @param receivers - Receivers whose code the camera reads.
 * @returns One sentence, or an empty string while the back channel is off.
 */
export function steerMessage(state: FeedbackLinkState, profile: MultiRateProfileName | null, receivers: number): string {
  if (state.status === 'requesting') return 'Asking for the camera so the receiver can steer the speed.';
  if (state.status === 'listening') {
    const speed = profile ? `${MULTI_RATE_PROFILES[profile].label} speed` : 'The chosen speed';
    if (receivers === 0) return `${speed}. Point this device’s camera at the receiving screen’s small code.`;
    return `${speed}, steered by ${receivers} receiver${receivers === 1 ? '' : 's'}.`;
  }
  if (state.status === 'one-way') {
    const why =
      state.reason === 'denied'
        ? 'Camera access was refused'
        : state.reason === 'unavailable'
          ? 'No camera was found'
          : state.reason === 'camera-lost'
            ? 'The camera stopped'
            : 'The camera could not start';
    return `${why}, so this transfer runs at the speed you chose and does not stop by itself.`;
  }
  return '';
}
