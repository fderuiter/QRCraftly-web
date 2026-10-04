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
 * The Colour profile and its sender (#1147). Colour is the Fast profile with three Prism frames in
 * every tile, one per colour channel, and the same beacons as Fast: one black and white code that
 * carries the manifest, a few symbols and the calibration patch. It is off. Nothing in the app
 * imports it, no screen offers it, and {@link createColourSender} returns null unless a caller passes
 * `enabled: true`. Monochrome stays the default until a phone has shown that colour pays.
 *
 * Falling back is always possible because a beacon is an ordinary monochrome code: a receiver whose
 * colour reads fail still finishes from the beacons, and a sender that is told so (the back channel
 * of a later release) can drop to Fast.
 */
import type { PrismManifest } from '../prism/manifest';
import { MULTI_RATE_PROFILES, createMultiRateSender, type MultiRateProfile } from '../multicode/multirate';
import type { TileLayout } from '../multicode/layout';

/** Colour channels of a tile. */
export const COLOUR_CHANNELS = 3;

/** The Colour profile: Fast, with a code on each channel of every tile. */
export interface ColourProfile {
  name: 'colour';
  label: string;
  /** The monochrome profile it is built on, which supplies the layout, frame rate and beacons. */
  base: MultiRateProfile;
  channels: typeof COLOUR_CHANNELS;
  /** True only once the real-device numbers have shown colour at its tier. Not yet: see the device checklist. */
  offered: boolean;
  /** The tier the profile aims at, in KB/s. A target, not a measurement. */
  targetKBps: readonly [low: number, high: number];
}

export const COLOUR_PROFILE: ColourProfile = {
  name: 'colour',
  label: 'Colour',
  base: MULTI_RATE_PROFILES.fast,
  channels: COLOUR_CHANNELS,
  offered: false,
  targetKBps: [200, 500],
};

/** What a colour display frame shows. */
export type ColourFrame =
  | {
      kind: 'dense';
      /** One entry per tile; each holds the texts of its red, green and blue codes. */
      tiles: ReadonlyArray<readonly [string, string, string]>;
    }
  | { kind: 'beacon'; text: string };

export interface ColourSenderOptions {
  /** Off unless exactly `true`. */
  enabled?: boolean;
  /** The message the fountain code carries. */
  message: Uint8Array;
  /** The manifest; its symbol size is replaced by the layout's. */
  manifest: PrismManifest;
}

/** The sender's frame source for one Colour transfer. */
export interface ColourSender {
  readonly profile: ColourProfile;
  readonly layout: TileLayout;
  /** QR version of the beacon. */
  readonly beaconVersion: number;
  readonly fingerprint: string;
  readonly symbolSize: number;
  /** Symbols in each of a tile's three codes. */
  readonly denseSymbols: number;
  readonly beaconSymbols: number;
  frame(frameIndex: number): ColourFrame;
}

/**
 * Builds the sender of a Colour transfer.
 * @param options - The opt-in, message and manifest.
 * @returns The sender, or null when Colour is off (the caller keeps its monochrome stream).
 */
export function createColourSender(options: ColourSenderOptions): ColourSender | null {
  if (options.enabled !== true) return null;
  const base = createMultiRateSender({ message: options.message, manifest: options.manifest, profile: COLOUR_PROFILE.base, channels: COLOUR_CHANNELS });
  return {
    profile: COLOUR_PROFILE,
    layout: base.layout,
    beaconVersion: COLOUR_PROFILE.base.beaconVersion,
    fingerprint: base.fingerprint,
    symbolSize: base.symbolSize,
    denseSymbols: base.denseSymbols,
    beaconSymbols: base.beaconSymbols,
    frame(frameIndex) {
      const frame = base.frame(frameIndex);
      if (frame.kind === 'beacon') return { kind: 'beacon', text: frame.texts[0] };
      const tiles: Array<readonly [string, string, string]> = [];
      for (let tile = 0; tile < base.layout.tiles; tile++) {
        const at = tile * COLOUR_CHANNELS;
        tiles.push([frame.texts[at], frame.texts[at + 1], frame.texts[at + 2]]);
      }
      return { kind: 'dense', tiles };
    },
  };
}

/** What a receiver (or a back channel) reports about a Colour transfer so far. */
export interface ColourLinkReport {
  /** Beacons read. */
  beaconReads: number;
  /** Frames read from the colour channels of tiles. */
  colourReads: number;
}

/** Beacons a receiver waits through without one colour read before it gives colour up. */
export const COLOUR_FALLBACK_BEACONS = 3;

/** What the receiver tells the person when only the beacons read. */
export const COLOUR_FALLBACK_HINT = 'Colour is not reading on this camera. Only the black and white codes are getting through. Switch the sender to a monochrome speed for full speed.';

/**
 * Whether a sender told of the receiver's reads should drop to the monochrome Fast profile.
 * @param report - The reads so far.
 * @param beacons - Beacons that must have been read with no colour read (default {@link COLOUR_FALLBACK_BEACONS}).
 * @returns True when beacons read and colour never did.
 */
export function shouldFallBackToMono(report: ColourLinkReport, beacons = COLOUR_FALLBACK_BEACONS): boolean {
  return report.beaconReads >= beacons && report.colourReads === 0;
}
