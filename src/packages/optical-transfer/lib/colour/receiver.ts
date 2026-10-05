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
 * The Colour receiver (#1147). It reads camera frames of a Colour stream:
 *
 * 1. A beacon (one black and white code) is found by the scanner. Its patch gives the cross-talk
 *    model and its position places every tile, so no tile search is needed.
 * 2. After that each frame is cut into the tracked tile crops. A crop is corrected with the model,
 *    split into its red, green and blue planes and each plane is decoded: three decodes per tile.
 * 3. The white of a tile's quiet zone is watched; when white balance moves, the model follows. The
 *    next beacon refits it from a fresh patch.
 * 4. When colour does not read, the beacons still do. After {@link COLOUR_FALLBACK_BEACONS} beacons
 *    without a colour read (or a patch that cannot be trusted) the receiver stops cutting tiles, keeps
 *    feeding the beacons to the same decoder, and says so ({@link COLOUR_FALLBACK_HINT}).
 *
 * The decoders are injected, so the package carries no QR reader: `decodeImage` finds one code in a
 * whole frame (the beacon), `decodePlane` reads one code from a single-channel crop.
 */
import { PrismReceiver } from '../prism/receiver';
import { looksLikePrismFrame } from '../prism/frame';
import { qrModuleCount, type TileLayout } from '../multicode/layout';
import { TileTracker, createSymbolDedup, type Rect, type TileCrop } from '../multicode/tracker';
import { ColourCalibrator, splitChannels, type GreyPlane, type RgbaImage } from './crosstalk';
import { COLOUR_FALLBACK_BEACONS, COLOUR_FALLBACK_HINT } from './profile';
import { meanColour, samplePatch, tileRectsFromBeacon } from './geometry';

/** A code a decoder found, with its box in the pixels of the picture it was given. */
export interface DecodedCode {
  text: string;
  rect: Rect;
  /** The code's QR version, when the decoder reports it. */
  version?: number;
}

export interface ColourReceiverOptions {
  /** The dense layout of the stream (the Fast layout). */
  layout: TileLayout;
  /** QR version of the stream's beacons. */
  beaconVersion: number;
  /** Reads the one code in a single-channel crop. */
  decodePlane(plane: GreyPlane): DecodedCode | null;
  /** Reads the one code in a whole camera frame; used for the beacon. */
  decodeImage(image: RgbaImage): DecodedCode | null;
  /** Beacons without a colour read after which colour is given up (default {@link COLOUR_FALLBACK_BEACONS}). */
  fallbackBeacons?: number;
}

/** "waiting" until the first good patch, "colour" while tiles are read, "mono" once colour is given up. */
export type ColourState = 'waiting' | 'colour' | 'mono';

export type ColourFallbackReason = 'calibration' | 'unreadable';

export interface ColourStats {
  frames: number;
  /** Plane decodes tried on tile crops: three per tile per frame. */
  colourDecodes: number;
  /** Plane decodes that returned a Prism frame. */
  colourReads: number;
  /** Beacons read. */
  beaconReads: number;
  /** Cross-talk fits from a patch. */
  fits: number;
  /** Patches that moved the white and so forced a refit. */
  driftRefits: number;
  /** Times a tile's quiet-zone white rescaled the model between patches. */
  rescales: number;
  /** Patches that could not be trusted. */
  rejectedPatches: number;
}

/** Patches rejected before any model exists that make the receiver give colour up. */
const MAX_REJECTED_FIRST_PATCHES = 2;
/** Quiet-zone rows sampled for white, in modules above a tile's code. */
const WHITE_STRIP_NEAR = 1;
const WHITE_STRIP_FAR = 3;

export class ColourReceiver {
  /** The decoder every frame, colour or beacon, feeds. Read its progress and `finalize()` it. */
  public readonly prism = new PrismReceiver();
  private readonly options: ColourReceiverOptions;
  private readonly tracker: TileTracker;
  private readonly calibrator = new ColourCalibrator();
  private readonly dedup = createSymbolDedup();
  private currentState: ColourState = 'waiting';
  private fallbackReason: ColourFallbackReason | null = null;
  private seeded = false;
  private readsSinceSeed = 0;
  private dryBeacons = 0;
  private badFirstPatches = 0;
  private counters = { frames: 0, colourDecodes: 0, colourReads: 0, beaconReads: 0 };

  constructor(options: ColourReceiverOptions) {
    this.options = options;
    this.tracker = new TileTracker({ layout: options.layout });
  }

  public get state(): ColourState {
    return this.currentState;
  }

  /** Why colour was given up, or null while it has not been. */
  public get reason(): ColourFallbackReason | null {
    return this.fallbackReason;
  }

  /** What to tell the person: set once only the beacons are reading. */
  public get hint(): string | null {
    return this.currentState === 'mono' ? COLOUR_FALLBACK_HINT : null;
  }

  public get isComplete(): boolean {
    return this.prism.isComplete;
  }

  public get stats(): ColourStats {
    return {
      ...this.counters,
      fits: this.calibrator.fits,
      driftRefits: this.calibrator.driftRefits,
      rescales: this.calibrator.rescales,
      rejectedPatches: this.calibrator.rejects,
    };
  }

  /**
   * Reads one camera frame.
   * @param image - The frame, RGBA.
   */
  public processFrame(image: RgbaImage): void {
    this.counters.frames += 1;
    if (this.currentState === 'colour') {
      const plan = this.tracker.plan(image);
      if (plan.kind === 'crops' && this.readTiles(image, plan.crops)) return;
    }
    this.readBeacon(image);
  }

  private readTiles(image: RgbaImage, crops: readonly TileCrop[]): boolean {
    const results = crops.map((crop) => {
      let found: Rect | undefined;
      for (const plane of splitChannels(image, crop.rect, this.calibrator.model)) {
        this.counters.colourDecodes += 1;
        const hit = this.options.decodePlane(plane);
        if (!hit || !looksLikePrismFrame(hit.text)) continue;
        this.counters.colourReads += 1;
        this.readsSinceSeed += 1;
        this.take(hit.text);
        found ??= { x: hit.rect.x + crop.rect.x, y: hit.rect.y + crop.rect.y, width: hit.rect.width, height: hit.rect.height };
      }
      // Only a crop that decoded was a tile: on a beacon frame the same box holds part of the beacon.
      if (found) this.followWhite(image, crop.tile);
      return { tile: crop.tile, ok: found !== undefined, rect: found };
    });
    this.tracker.reportCrops(results);
    return results.some((result) => result.ok);
  }

  /** Lets the white of a tile's quiet zone move the model, between patches. */
  private followWhite(image: RgbaImage, tile: number): void {
    const code = this.tracker.positions.get(tile);
    if (!code) return;
    const module = code.width / this.options.layout.modules;
    const strip: Rect = { x: code.x, y: code.y - WHITE_STRIP_FAR * module, width: code.width, height: (WHITE_STRIP_FAR - WHITE_STRIP_NEAR) * module };
    const white = meanColour(image, strip);
    if (white) this.calibrator.observeWhite(white);
  }

  private readBeacon(image: RgbaImage): void {
    const hit = this.options.decodeImage(image);
    if (!hit || !looksLikePrismFrame(hit.text)) return;
    const { layout, beaconVersion } = this.options;
    // A decoder can read one channel of a colour tile in grey (#1178): its frame counts, but it is no beacon.
    // Only the version tells them apart, not the text: a beacon that carries the manifest is short.
    if (hit.version !== undefined && hit.version !== beaconVersion) {
      this.take(hit.text);
      return;
    }
    this.counters.beaconReads += 1;
    this.take(hit.text);
    if (this.currentState === 'mono') return;
    const patch = samplePatch(image, hit.rect, qrModuleCount(beaconVersion));
    if (!patch || this.calibrator.update(patch) === 'rejected') {
      if (!this.calibrator.model) {
        this.badFirstPatches += 1;
        if (this.badFirstPatches >= MAX_REJECTED_FIRST_PATCHES) this.giveUp('calibration');
      }
      return;
    }
    this.currentState = 'colour';
    // Each beacon starts a stretch of colour reads. Three stretches with none and colour is given up.
    this.dryBeacons = this.seeded && this.readsSinceSeed === 0 ? this.dryBeacons + 1 : 0;
    if (this.dryBeacons >= (this.options.fallbackBeacons ?? COLOUR_FALLBACK_BEACONS)) {
      this.giveUp('unreadable');
      return;
    }
    this.seeded = true;
    this.readsSinceSeed = 0;
    this.tracker.reportSearch(tileRectsFromBeacon(hit.rect, beaconVersion, layout));
  }

  private giveUp(reason: ColourFallbackReason): void {
    this.currentState = 'mono';
    this.fallbackReason = reason;
    this.tracker.lose();
  }

  private take(text: string): void {
    if (this.dedup.accept(text)) this.prism.ingest(text);
  }
}
