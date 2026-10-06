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

import { QRConfig, QRErrorCorrectionLevel, QRStyle, QRType, SocialFormat, TemplateStyle } from '@/types';
import { drawQRInternal } from '@/packages/qr-matrix';
import { createScannabilityWorker, isWorkerResponse } from '@/packages/scannability';
import { performScannabilityCheck } from '@/packages/scannability/checker';
import { loadQrReader } from '@/packages/qr-decode';

/** Side length, in CSS pixels, of the canvas the handshake frame is rendered onto for checking. */
const DISPLAY_SIZE = 512;

/**
 * How long the Scannability Worker may take before the main-thread check runs instead.
 * Matches the 1500ms watchdog used by the other Scannability Worker clients.
 */
export const HANDSHAKE_WATCHDOG_MS = 1500;

/** Pixels of one rendered handshake frame, ready for a scannability check. */
export interface HandshakeCheckRequest {
  imageData: ImageData;
  width: number;
  height: number;
  moduleCount: number;
}

/** Capabilities the handshake gate runs on. Tests inject fakes; the app uses the defaults. */
export interface HandshakeVerifierDeps {
  /** Spawns a Scannability Worker, or returns null where workers are unavailable. */
  createWorker: () => Worker | null;
  /** Main-thread check used when the worker is unavailable, fails, or misses the watchdog. */
  checkOnMainThread: (request: HandshakeCheckRequest) => boolean | Promise<boolean>;
  /** Creates the canvas the frame is rendered onto. */
  createCanvas: () => HTMLCanvasElement;
  /** Watchdog in milliseconds before the main-thread check takes over. */
  watchdogMs: number;
}

/** Production capabilities: the real Scannability Worker and checker from `@/packages/scannability`. */
const defaultHandshakeVerifierDeps: HandshakeVerifierDeps = {
  createWorker: createScannabilityWorker,
  checkOnMainThread: async ({ imageData, width, height, moduleCount }) =>
    performScannabilityCheck(await loadQrReader(), imageData, width, height, moduleCount).success,
  createCanvas: () => document.createElement('canvas'),
  watchdogMs: HANDSHAKE_WATCHDOG_MS,
};

/** Signature of the handshake gate, so hooks can take an injected verifier. */
export type HandshakeFrameVerifier = (frame: { size: number; data: Uint8Array }) => Promise<boolean>;

/**
 * The one look of every transfer frame and key QR (#1307): square black modules on white with a
 * four-module quiet zone, the same as the multi-code tiles. The page's appearance settings never
 * reach a transfer frame, so no colour, logo, pattern or image can cost a read.
 */
const TRANSFER_FRAME_CONFIG: Readonly<QRConfig> = Object.freeze<QRConfig>({
  value: '',
  type: QRType.TEXT,
  fgColor: '#000000',
  bgColor: '#ffffff',
  style: QRStyle.STANDARD,
  logoUrl: null,
  logoSize: 0,
  logoPaddingStyle: 'none',
  logoPadding: 0,
  logoBackgroundColor: '#ffffff',
  eyeColor: '#000000',
  errorCorrectionLevel: QRErrorCorrectionLevel.M,
  isBorderEnabled: false,
  borderSize: 0,
  borderColor: '#000000',
  borderStyle: 'solid',
  borderText: '',
  borderTextPosition: 'bottom-center',
  borderTextColor: '#000000',
  borderLogoUrl: null,
  borderLogoPosition: 'bottom-center',
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
  isMazeEnabled: false,
  isMazeBridgesEnabled: false,
  backgroundImageUrl: null,
  isLuminanceMaskingEnabled: false,
  mosaicImageUrl: null,
});

/**
 * Draws a transfer frame or key QR in {@link TRANSFER_FRAME_CONFIG}, filling a square of `size`.
 * @param ctx - The canvas context.
 * @param frame - The module matrix, row by row, 1 for dark.
 * @param size - Side of the square, in the context's units.
 */
export function drawTransferFrame(ctx: CanvasRenderingContext2D, frame: { size: number; data: Uint8Array }, size: number): void {
  const modules = {
    size: frame.size,
    get: (r: number, c: number) => !!frame.data[r * frame.size + c],
  };
  drawQRInternal(ctx, modules, TRANSFER_FRAME_CONFIG, null, null, size, modules.size);
}

/**
 * Renders the frame and captures its pixels.
 * @returns The check request, or null when no 2D context is available.
 */
function renderHandshakeFrame(frame: { size: number; data: Uint8Array }, createCanvas: () => HTMLCanvasElement): HandshakeCheckRequest | null {
  const canvas = createCanvas();
  canvas.width = DISPLAY_SIZE;
  canvas.height = DISPLAY_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawTransferFrame(ctx, frame, DISPLAY_SIZE);

  return {
    imageData: ctx.getImageData(0, 0, DISPLAY_SIZE, DISPLAY_SIZE),
    width: DISPLAY_SIZE,
    height: DISPLAY_SIZE,
    moduleCount: frame.size,
  };
}

/**
 * Runs a scannability check on the first frame before playback starts.
 * The Scannability Worker's answer is used whenever it arrives within the watchdog; the
 * main-thread check runs only if the worker is unavailable, errors, drops the request, or
 * misses the watchdog.
 * @param frame The raw module matrix data of the frame, drawn as {@link drawTransferFrame} draws it.
 * @param deps Injected worker factory, checker and canvas factory.
 * @returns A promise resolving to true if the frame is scannable, false otherwise.
 */
export async function verifyHandshakeFrame(
  frame: { size: number; data: Uint8Array },
  deps: HandshakeVerifierDeps = defaultHandshakeVerifierDeps
): Promise<boolean> {
  // Server-side rendering has no canvas; the browser re-runs the gate before playback.
  if (typeof document === 'undefined') return true;

  const request = renderHandshakeFrame(frame, deps.createCanvas);
  if (!request) return true;

  const fallback = async (): Promise<boolean> => {
    try {
      return await deps.checkOnMainThread(request);
    } catch {
      return false;
    }
  };

  let worker: Worker | null;
  try {
    worker = deps.createWorker();
  } catch {
    worker = null;
  }
  if (!worker) return fallback();
  const activeWorker = worker;

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const settle = (decide: () => boolean | Promise<boolean>) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      activeWorker.onmessage = null;
      activeWorker.onerror = null;
      try {
        activeWorker.terminate();
      } catch {
        // Already gone.
      }
      resolve(decide());
    };

    const watchdog = setTimeout(() => settle(fallback), deps.watchdogMs);

    activeWorker.onmessage = (event: MessageEvent) => {
      const response: unknown = event.data;
      if (isWorkerResponse(response) && 'success' in response) {
        settle(() => response.success);
      } else {
        settle(fallback);
      }
    };
    activeWorker.onerror = () => settle(fallback);

    try {
      activeWorker.postMessage({
        imageData: request.imageData,
        width: request.width,
        height: request.height,
        moduleCount: request.moduleCount,
        configId: 'handshake-gate',
      });
    } catch {
      settle(fallback);
    }
  });
}
