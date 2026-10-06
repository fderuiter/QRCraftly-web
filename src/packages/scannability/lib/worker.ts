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

import { assertWorkerRequest, assertWorkerResponse } from './sharedContract';
import { loadQrReader } from '@/packages/qr-decode';
import { scannabilitySteps, type OpticalScratchBuffers, type PixelFrame } from './checker';
import { releaseImageHandle } from './imageHandle';

let latestConfigId: string | undefined;
let cachedCanvas: OffscreenCanvas | null = null;
let cachedCtx: OffscreenCanvasRenderingContext2D | null = null;
const scratch: OpticalScratchBuffers = {};

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

declare const self: {
  onmessage: ((e: MessageEvent<unknown>) => void | Promise<void>) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const postWorkerMessage = (message: unknown, transfer?: Transferable[]) => {
  if (transfer && transfer.length > 0) {
    self.postMessage(message, transfer);
  } else {
    self.postMessage(message);
  }
};

const acknowledgeDroppedRequest = (configId: string) => {
  const response = { configId, dropped: true as const };
  assertWorkerResponse(response);
  postWorkerMessage(response);
};

const requestImageDataRetry = (configId: string) => {
  const response = { configId, retryWithImageData: true as const };
  assertWorkerResponse(response);
  postWorkerMessage(response);
};

/**
 * Draws a transferred ImageBitmap into a cached OffscreenCanvas and reads its pixels.
 * Throws where OffscreenCanvas 2D is unavailable; the caller asks the main thread for ImageData.
 */
function extractPixels(imageBitmap: ImageBitmap, width: number, height: number): PixelFrame {
  if (typeof OffscreenCanvas === 'undefined') {
    throw new Error('OffscreenCanvas is not supported in this environment');
  }
  if (!cachedCanvas || cachedCanvas.width !== width || cachedCanvas.height !== height) {
    cachedCanvas = new OffscreenCanvas(width, height);
    cachedCtx = cachedCanvas.getContext('2d');
  }
  if (!cachedCtx) {
    throw new Error('Failed to get 2d context on OffscreenCanvas');
  }
  cachedCtx.clearRect(0, 0, width, height);
  cachedCtx.drawImage(imageBitmap, 0, 0);
  const extracted = cachedCtx.getImageData(0, 0, width, height);
  return { data: extracted.data, width, height };
}

/**
 * Handles incoming messages to process QR code scannability off the main UI thread.
 *
 * The check itself is `scannabilitySteps`, the same implementation the main-thread fallback runs.
 * This handler only adds transport concerns: request validation, ImageBitmap extraction,
 * cooperative cancellation of superseded requests between steps, and buffer recycling.
 * @param e - The message event containing worker request data.
 */
self.onmessage = async (e: MessageEvent<unknown>) => {
  let configId: string | undefined;
  let imageBitmap: ImageBitmap | undefined;
  let sequenceId: number | undefined;
  let reqBuffer: ArrayBuffer | undefined;

  const isStale = () => configId !== undefined && latestConfigId !== configId;

  try {
    if (e.data && typeof e.data === 'object') {
      const d = e.data as Record<string, unknown>;
      configId = typeof d.configId === 'string' ? d.configId : undefined;
      imageBitmap =
        d.imageBitmap && typeof d.imageBitmap === 'object' ? (d.imageBitmap as ImageBitmap) : undefined;
      sequenceId = typeof d.sequenceId === 'number' ? d.sequenceId : undefined;
      reqBuffer = d.buffer instanceof ArrayBuffer ? d.buffer : undefined;
    }

    if (configId !== undefined) {
      latestConfigId = configId;
    }

    // Yield immediately to let incoming messages register and cancel stale requests
    await yieldToEventLoop();

    if (configId !== undefined && isStale()) {
      releaseImageHandle(imageBitmap);
      imageBitmap = undefined;
      acknowledgeDroppedRequest(configId);
      return;
    }

    assertWorkerRequest(e.data);
    const { imageData: reqImageData, width, height, moduleCount } = e.data;

    let frame: PixelFrame;
    if (imageBitmap) {
      try {
        frame = extractPixels(imageBitmap, width, height);
      } catch {
        if (configId !== undefined) {
          requestImageDataRetry(configId);
          return;
        }
        throw new Error('Worker image extraction failed');
      } finally {
        releaseImageHandle(imageBitmap);
        imageBitmap = undefined;
      }
    } else if (reqImageData) {
      frame = { data: reqImageData.data, width, height };
    } else {
      throw new Error('Neither imageData nor imageBitmap provided');
    }

    const steps = scannabilitySteps(await loadQrReader(), frame, moduleCount, scratch);
    let step = configId !== undefined && isStale() ? null : steps.next();
    while (step && !step.done) {
      // Yield between stages so a newer request can supersede this one
      await yieldToEventLoop();
      step = isStale() ? null : steps.next();
    }

    if (!step || isStale()) {
      if (configId !== undefined) acknowledgeDroppedRequest(configId);
      return;
    }

    // Hand the pooled ArrayBuffer back to the main thread (zero-copy double buffering)
    const recycled = reqBuffer && reqBuffer.byteLength > 0 ? reqBuffer : undefined;
    const response = { ...step.value, configId, sequenceId, buffer: recycled };
    assertWorkerResponse(response);
    postWorkerMessage(response, recycled ? [recycled] : undefined);
  } catch (err) {
    releaseImageHandle(imageBitmap);
    imageBitmap = undefined;

    if (configId !== undefined && isStale()) {
      acknowledgeDroppedRequest(configId);
      return;
    }
    const isValidationError =
      err instanceof Error &&
      (err.message.includes('Worker request') || err.message.includes('Worker response'));
    const response = {
      success: false,
      physicalReady: false,
      error: isValidationError ? 'VALIDATION_ERROR' : 'CRASH',
      configId,
      sequenceId,
      buffer: reqBuffer,
    };
    try {
      assertWorkerResponse(response);
      postWorkerMessage(response, reqBuffer ? [reqBuffer] : undefined);
    } catch {
      postWorkerMessage({
        success: false,
        physicalReady: false,
        error: 'CRASH',
        configId,
        sequenceId,
      });
    }
  }
};
