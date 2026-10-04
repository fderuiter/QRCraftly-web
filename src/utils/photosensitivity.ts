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
 * Wording of the photosensitivity safeguards for the animated transfer stream (#1148). The stream
 * changes a large high-contrast pattern many times a second, which WCAG 2.1 SC 2.3.1 treats as a
 * seizure risk when it passes three flashes a second.
 */

/** Shown once per page visit, before the first transfer starts. */
export const PHOTOSENSITIVITY_NOTICE =
  'This screen will flash a rapidly changing pattern. If flashing light affects you, look away or ask someone else to hold the phone.';

/** Shown instead of starting at once when the device asks for reduced motion. */
export const REDUCED_MOTION_CONFIRM_TITLE = 'Your device asks for reduced motion';
export const REDUCED_MOTION_CONFIRM_BODY =
  'The transfer plays a rapidly changing pattern even so. The pace is set to Steady, the slowest. Start only if flashing does not bother you.';

/** What a person can do while the stream plays. */
export const PAUSE_HINT = 'Press Pause or the Escape key to stop the flashing at once.';

/** Read out when the stream is paused. */
export const PAUSED_ANNOUNCEMENT = 'Paused. The pattern has stopped changing.';
