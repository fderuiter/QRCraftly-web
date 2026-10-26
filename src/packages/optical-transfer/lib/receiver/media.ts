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
import workerReassemblyUrl from '../../worker-reassembly.ts?worker&url';
import workerTilesUrl from '../../worker-tiles.ts?worker&url';
/**
 * Spawns the reassembly worker that rebuilds received files off the main thread.
 * This is the only place the reassembly worker script is referenced by path.
 * @returns The reassembly worker.
 */
export function spawnReassemblyWorker(): Worker {
  return startModuleWorker(workerReassemblyUrl);
}

/**
 * Spawns one decoder worker of the multi-code receiver (#1142).
 * @returns The worker.
 */
export function spawnTileWorker(): Worker {
  return startModuleWorker(workerTilesUrl);
}

/**
 * Detaches any camera stream or file source from a video element and releases its decoder.
 * @param video The element, or null.
 * @param options `release` also pauses and reloads the element to free hardware decoders.
 */
export function detachVideoSource(video: HTMLVideoElement | null, { release = false } = {}): void {
  if (!video) return;
  if (release) video.pause();
  video.srcObject = null;
  if (typeof video.removeAttribute === 'function') {
    video.removeAttribute('src');
  }
  if (release) video.load();
}

/**
 * Starts playback, ignoring the autoplay rejection browsers raise when playback is interrupted.
 * @param video The element.
 */
export function playQuietly(video: HTMLVideoElement): void {
  const playPromise = video.play();
  if (playPromise !== undefined && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {});
  }
}
