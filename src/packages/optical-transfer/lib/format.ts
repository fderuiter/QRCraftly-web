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
 * How a duration reads: `long` for estimates in a sentence ("about 40 seconds"), `short` for
 * compact labels ("12 s", "3 min", "1.5 h") and `eta` for the receiver's time left ("<1 s", "2 min 5 s").
 */
export type DurationStyle = 'long' | 'short' | 'eta';

/**
 * Formats a duration in seconds for the file transfer pages. Every style shows "--" for an unknown
 * (`null`, `NaN` or infinite) duration.
 * @param seconds - Duration in seconds, or null when unknown.
 * @param style - How the duration reads.
 * @returns For example "about 12 minutes", "12 s" or "2 min 5 s".
 */
export function formatDuration(seconds: number | null, style: DurationStyle): string {
  if (seconds === null || !Number.isFinite(seconds)) return '--';
  if (style === 'eta') {
    if (seconds < 1) return '<1 s';
    if (seconds < 60) return `${Math.ceil(seconds)} s`;
    return `${Math.floor(seconds / 60)} min ${Math.ceil(seconds % 60)} s`;
  }
  const long = style === 'long';
  if (seconds < 60) {
    const whole = Math.max(1, Math.round(seconds));
    return long ? `about ${whole} second${whole === 1 ? '' : 's'}` : `${whole} s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return long ? `about ${minutes} minute${minutes === 1 ? '' : 's'}` : `${minutes} min`;
  const hours = (seconds / 3600).toFixed(1);
  return long ? `about ${hours} hours` : `${hours} h`;
}
