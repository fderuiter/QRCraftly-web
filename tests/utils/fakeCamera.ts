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
 * Scripted fake camera for Playwright (#1103).
 *
 * An init script replaces `navigator.mediaDevices.getUserMedia` with the
 * `captureStream(30)` of a hidden canvas, and the test decides what that "camera"
 * sees through `window.__cam`:
 *
 * - `show(scene)` paints a QR matrix (built in Node with the `qrcode` package), an
 *   image (a data URL, for example a sender's transfer frame) or nothing at all,
 *   with optional degradations: `modulePx`, `noise`, `invert`, `rotate`, `blur`,
 *   `scale`, `brightness` and `contrast`. Noise is re-rolled on every frame, like a
 *   real sensor's.
 * - `liveTracks()` counts the camera tracks that are still running, so specs can
 *   check that the camera is released.
 * - `constraints()` returns what each `getUserMedia` call asked for.
 *
 * The real scanner (engine, worker, jsQR) reads these pixels exactly as it would read
 * a camera, headless, without `.y4m` files. Used by the scanner spec and, through
 * `e2e/utils/opticalLink.ts`, by the file-transfer receiver spec.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { qrEncoder as QRCode } from '../fixtures/qrEncoder';

/** What the fake camera shows. All fields are optional; an empty scene is a plain grey view. */
export interface FakeCameraScene {
  /** A QR matrix: `size` modules per side, `bits` row-major '1' (dark) / '0' (light). */
  matrix?: { size: number; bits: string } | null;
  /** An image to show instead of a matrix (data URL). */
  image?: string | null;
  /** Pixels per module for a matrix (default 6). */
  modulePx?: number;
  /** Fraction of the frame's short side an image fills (default 0.8). */
  scale?: number;
  /** Per-frame sensor noise amplitude in grey levels (+/- this value). */
  noise?: number;
  /** Light modules on dark. */
  invert?: boolean;
  /** Rotation in degrees. */
  rotate?: number;
  /** CSS blur radius in pixels. */
  blur?: number;
  /** CSS brightness multiplier (low light below 1). */
  brightness?: number;
  /** CSS contrast multiplier (glare / washed out below 1). */
  contrast?: number;
}

export interface FakeCameraOptions {
  /** Reject `getUserMedia` with `NotAllowedError`. */
  deny?: boolean;
  /** Camera frame size (default 1280x720). */
  width?: number;
  height?: number;
}

/** The page-side API the init script installs. */
export interface FakeCameraApi {
  show(scene: FakeCameraScene | null): Promise<void>;
  liveTracks(): number;
  requests(): number;
  /** The constraints of each `getUserMedia` call, oldest first. */
  constraints(): MediaStreamConstraints[];
}

declare global {
  interface Window {
    __cam?: FakeCameraApi;
  }
}

/**
 * Installs the fake camera on every page of the context. Call before navigating.
 * @param context The browser context.
 * @param options Denial and frame size.
 */
export async function installFakeCamera(context: BrowserContext, options: FakeCameraOptions = {}): Promise<void> {
  await context.addInitScript(
    ({ deny, width, height }) => {
      const BACKGROUND = '#6b7280';
      let canvas: HTMLCanvasElement | null = null;
      let scene: FakeCameraScene | null = null;
      let image: HTMLImageElement | null = null;
      let requests = 0;
      const requested: MediaStreamConstraints[] = [];
      const tracks: MediaStreamTrack[] = [];

      /** Pre-rendered frames for the current scene; noisy scenes cycle through several. */
      let frames: ImageData[] = [];
      let frameIndex = 0;

      const ensureCanvas = (): HTMLCanvasElement => {
        if (canvas) return canvas;
        canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        render();
        // Repaint continuously so the stream keeps delivering frames (and fresh noise). Frames are
        // pre-rendered, so a repaint is one putImageData even when the CPU is throttled.
        setInterval(() => {
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (!ctx || frames.length === 0) return;
          frameIndex = (frameIndex + 1) % frames.length;
          ctx.putImageData(frames[frameIndex], 0, 0);
        }, 40);
        return canvas;
      };

      function render(): void {
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        paint(ctx);
        const clean = ctx.getImageData(0, 0, width, height);
        const noise = scene?.noise ?? 0;
        if (noise <= 0) {
          frames = [clean];
        } else {
          frames = [];
          for (let k = 0; k < 4; k++) {
            const frame = new ImageData(new Uint8ClampedArray(clean.data), width, height);
            const px = frame.data;
            for (let i = 0; i < px.length; i += 4) {
              const n = (Math.random() * 2 - 1) * noise;
              px[i] += n;
              px[i + 1] += n;
              px[i + 2] += n;
            }
            frames.push(frame);
          }
        }
        frameIndex = 0;
        ctx.putImageData(frames[0], 0, 0);
      }

      function paint(ctx: CanvasRenderingContext2D): void {
        ctx.filter = 'none';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = BACKGROUND;
        ctx.fillRect(0, 0, width, height);
        const current = scene;
        if (!current) return;
        const filters: string[] = [];
        if (current.blur) filters.push(`blur(${current.blur}px)`);
        if (current.brightness !== undefined) filters.push(`brightness(${current.brightness})`);
        if (current.contrast !== undefined) filters.push(`contrast(${current.contrast})`);
        ctx.filter = filters.length ? filters.join(' ') : 'none';
        ctx.translate(width / 2, height / 2);
        if (current.rotate) ctx.rotate((current.rotate * Math.PI) / 180);

        if (current.matrix) {
          const { size, bits } = current.matrix;
          const modulePx = current.modulePx ?? 6;
          const quiet = 4;
          const side = (size + quiet * 2) * modulePx;
          const light = current.invert ? '#111111' : '#f5f5f5';
          const dark = current.invert ? '#f5f5f5' : '#111111';
          const origin = -Math.floor(side / 2);
          ctx.fillStyle = light;
          ctx.fillRect(origin, origin, side, side);
          ctx.fillStyle = dark;
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              if (bits.charCodeAt(y * size + x) === 49) {
                ctx.fillRect(origin + (x + quiet) * modulePx, origin + (y + quiet) * modulePx, modulePx, modulePx);
              }
            }
          }
        } else if (image) {
          const drawn = Math.min(width, height) * (current.scale ?? 0.8);
          ctx.drawImage(image, -drawn / 2, -drawn / 2, drawn, drawn);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = 'none';
      }

      const api: FakeCameraApi = {
        async show(next) {
          ensureCanvas();
          if (next?.image) {
            const img = new Image();
            img.src = next.image;
            await img.decode();
            image = img;
          } else {
            image = null;
          }
          scene = next;
          render();
        },
        liveTracks: () => tracks.filter((track) => track.readyState === 'live').length,
        requests: () => requests,
        constraints: () => requested,
      };
      Object.defineProperty(window, '__cam', { configurable: true, value: api });

      const mediaDevices = navigator.mediaDevices ?? ({} as MediaDevices);
      Object.defineProperty(mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints: MediaStreamConstraints = {}) => {
          requests += 1;
          requested.push(JSON.parse(JSON.stringify(constraints)));
          if (deny) {
            throw new DOMException('Permission denied', 'NotAllowedError');
          }
          const stream = ensureCanvas().captureStream(30);
          tracks.push(...stream.getTracks());
          return stream;
        },
      });
      if (!navigator.mediaDevices) {
        Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
      }
    },
    { deny: options.deny ?? false, width: options.width ?? 1280, height: options.height ?? 720 }
  );
}

