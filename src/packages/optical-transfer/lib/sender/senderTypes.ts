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

import type { HandshakeFrameVerifier } from '../handshake';
import type { BeaconPlan } from '../contracts';
import type { TransferCompression, TransferDensity } from '../fountain/session';
import type { TileLayoutId } from '../multicode/layout';
import type { OuterCode } from '../prism/session';

/** One QR module matrix produced by the slice worker. */
export interface TransferFrame {
  size: number;
  data: Uint8Array;
}

/**
 * Paints one frame onto the transfer canvas in the fixed transfer look (`TRANSFER_FRAME_CONFIG`):
 * a transfer frame carries no styling that could cost a read (#1307). Injected by the page so the
 * package does not depend on the app's canvas renderer.
 */
export type TransferFrameRenderer = (canvas: HTMLCanvasElement, frame: TransferFrame) => void;

export interface UseOpticalSenderOptions {
  /** Paints each frame onto `canvasRef`. */
  renderFrame: TransferFrameRenderer;
  /** Scannability gate run on the first frame before playback. Defaults to `verifyHandshakeFrame`. */
  verifyFrame?: HandshakeFrameVerifier;
  /**
   * Opens the sending device's webcam for the back channel (#1146). Called only after the person
   * turned on "Let the receiver steer" and started a transfer. Without it, steering is unavailable.
   */
  requestWebcam?: () => Promise<MediaStream>;
}

/** Session details reported by the slice worker. */
export interface SenderFountainInfo {
  /** Source block count K. */
  k: number;
  /** Effective bytes per symbol after the density's QR version clamp. */
  symbolSize: number;
  /** Density the frames were sized for. */
  density: TransferDensity;
  /** Whether the payload was deflate-raw compressed or sent verbatim. */
  compression: TransferCompression;
  /** Four words from the session ID, shown on both screens so the two can be compared. */
  fingerprint: string;
  /** Files in the transfer. */
  fileCount: number;
  /** The words of a private transfer's key code; absent when the transfer is not private. */
  keyCode?: string;
  /** The code the stream is sent with. */
  outerCode: OuterCode;
  /** The multi-code layout the stream is shown with, or null for one code per frame. */
  tiles: TileLayoutId | null;
  /** The beacons between the tiles, or null for none. */
  beacon: BeaconPlan | null;
  /** Whether the receiver can steer this transfer's speed (#1146). */
  steerable: boolean;
}

/** How a running multi-code stream is shown (#1142). */
export interface SenderTileInfo {
  layout: TileLayoutId;
  /** Display refreshes each frame is held for, once the refresh rate is measured. */
  hold: number | null;
  /** Measured display refresh rate, or null while measuring. */
  refreshHz: number | null;
}
