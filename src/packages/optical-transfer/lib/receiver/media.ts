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
 * Spawns the reassembly worker that rebuilds received files off the main thread.
 * This is the only place the reassembly worker script is referenced by path.
 * @returns The reassembly worker.
 */
export function spawnReassemblyWorker(): Worker {
  return new Worker(new URL('../../worker-reassembly.ts', import.meta.url), { type: 'module' });
}

/**
 * Spawns one decoder worker of the multi-code receiver (#1142).
 * @returns The worker.
 */
export function spawnTileWorker(): Worker {
  return new Worker(new URL('../../worker-tiles.ts', import.meta.url), { type: 'module' });
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

/**
 * Checks whether an uploaded file is a video the receiver can scan.
 * @param file The uploaded file.
 */
export function isVideoFile(file: File): boolean {
  return file.type ? file.type.startsWith('video/') : /\.(mp4|webm|ogg|mov|mkv|avi|3gp|m4v)$/i.test(file.name);
}
