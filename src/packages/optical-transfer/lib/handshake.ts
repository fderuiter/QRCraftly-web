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

import { QRConfig, QRStyle, SocialFormat, TemplateStyle } from '@/types';
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
  /** Relaxed decoding for automated browsers (`navigator.webdriver`). */
  isTest: boolean;
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
  checkOnMainThread: async ({ imageData, width, height, isTest, moduleCount }) =>
    performScannabilityCheck(await loadQrReader(), imageData, width, height, isTest, moduleCount).success,
  createCanvas: () => document.createElement('canvas'),
  watchdogMs: HANDSHAKE_WATCHDOG_MS,
};

/** Signature of the handshake gate, so hooks can take an injected verifier. */
export type HandshakeFrameVerifier = (
  frame: { size: number; data: Uint8Array },
  config: QRConfig,
  logoImg: HTMLImageElement | null,
  borderLogoImg: HTMLImageElement | null
) => Promise<boolean>;

/**
 * Sanitizes visual configuration for high-density animated stream chunk frames.
 * Automatically strips center logos, border overlays, templates, and complex module geometries.
 * @param config The input QR code configuration.
 * @returns Streamlined QR code configuration.
 */
export function sanitizeStreamConfig(config: QRConfig): QRConfig {
  return {
    ...config,
    style: QRStyle.STANDARD,
    logoUrl: null,
    logoSize: 0,
    isBorderEnabled: false,
    borderLogoUrl: null,
    borderText: '',
    socialFormat: SocialFormat.SQUARE_1_1,
    templateStyle: TemplateStyle.NONE,
    isMazeEnabled: false,
    isMazeBridgesEnabled: false,
  };
}

/**
 * Renders the frame and captures its pixels.
 * @returns The check request, or null when no 2D context is available.
 */
function renderHandshakeFrame(
  frame: { size: number; data: Uint8Array },
  config: QRConfig,
  logoImg: HTMLImageElement | null,
  borderLogoImg: HTMLImageElement | null,
  createCanvas: () => HTMLCanvasElement
): HandshakeCheckRequest | null {
  const canvas = createCanvas();
  canvas.width = DISPLAY_SIZE;
  canvas.height = DISPLAY_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const modules = {
    size: frame.size,
    get: (r: number, c: number) => !!frame.data[r * frame.size + c],
  };
  drawQRInternal(ctx, modules, config, logoImg, borderLogoImg, DISPLAY_SIZE, modules.size);

  return {
    imageData: ctx.getImageData(0, 0, DISPLAY_SIZE, DISPLAY_SIZE),
    width: DISPLAY_SIZE,
    height: DISPLAY_SIZE,
    moduleCount: modules.size,
    isTest: typeof navigator !== 'undefined' ? !!navigator.webdriver : true,
  };
}

/**
 * Runs a scannability check on the first frame before playback starts.
 * The Scannability Worker's answer is used whenever it arrives within the watchdog; the
 * main-thread check runs only if the worker is unavailable, errors, drops the request, or
 * misses the watchdog.
 * @param frame The raw module matrix data of the frame.
 * @param config The QR configuration used to render the frame.
 * @param logoImg Optional logo image element.
 * @param borderLogoImg Optional border logo image element.
 * @param deps Injected worker factory, checker and canvas factory.
 * @returns A promise resolving to true if the frame is scannable, false otherwise.
 */
export async function verifyHandshakeFrame(
  frame: { size: number; data: Uint8Array },
  config: QRConfig,
  logoImg: HTMLImageElement | null = null,
  borderLogoImg: HTMLImageElement | null = null,
  deps: HandshakeVerifierDeps = defaultHandshakeVerifierDeps
): Promise<boolean> {
  // Server-side rendering has no canvas; the browser re-runs the gate before playback.
  if (typeof document === 'undefined') return true;

  const request = renderHandshakeFrame(frame, config, logoImg, borderLogoImg, deps.createCanvas);
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
        isTest: request.isTest,
        moduleCount: request.moduleCount,
        configId: 'handshake-gate',
      });
    } catch {
      settle(fallback);
    }
  });
}
