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
 * The multi-rate stream and its three speed profiles (#1143). A sender interleaves dense frames
 * (the tiles of a layout) with a **beacon**: one large code, shown at full size, that carries the
 * manifest and a few symbols. Both come from the same fountain code with the same symbol size and
 * session ID, so every frame feeds the same decoder: a strong camera reads everything, and a weak
 * or distant one still finishes from the beacons alone.
 *
 * Nothing outside this package calls it yet. The numbers in {@link MULTI_RATE_PROFILES} are
 * starting points taken from the simulator; a real-device run (docs/TRANSFER_DEVICE_CHECKLIST.md)
 * sets the final ones.
 */
import { FRAME_OVERHEAD } from '../prism/frame';
import type { PrismManifest } from '../prism/manifest';
import { PrismStream } from '../prism/session';
import { TILE_LAYOUTS, tileFrameCapacity, type TileLayout, type TileLayoutId } from './layout';

export type MultiRateProfileName = 'steady' | 'balanced' | 'fast';

/** One speed setting: what the dense layer is, how fast it runs and how often a beacon comes. */
export interface MultiRateProfile {
  name: MultiRateProfileName;
  label: string;
  /** Layout of the dense frames. */
  layoutId: TileLayoutId;
  /** Frames per second to aim for (a whole number of display refreshes each). */
  targetFps: number;
  /** Every Nth frame is a beacon. */
  beaconEvery: number;
  /**
   * Bytes per fountain symbol. Left out, the layout's own size applies. A single large code needs a
   * smaller one, so that a beacon (a larger code) can hold more symbols than a dense tile and the two
   * can be told apart by size.
   */
  symbolSize?: number;
  /** QR version of the beacon, always larger than the dense tiles so the two can be told apart. */
  beaconVersion: number;
  /** The throughput tier the profile aims at, in KB/s, for the sender's estimate. Not a measurement. */
  targetKBps: readonly [low: number, high: number];
}

/**
 * Steady, Balanced and Fast. The layouts are those of the layout table (ECC L throughout), so
 * Steady is one v30 code rather than the v25 M of the spec; a device run decides whether that
 * should change.
 */
export const MULTI_RATE_PROFILES: Readonly<Record<MultiRateProfileName, MultiRateProfile>> = {
  steady: { name: 'steady', label: 'Steady', layoutId: '1xv30', symbolSize: 350, targetFps: 15, beaconEvery: 4, beaconVersion: 40, targetKBps: [15, 30] },
  balanced: { name: 'balanced', label: 'Balanced', layoutId: '2x2-v20', targetFps: 30, beaconEvery: 8, beaconVersion: 30, targetKBps: [50, 150] },
  fast: { name: 'fast', label: 'Fast', layoutId: '2x2-v25', targetFps: 60, beaconEvery: 12, beaconVersion: 40, targetKBps: [150, 300] },
};

/** Beacons between manifests in the beacon stream. */
const BEACON_MANIFEST_INTERVAL = 4;

/** What one display frame shows. */
export type MultiRateFrame =
  | { kind: 'dense'; /** One text per tile and channel: tile 0's channels first. A single-channel stream has one per tile. */ texts: string[] }
  | { kind: 'beacon'; texts: [string] };

/**
 * Whether the frame at a position is a beacon.
 * @param frameIndex - Zero-based display frame.
 * @param beaconEvery - A beacon comes every this many frames.
 * @returns True for a beacon frame.
 */
export function isBeaconFrame(frameIndex: number, beaconEvery: number): boolean {
  return beaconEvery >= 2 && (frameIndex + 1) % beaconEvery === 0;
}

/**
 * Tells a beacon from a dense tile by its size: a beacon's text does not fit a dense tile.
 * @param text - The decoded frame text.
 * @param layout - The dense layout of the stream.
 * @param beaconVersion - The beacon's QR version.
 * @returns "beacon" or "dense".
 */
export function classifyFrameText(text: string, layout: TileLayout, beaconVersion: number): 'dense' | 'beacon' {
  return text.length > tileFrameCapacityChars(layout.version) && text.length <= tileFrameCapacityChars(beaconVersion) ? 'beacon' : 'dense';
}

/** Alphanumeric characters a frame of a QR version can hold, as used for the size test above. */
function tileFrameCapacityChars(version: number): number {
  // A Base45 text of `tileFrameCapacity` bytes is at most this many characters.
  return Math.ceil((tileFrameCapacity(version) * 3) / 2);
}

/** Inputs for {@link createMultiRateSender}. */
export interface MultiRateSenderOptions {
  /** The message the fountain code carries (the file, or a packed bundle). */
  message: Uint8Array;
  /** The manifest; its symbol size is replaced by the layout's so beacons and tiles agree. */
  manifest: PrismManifest;
  profile: MultiRateProfile;
  /** Independent Prism frames each tile carries (default 1; the Colour profile of #1147 uses 3, one per colour channel). Beacons stay single. */
  channels?: number;
}

/** The sender's frame source for one multi-rate transfer. */
export interface MultiRateSender {
  readonly layout: TileLayout;
  readonly profile: MultiRateProfile;
  /** Short form of the session, for the sender and receiver to compare. */
  readonly fingerprint: string;
  /** Symbols in one dense tile. */
  readonly denseSymbols: number;
  /** Symbols in one beacon. */
  readonly beaconSymbols: number;
  /** Bytes per symbol. */
  readonly symbolSize: number;
  /** The texts of a display frame: every tile for a dense frame, one code for a beacon. */
  frame(frameIndex: number): MultiRateFrame;
}

/**
 * Builds the dense and beacon streams of one transfer. They share the manifest and so the session
 * ID; the beacon starts further into the symbol sequence so its symbols are mostly new to a
 * receiver that already read the dense ones.
 * @param options - Message, manifest and profile.
 * @returns The sender.
 */
export function createMultiRateSender(options: MultiRateSenderOptions): MultiRateSender {
  const { profile } = options;
  const channels = Math.max(1, Math.floor(options.channels ?? 1));
  const layout = TILE_LAYOUTS[profile.layoutId];
  const symbolSize = profile.symbolSize ?? layout.symbolSize;
  const manifest: PrismManifest = { ...options.manifest, symbolSize };
  const denseSymbols = Math.max(1, Math.floor((tileFrameCapacity(layout.version) - FRAME_OVERHEAD) / symbolSize));
  const dense = new PrismStream(options.message, manifest, { symbolsPerFrame: denseSymbols });
  const beaconSymbols = Math.max(1, Math.floor((tileFrameCapacity(profile.beaconVersion) - FRAME_OVERHEAD) / symbolSize));
  // A receiver needs the manifest before it can use a symbol, so a beacon-only camera gets one every 4th beacon.
  const beacon = new PrismStream(options.message, manifest, { symbolsPerFrame: beaconSymbols, manifestInterval: BEACON_MANIFEST_INTERVAL });
  // Past the source symbols, so beacons carry repair symbols (the dense stream sends the source ones first).
  const beaconBase = Math.ceil((dense.k / beaconSymbols) * 1.1) + 2;

  return {
    layout,
    profile,
    fingerprint: dense.fingerprint,
    denseSymbols,
    beaconSymbols,
    symbolSize,
    frame(frameIndex) {
      const beaconsSoFar = Math.floor((frameIndex + 1) / profile.beaconEvery);
      if (isBeaconFrame(frameIndex, profile.beaconEvery)) {
        return { kind: 'beacon', texts: [beacon.frameText(beaconBase + beaconsSoFar - 1)] };
      }
      const denseIndex = frameIndex - beaconsSoFar;
      const perFrame = layout.tiles * channels;
      const texts = Array.from({ length: perFrame }, (_, slot) => dense.frameText(denseIndex * perFrame + slot));
      return { kind: 'dense', texts };
    },
  };
}