/**
 * Builds the matrix scene for a QR code that encodes `text`.
 * @param text The payload.
 * @param scene Degradations to apply.
 */
export function codeScene(text: string, scene: Omit<FakeCameraScene, 'matrix' | 'image'> = {}): FakeCameraScene {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const { size } = qr.modules;
  let bits = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) bits += qr.modules.get(y, x) ? '1' : '0';
  }
  return { ...scene, matrix: { size, bits } };
}

/**
 * Changes what the fake camera shows.
 * @param page The page with the fake camera.
 * @param scene The scene, or null for a plain grey view with no code.
 */
export async function showOnCamera(page: Page, scene: FakeCameraScene | null): Promise<void> {
  await page.evaluate((next) => window.__cam?.show(next), scene);
}

/** Number of fake camera tracks that are still live (not stopped). */
export async function liveCameraTracks(page: Page): Promise<number> {
  return page.evaluate(() => window.__cam?.liveTracks() ?? 0);
}

/** The constraints of each `getUserMedia` call the page made, oldest first. */
export async function requestedCameraConstraints(page: Page): Promise<MediaStreamConstraints[]> {
  return page.evaluate(() => window.__cam?.constraints() ?? []);
}

/** Slows the page's CPU (Chromium only, through CDP), like a mid-range phone. Pass 1 to restore. */
export async function throttleCpu(page: Page, rate: number): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}
