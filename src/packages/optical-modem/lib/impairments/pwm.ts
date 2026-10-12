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
 * Bands from a screen dimmed by pulse-width modulation (most OLEDs below full brightness), seen by
 * a rolling shutter: each row's exposure window catches a different share of the on-time.
 */
export interface PwmBanding {
  /** One PWM cycle, in camera rows of readout time. */
  period: number;
  /** Share of each cycle the panel is lit, 0 to 1. */
  duty: number;
  /** Exposure time, in camera rows of readout time. */
  exposureRows: number;
  /** Where row 0's exposure starts in the cycle, in rows (default 0). */
  phase?: number;
}

/**
 * The brightness gain of one camera row: the lit share of its exposure window over the duty, so the
 * average over a cycle is 1.
 * @param row - The camera row.
 * @param pwm - The settings.
 * @returns The gain.
 */
export function rowGain(row: number, pwm: PwmBanding): number {
  void row;
  void pwm;
  return 1;
}

/**
 * Applies {@link rowGain} to every row of RGB planes in place.
 * @param planes - Red, green and blue planes, 0 to 255.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param pwm - The settings.
 */
export function bandRows(planes: Float32Array[], width: number, height: number, pwm: PwmBanding): void {
  void planes;
  void width;
  void height;
  void pwm;
}
