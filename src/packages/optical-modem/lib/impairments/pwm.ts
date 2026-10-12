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
 * average over a cycle is 1. The lit time is found from whole cycles plus the partial ends, so the
 * cost does not grow with the exposure length.
 * @param row - The camera row.
 * @param pwm - The settings.
 * @returns The gain, from 0 (the window is dark) up to 1 / duty (the window is fully lit).
 */
export function rowGain(row: number, pwm: PwmBanding): number {
  const { period, duty, exposureRows } = pwm;
  if (duty >= 1) return 1;
  if (duty <= 0) return 0;
  if (period <= 0) return 1;
  const litLength = duty * period;
  const start = row + (pwm.phase ?? 0);
  if (exposureRows <= 0) {
    const offset = start - Math.floor(start / period) * period;
    return offset < litLength ? 1 / duty : 0;
  }
  // Lit time in [0, t), for any t: whole cycles before t, plus the lit part of the partial cycle.
  const litBefore = (t: number): number => {
    const cycles = Math.floor(t / period);
    return cycles * litLength + Math.min(t - cycles * period, litLength);
  };
  const lit = litBefore(start + exposureRows) - litBefore(start);
  return lit / (exposureRows * duty);
}

/**
 * Applies {@link rowGain} to every row of RGB planes in place. Values are not clamped: a gain above
 * 1 can push a pixel past 255, and the caller clamps.
 * @param planes - Red, green and blue planes, 0 to 255.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param pwm - The settings.
 */
export function bandRows(planes: Float32Array[], width: number, height: number, pwm: PwmBanding): void {
  for (let row = 0; row < height; row++) {
    const gain = rowGain(row, pwm);
    const from = row * width;
    for (const plane of planes) {
      for (let x = from; x < from + width; x++) plane[x] *= gain;
    }
  }
}
