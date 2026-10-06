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

import type { TransferCompression, TransferDensity } from './fountain/session';
import type { TileLayoutId } from './multicode/layout';
import type { OuterCode } from './prism/session';

/**
 * What a finished transfer announced about its file: name, size, type and SHA-256.
 */
export interface HandshakeInfo {
  fileName: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
}

/**
 * Sender telemetry shown while a transfer plays.
 */
export interface TransferStats {
  fileName: string;
  fileSize: number;
  startTime: number;
  /** Size of the preallocated frame pool buffer, formatted in megabytes. */
  frameBufferMemory: string;
}

/** START payload accepted by the slice worker. */
export interface SliceStartPayload {
  /** The file to send. */
  file?: Blob;
  /** Several files, or a folder (each File's `webkitRelativePath` is its path). Takes precedence over `file`. */
  files?: File[];
  /** Encrypt the transfer under a new key code the sender reads out. */
  private?: boolean;
  fps?: number;
  /** QR version ceiling and error correction of the frames. */
  density?: TransferDensity;
  /** Send with the outer code (ADR 0037) instead of the LT code; falls back to LT when it cannot. */
  outerCode?: OuterCode;
  /** Size the frames for this multi-code layout's tiles (#1142) instead of the density's QR version. */
  tiles?: TileLayoutId;
  /** With `tiles`: also make a beacon of this QR version for every `every`th display frame (#1143). */
  beacon?: BeaconPlan;
}

/** The beacons of a multi-rate stream (#1143, ADR 0031). */
export interface BeaconPlan {
  /** QR version of a beacon; larger than the tiles'. */
  version: number;
  /** Every this many display frames is a beacon, 2 or more. */
  every: number;
}

/** Messages the slice worker accepts. */
export type SliceWorkerIncomingMessage =
  | { type: 'START'; payload?: SliceStartPayload }
  | { type: 'ACK'; payload?: { index?: number } }
  | { type: 'HEAL'; payload?: { lastAckedIndex?: unknown } }
  /** Asks for the key QR of a private transfer; answered with KEY_FRAME. */
  | { type: 'KEY_QR' }
  | { type: 'STOP' };

/** Session details reported on INITIALIZED. */
export interface FountainInitInfo {
  k: number;
  /** Density the frames were sized for. */
  density: TransferDensity;
  symbolSize: number;
  compression: TransferCompression;
  messageLength: number;
  /** Four words from the session ID, e.g. `bafe lomu kiza tose`, for sender and receiver to compare. */
  fingerprint: string;
  /** Files in the transfer. */
  fileCount: number;
  /** The words of a private transfer's key code, to read out or type; absent for a plain transfer. */
  keyCode?: string;
  /** The code the stream is sent with. */
  outerCode: OuterCode;
  /** The multi-code layout the frames were sized for, or null for one code per frame. */
  tiles: TileLayoutId | null;
  /** The beacons sent between the tiles, or null for none. */
  beacon: BeaconPlan | null;
}

/** Messages the slice worker emits. */
export type SliceWorkerOutgoingMessage =
  | { type: 'FRAME'; index: number; total: number; size: number; data: Uint8Array }
  | { type: 'PROGRESS'; index: number; total: number; fileName?: string; fileSize?: number }
  | { type: 'INITIALIZED'; totalFrames: number; sha256: string; fountain: FountainInitInfo }
  | { type: 'KEY_FRAME'; size: number; data: Uint8Array }
  /** Beacon `index` of a multi-rate stream: it follows dense display frame `(index + 1) * (every - 1) - 1`. */
  | { type: 'BEACON'; index: number; size: number; data: Uint8Array }
  | { type: 'ERROR'; message: string };
