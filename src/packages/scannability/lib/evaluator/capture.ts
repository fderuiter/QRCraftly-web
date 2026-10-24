/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

/*
 * Sending a check to the worker (#1601): the caller's own frame, or a capture of the preview
 * canvas as a bitmap, falling back to its pixels.
 */
import { releaseImageHandle } from '../imageHandle';
import type { ScannabilityWorkerHandle } from '../workerFactory';
import { conclude, isCurrent } from './answer';
import { IDLE_TIMEOUT_MS } from './defaults';
import { convertBitmap, readCanvasPixels, sizedCanvas } from './pixels';
import type { EvaluatorState, Flight } from './state';
import { postOrFail } from './worker';

function sendCanvasPixels(s: EvaluatorState, owner: ScannabilityWorkerHandle, current: Flight): void {
  if (!isCurrent(s, current.seq)) return;
  const pixels = readCanvasPixels(s);
  if (!pixels) {
    conclude(s, current.seq, 'fail');
    return;
  }
  postOrFail(s, owner, current, pixels, pixels);
}

function captureAndSend(s: EvaluatorState, owner: ScannabilityWorkerHandle, current: Flight): void {
  const { seq } = current;
  if (!isCurrent(s, seq) || owner !== s.worker.handle) return;

  const canvas = sizedCanvas(s);
  if (!canvas) {
    conclude(s, seq, 'idle');
    return;
  }

  let capture: Promise<ImageBitmap> | null = null;
  if (!s.worker.offscreenDegraded) {
    try {
      capture = s.frames.captureBitmap(canvas);
    } catch {
      capture = null;
    }
  }
  if (!capture) {
    sendCanvasPixels(s, owner, current);
    return;
  }

  const size = { width: canvas.width, height: canvas.height };
  Promise.resolve(capture).then(
    (bitmap) => {
      if (!isCurrent(s, seq) || owner !== s.worker.handle) {
        releaseImageHandle(bitmap);
        return;
      }
      postOrFail(s, owner, current, bitmap, size, bitmap);
    },
    (err: unknown) => {
      if (!isCurrent(s, seq) || owner !== s.worker.handle) return;
      console.error('createImageBitmap failed, falling back to synchronous read:', err);
      sendCanvasPixels(s, owner, current);
    }
  );
}

/**
 * Sends a started request to the worker: the caller's bitmap or pixels as they are, a bitmap
 * converted here for a worker that cannot draw bitmaps, or else a capture of the canvas.
 */
export function sendToWorker(s: EvaluatorState, owner: ScannabilityWorkerHandle, current: Flight): void {
  const { imageData, imageBitmap } = current.request;
  if (imageBitmap && s.worker.offscreenDegraded) {
    // This worker cannot draw bitmaps: convert the caller's frame here and post it once.
    const pixels = convertBitmap(s, imageBitmap);
    if (!pixels) {
      conclude(s, current.seq, 'fail');
      return;
    }
    postOrFail(s, owner, current, pixels, pixels);
    return;
  }
  if (imageBitmap) {
    postOrFail(s, owner, current, imageBitmap, imageBitmap, imageBitmap);
    return;
  }
  if (imageData) {
    postOrFail(s, owner, current, imageData, imageData);
    return;
  }
  s.clock.scheduleIdle(() => captureAndSend(s, owner, current), IDLE_TIMEOUT_MS);
}
