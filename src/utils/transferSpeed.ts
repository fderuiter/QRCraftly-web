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

import type { TransferDensity } from '@/packages/optical-transfer';

/** The three speeds the sender offers. */
export type TransferSpeedId = 'steady' | 'balanced' | 'fast';

/** A speed: the QR density and frame rate it sets. */
interface TransferSpeed {
  id: TransferSpeedId;
  label: string;
  hint: string;
  density: TransferDensity;
  fps: number;
}

/** Steady is for older phones and dim rooms, Fast for a sharp camera held close. */
export const TRANSFER_SPEEDS: readonly TransferSpeed[] = [
  { id: 'steady', label: 'Steady', hint: 'Small QR codes at a gentle pace. Best for older phones, dim rooms or a shaky hand.', density: 'reliable', fps: 8 },
  { id: 'balanced', label: 'Balanced', hint: 'Medium QR codes. Works for most phones held steady.', density: 'balanced', fps: 15 },
  { id: 'fast', label: 'Fast', hint: 'Large QR codes at a quick pace. Needs a sharp camera close to a bright screen.', density: 'fast', fps: 24 },
];

/**
 * Finds the speed that matches a density and frame rate.
 * @param density - Chosen QR density.
 * @param fps - Chosen frames per second.
 * @returns The matching speed, or undefined when the advanced values were set by hand.
 */
export function matchTransferSpeed(density: TransferDensity, fps: number): TransferSpeed | undefined {
  return TRANSFER_SPEEDS.find((speed) => speed.density === density && speed.fps === fps);
}

/**
 * Formats a file size for the duration line.
 * @param bytes - Size in bytes.
 * @returns For example "812 B", "1.2 KB", "48 KB" or "1.25 MB".
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 10 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Formats a duration in seconds in a short form.
 * @param seconds - Duration in seconds.
 * @returns For example "12 s", "3 min" or "1.5 h".
 */
export function formatShortDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
