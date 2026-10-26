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

import { startModuleWorker } from '@/packages/core/trustedTypes';
import workerSliceUrl from '../../worker-slice.ts?worker&url';
/**
 * Spawns the slice worker that cuts the selected file into QR frames off the main thread.
 * This is the only place the slice worker script is referenced by path.
 * @returns The slice worker.
 */
export function spawnSliceWorker(): Worker {
  return startModuleWorker(workerSliceUrl);
}

/**
 * Formats a byte count as megabytes for the transfer telemetry panel.
 * @param bytes Byte count.
 * @returns The value with two decimals and an `MB` suffix.
 */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
