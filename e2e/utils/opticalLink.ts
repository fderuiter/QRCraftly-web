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

import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, Page } from '@playwright/test';
import { installFakeCamera, showOnCamera } from '../../tests/utils/fakeCamera';

/**
 * Optical link test harness: stands in for "phone camera pointed at a screen".
 *
 * The receiver page gets a synthetic camera. `getUserMedia` returns the
 * `captureStream()` of a hidden canvas, and the test paints the sender's
 * transfer canvas onto it frame by frame. The receiver's real scanner (worker,
 * decoder, adaptive scheduler) reads those pixels exactly as it would read a
 * camera, so a passing transfer proves the whole screen-to-camera pipeline.
 */

/** How a relayed frame is degraded before the receiver's camera sees it. */
export interface CameraCondition {
  /** CSS blur radius in pixels (focus / motion blur). */
  blurPx?: number;
  /** CSS brightness multiplier (low light below 1). */
  brightness?: number;
  /** CSS contrast multiplier (glare / washed out below 1). */
  contrast?: number;
  /** Fraction of the camera frame the QR fills (default 0.8). */
  scale?: number;
}

/**
 * Installs the synthetic camera on every page of the context (run before navigation).
 * It is the shared fake camera from `tests/utils/fakeCamera.ts` with a square 720 px view.
 */
export async function installSyntheticCamera(context: BrowserContext, options: { deny?: boolean } = {}): Promise<void> {
  await installFakeCamera(context, { deny: options.deny, width: 720, height: 720 });
}

/** Reads the sender's current transfer frame as a PNG data URL, or null before the first frame. */
export async function grabSenderFrame(sender: Page): Promise<string | null> {
  return sender.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Transfer QR code"]');
    if (!canvas || canvas.width === 0) return null;
    return canvas.toDataURL('image/png');
  });
}

/** Paints one frame onto the receiver's synthetic camera. */
export async function paintCamera(receiver: Page, dataUrl: string, condition: CameraCondition = {}): Promise<void> {
  await showOnCamera(receiver, {
    image: dataUrl,
    scale: condition.scale,
    blur: condition.blurPx,
    brightness: condition.brightness,
    contrast: condition.contrast,
  });
}

export interface RelayOptions {
  /** Stop once this resolves true (checked after every relayed frame). */
  until: () => Promise<boolean>;
  /** Give up after this many milliseconds. */
  timeoutMs: number;
  /** Camera degradation applied to every frame. */
  condition?: CameraCondition;
  /** Drop a relayed frame when this returns true (simulates missed or occluded frames). */
  drop?: (frameNumber: number) => boolean;
}

/**
 * Relays sender frames into the receiver camera until `until()` is true.
 * Identical consecutive frames are skipped so each droplet is painted once.
 * @returns Number of distinct sender frames seen.
 */
export async function relayFrames(sender: Page, receiver: Page, options: RelayOptions): Promise<number> {
  const deadline = Date.now() + options.timeoutMs;
  let last: string | null = null;
  let seen = 0;
  while (Date.now() < deadline) {
    const frame = await grabSenderFrame(sender);
    if (frame && frame !== last) {
      last = frame;
      seen += 1;
      if (!options.drop?.(seen)) {
        await paintCamera(receiver, frame, options.condition);
      }
    }
    if (await options.until()) return seen;
    await delay(15);
  }
  throw new Error(`Optical relay timed out after ${options.timeoutMs} ms (${seen} sender frames seen)`);
}
