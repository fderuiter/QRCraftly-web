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
 * Colour layer benchmark (#1147): the Colour profile and the monochrome Fast profile it is built on,
 * sent through the same simulated screen and camera, one frame of the sender per camera frame (a 60 Hz
 * display held for two refreshes, 30 fps).
 *
 * What is real: the Prism frames, the fountain code, QR encoding, every pixel, the decodes (our reader,
 * #1178) of every tile and beacon, the cross-talk fit and correction, the tile tracker, the dedup and the
 * receiver. What is simulated: the screen and the camera. The camera mixes the emitted channels
 * through a 3x3 matrix, scales them with a white balance that can shift mid-transfer, subsamples
 * colour over 2x2 pixels, and adds per-pixel and per-8x8-block noise as a JPEG-like stand-in (it is not
 * a JPEG codec). It is sharp, level and in sync with the display. Decode times are this machine's, one
 * thread; goodput is on the simulated camera clock and so assumes the decoder keeps up with the camera.
 */
import { qrReader } from '../fixtures/qrReader';
import { qrEncoder as QRCode } from '../fixtures/qrEncoder';
import {
  COLOUR_PROFILE,
  ColourReceiver,
  MULTI_RATE_PROFILES,
  PrismReceiver,
  TILE_QUIET_MODULES,
  TileTracker,
  composeBeacon,
  composeColourTile,
  createColourSender,
  createMultiRateSender,
  createPrismSession,
  createSymbolDedup,
  qrModuleCount,
  type ColourFallbackReason,
  type ColourState,
  type DecodedCode,
  type GreyPlane,
  type Matrix3,
  type Rect,
  type Rgb,
  type RgbaImage,
  type TileLayout,
} from '../../src/packages/optical-transfer/index';
import { createRandom } from './scannerCorpus';
import { boundingBox } from './tileBench';

const BACKGROUND = 128;

/** How the simulated camera distorts colour. */
export interface CameraChannel {
  /** Row i is what camera channel i sees of emitted R, G and B, per unit of the emitted level. */
  matrix: Matrix3;
  /** Levels the camera adds to every channel (black level). */
  blackLevel: number;
  /** White balance gains before the shift and after it. */
  gainsBefore: Rgb;
  gainsAfter: Rgb;
  /** Camera frame at which the shift starts, and how many frames it takes. */
  shiftAt: number;
  shiftOver: number;
  /** Standard deviation, in levels, of the noise on every pixel and every channel. */
  pixelNoise: number;
  /** Standard deviation, in levels, of the offset every 8x8 block and channel gets (JPEG block error). */
  blockNoise: number;
  /** Average the colour (not the brightness) over 2x2 pixels, as 4:2:0 JPEG does. */
  chromaSubsampling: boolean;
}

/** No distortion at all. */
export const CLEAN_CHANNEL: CameraChannel = {
  matrix: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  blackLevel: 0,
  gainsBefore: [1, 1, 1],
  gainsAfter: [1, 1, 1],
  shiftAt: 0,
  shiftOver: 1,
  pixelNoise: 0,
  blockNoise: 0,
  chromaSubsampling: false,
};

/**
 * A mild phone: each channel sees 12 to 22% of the others. Such a channel reads with no
 * correction at all (see the benchmark report), so this is where colour needs the fit least.
 */
export const MILD_CHANNEL: CameraChannel = {
  matrix: [
    [0.8, 0.14, 0.06],
    [0.12, 0.76, 0.12],
    [0.06, 0.16, 0.78],
  ],
  blackLevel: 6,
  gainsBefore: [1, 1, 1],
  gainsAfter: [1.12, 1, 0.86],
  shiftAt: 24,
  shiftOver: 10,
  pixelNoise: 4,
  blockNoise: 3,
  chromaSubsampling: true,
};

/**
 * The reference camera: strong cross-talk (a channel sees 45% of the others and 55% of its own, where
 * the raw channels stop decoding), white balance that moves warm (red up 12%, blue down 14%) over ten
 * frames from frame 24, and JPEG-like noise. Chosen as a harsh phone, not measured from one.
 */
export const REFERENCE_CHANNEL: CameraChannel = {
  ...MILD_CHANNEL,
  matrix: [
    [0.55, 0.25, 0.2],
    [0.22, 0.55, 0.23],
    [0.18, 0.27, 0.55],
  ],
};

/** A camera whose three channels are the same mixture: colour cannot be told apart, brightness can. */
export const COLOUR_BLIND_CHANNEL: CameraChannel = {
  ...REFERENCE_CHANNEL,
  matrix: [
    [0.34, 0.33, 0.33],
    [0.33, 0.34, 0.33],
    [0.33, 0.33, 0.34],
  ],
};

const gainsAt = (channel: CameraChannel, frame: number): Rgb => {
  const t = Math.min(1, Math.max(0, (frame - channel.shiftAt) / Math.max(1, channel.shiftOver)));
  const mix = (i: number): number => channel.gainsBefore[i] + (channel.gainsAfter[i] - channel.gainsBefore[i]) * t;
  return [mix(0), mix(1), mix(2)];
};

/**
 * Puts a picture through the simulated camera.
 * @param image - What the screen shows.
 * @param channel - How the camera distorts it.
 * @param frame - Camera frame number, for the white balance shift.
 * @param random - Seeded random source.
 * @returns What the camera captured.
 */
export function capture(image: RgbaImage, channel: CameraChannel, frame: number, random: () => number): RgbaImage {
  const { width, height } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  const gains = gainsAt(channel, frame);
  const m = channel.matrix;
  const blocksX = Math.ceil(width / 8);
  const blockOffsets = new Float64Array(blocksX * Math.ceil(height / 8) * 3);
  for (let i = 0; i < blockOffsets.length; i++) blockOffsets[i] = (random() + random() - 1) * channel.blockNoise * 1.7;
  const mixed = new Float64Array(12);
  const noise = channel.pixelNoise * 1.7;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      // The 2x2 cell: mix the four pixels, then optionally share their colour.
      let meanR = 0;
      let meanG = 0;
      let meanB = 0;
      for (let k = 0; k < 4; k++) {
        const px = Math.min(width - 1, x + (k & 1));
        const py = Math.min(height - 1, y + (k >> 1));
        const at = (py * width + px) * 4;
        const r = image.data[at];
        const g = image.data[at + 1];
        const b = image.data[at + 2];
        const o0 = (m[0][0] * r + m[0][1] * g + m[0][2] * b) * gains[0] + channel.blackLevel;
        const o1 = (m[1][0] * r + m[1][1] * g + m[1][2] * b) * gains[1] + channel.blackLevel;
        const o2 = (m[2][0] * r + m[2][1] * g + m[2][2] * b) * gains[2] + channel.blackLevel;
        mixed[k * 3] = o0;
        mixed[k * 3 + 1] = o1;
        mixed[k * 3 + 2] = o2;
        meanR += (o0 - (o0 + o1 + o2) / 3) / 4;
        meanG += (o1 - (o0 + o1 + o2) / 3) / 4;
        meanB += (o2 - (o0 + o1 + o2) / 3) / 4;
      }
      for (let k = 0; k < 4; k++) {
        const px = x + (k & 1);
        const py = y + (k >> 1);
        if (px >= width || py >= height) continue;
        const o0 = mixed[k * 3];
        const o1 = mixed[k * 3 + 1];
        const o2 = mixed[k * 3 + 2];
        const brightness = (o0 + o1 + o2) / 3;
        const block = ((py >> 3) * blocksX + (px >> 3)) * 3;
        const at = (py * width + px) * 4;
        const c0 = channel.chromaSubsampling ? brightness + meanR : o0;
        const c1 = channel.chromaSubsampling ? brightness + meanG : o1;
        const c2 = channel.chromaSubsampling ? brightness + meanB : o2;
        out[at] = c0 + blockOffsets[block] + (random() + random() - 1) * noise;
        out[at + 1] = c1 + blockOffsets[block + 1] + (random() + random() - 1) * noise;
        out[at + 2] = c2 + blockOffsets[block + 2] + (random() + random() - 1) * noise;
        out[at + 3] = 255;
      }
    }
  }
  return { data: out, width, height };
}

export interface SimScreen {
  width: number;
  height: number;
  modulePx: number;
}

const grid = (text: string, version: number) => QRCode.create(text, { errorCorrectionLevel: 'L', version }).modules;

function blit(target: RgbaImage, source: RgbaImage, left: number, top: number): void {
  for (let row = 0; row < source.height; row++) {
    const from = row * source.width * 4;
    target.data.set(source.data.subarray(from, from + source.width * 4), ((top + row) * target.width + left) * 4);
  }
}

/** One display frame, with each tile as the texts of its channels (a monochrome tile repeats one text). */
export type ScreenFrame = { kind: 'dense'; tiles: ReadonlyArray<readonly [string, string, string]> } | { kind: 'beacon'; text: string };

/** Where a layout's tile codes sit on the screen, row by row (the quiet zone excluded). */
export function tileCodeRects(layout: TileLayout, screen: SimScreen): Rect[] {
  const pitch = (layout.modules + 2 * TILE_QUIET_MODULES) * screen.modulePx;
  const originX = Math.floor((screen.width - layout.columns * pitch) / 2);
  const originY = Math.floor((screen.height - layout.rows * pitch) / 2);
  const side = layout.modules * screen.modulePx;
  return Array.from({ length: layout.tiles }, (_, tile) => ({
    x: originX + (tile % layout.columns) * pitch + TILE_QUIET_MODULES * screen.modulePx,
    y: originY + Math.floor(tile / layout.columns) * pitch + TILE_QUIET_MODULES * screen.modulePx,
    width: side,
    height: side,
  }));
}

/**
 * Paints a display frame on the screen.
 * @param frame - What the sender shows.
 * @param layout - The dense layout.
 * @param beaconVersion - The beacon's QR version.
 * @param screen - Size and module size.
 * @returns The screen as RGBA.
 */
export function renderScreen(frame: ScreenFrame, layout: TileLayout, beaconVersion: number, screen: SimScreen): RgbaImage {
  const image: RgbaImage = { data: new Uint8ClampedArray(screen.width * screen.height * 4).fill(BACKGROUND), width: screen.width, height: screen.height };
  if (frame.kind === 'beacon') {
    const bitmap = composeBeacon(grid(frame.text, beaconVersion), { modulePx: screen.modulePx });
    const quiet = TILE_QUIET_MODULES * screen.modulePx;
    const side = qrModuleCount(beaconVersion) * screen.modulePx;
    // The beacon code and the tile grid share a centre.
    blit(image, bitmap, Math.floor((screen.width - side) / 2) - quiet, Math.floor((screen.height - side) / 2) - quiet);
    return image;
  }
  const rects = tileCodeRects(layout, screen);
  frame.tiles.forEach((texts, tile) => {
    const bitmap = composeColourTile([grid(texts[0], layout.version), grid(texts[1], layout.version), grid(texts[2], layout.version)], { modulePx: screen.modulePx });
    const quiet = TILE_QUIET_MODULES * screen.modulePx;
    blit(image, bitmap, rects[tile].x - quiet, rects[tile].y - quiet);
  });
  return image;
}

/** Our reader on grey or RGBA pixels, as a decoded code. */
function readCode(pixels: Uint8ClampedArray, width: number, height: number): DecodedCode | null {
  const [result] = qrReader.read(pixels, width, height);
  return result ? { text: result.text, rect: boundingBox(result.corners, 0, 0), version: result.version } : null;
}

/** The decoders the Colour receiver is given: our reader on a channel plane, and on a whole frame. */
export const qrDecoders = {
  decodePlane: (plane: GreyPlane): DecodedCode | null => readCode(plane.data, plane.width, plane.height),
  decodeImage: (image: RgbaImage): DecodedCode | null => readCode(image.data, image.width, image.height),
};

/** The monochrome Fast receiver the Colour profile is measured against: tracked crops, then the beacon. */
class MonoReceiver {
  public readonly prism = new PrismReceiver();
  public decodes = 0;
  private readonly tracker: TileTracker;
  private readonly dedup = createSymbolDedup();

  constructor(
    private readonly layout: TileLayout,
    private readonly screen: SimScreen
  ) {
    this.tracker = new TileTracker({ layout });
  }

  public processFrame(image: RgbaImage): void {
    const plan = this.tracker.plan(image);
    if (plan.kind === 'search') {
      // The mono receiver is told where the tiles are, so it pays no search: a favourable baseline.
      this.tracker.reportSearch(tileCodeRects(this.layout, this.screen));
      return;
    }
    let any = false;
    const results = plan.crops.map((crop) => {
      const { x, y, width, height } = crop.rect;
      const data = new Uint8ClampedArray(width * height * 4);
      for (let row = 0; row < height; row++) data.set(image.data.subarray(((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4), row * width * 4);
      this.decodes += 1;
      const hit = readCode(data, width, height);
      if (hit) {
        any = true;
        this.take(hit.text);
      }
      return { tile: crop.tile, ok: hit !== null, rect: hit ? { x: hit.rect.x + x, y: hit.rect.y + y, width: hit.rect.width, height: hit.rect.height } : undefined };
    });
    this.tracker.reportCrops(results);
    if (any) return;
    const beacon = readCode(image.data, image.width, image.height);
    if (beacon) this.take(beacon.text);
  }

  private take(text: string): void {
    if (this.dedup.accept(text)) this.prism.ingest(text);
  }
}

export type ColourRunMode = 'colour' | 'mono';

export interface ColourRunOptions {
  mode: ColourRunMode;
  /** File size in bytes. */
  bytes: number;
  channel: CameraChannel;
  screen?: SimScreen;
  /** Camera frames per second (default 30). */
  fps?: number;
  seed?: number;
  /** Give up after this many camera frames. */
  maxFrames?: number;
  /** Replaces the Colour receiver's plane decoder, to simulate a device that cannot read colour. */
  decodePlane?: (plane: GreyPlane) => DecodedCode | null;
  /** Beacons without a colour read after which the Colour receiver gives colour up. */
  fallbackBeacons?: number;
}

export interface ColourRunResult {
  complete: boolean;
  /** The received file equals the sent one. */
  verified: boolean;
  cameraFrames: number;
  seconds: number;
  /** File bytes over simulated seconds, in KB/s (1 KB = 1000 bytes), start-up included. */
  goodputKBps: number;
  /** Camera frames before the first tile was read (Colour waits for a beacon; mono does not). */
  startFrames: number;
  state: ColourState | 'mono-profile';
  /** Why the Colour receiver gave colour up, and what it told the person. */
  reason: ColourFallbackReason | null;
  hint: string | null;
  /** Plane decodes tried on tile crops (three per tile read), or crop decodes for mono. */
  tileDecodes: number;
  /** Individual code decodes tried on tiles and beacons. */
  decodes: number;
  /** Real decode and correction time per simulated camera frame, in milliseconds, on this machine. */
  decodeMsPerFrame: number;
  /** Decodes per second the receiver needs to keep up with the camera at its frame rate. */
  decodesPerSecond: number;
  fits: number;
  driftRefits: number;
  rescales: number;
  beaconReads: number;
  colourReads: number;
}

/**
 * Sends a seeded random file through the simulated screen and camera.
 * @param options - Profile, file, camera and screen.
 * @returns What the transfer took.
 */
export async function runColourTransfer(options: ColourRunOptions): Promise<ColourRunResult> {
  const random = createRandom(options.seed ?? 11);
  const file = new Uint8Array(options.bytes);
  for (let i = 0; i < file.length; i++) file[i] = Math.floor(random() * 256);
  // A precompressed type keeps the message equal to the file, so the manifest's length and CRC hold.
  const session = await createPrismSession(file, { fileName: 'colour.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 20 });
  const fps = options.fps ?? 30;
  const screen = options.screen ?? { width: 1920, height: 1080, modulePx: 4 };
  const limit = options.maxFrames ?? 600;
  const noise = createRandom((options.seed ?? 11) + 1);

  const colourSender = options.mode === 'colour' ? createColourSender({ enabled: true, message: file, manifest: session.manifest }) : null;
  const monoSender = options.mode === 'mono' ? createMultiRateSender({ message: file, manifest: session.manifest, profile: MULTI_RATE_PROFILES.fast }) : null;
  const layout = (colourSender ?? monoSender)?.layout;
  if (!layout) throw new Error('No sender.');
  const beaconVersion = COLOUR_PROFILE.base.beaconVersion;
  const colour = colourSender
    ? new ColourReceiver({ layout, beaconVersion, decodeImage: qrDecoders.decodeImage, decodePlane: options.decodePlane ?? qrDecoders.decodePlane, fallbackBeacons: options.fallbackBeacons })
    : null;
  const mono = monoSender ? new MonoReceiver(layout, screen) : null;
  const receiver = colour ?? mono;
  if (!receiver) throw new Error('No receiver.');

  let decodeMs = 0;
  let frames = 0;
  let startFrames = 0;
  let started = false;
  while (!receiver.prism.isComplete && frames < limit) {
    const shown: ScreenFrame = colourSender
      ? colourSender.frame(frames)
      : (() => {
          const frame = monoSender?.frame(frames);
          if (!frame) throw new Error('No frame.');
          return frame.kind === 'beacon' ? { kind: 'beacon' as const, text: frame.texts[0] } : { kind: 'dense' as const, tiles: frame.texts.map((text) => [text, text, text] as const) };
        })();
    const seen = capture(renderScreen(shown, layout, beaconVersion, screen), options.channel, frames, noise);
    const began = performance.now();
    receiver.processFrame(seen);
    decodeMs += performance.now() - began;
    frames += 1;
    if (!started && (receiver.prism.snapshot()?.dropletsReceived ?? 0) > 0) {
      started = true;
      startFrames = frames;
    }
  }

  let verified = false;
  if (receiver.prism.isComplete) {
    const { files } = await receiver.prism.finalize();
    verified = files.length === 1 && files[0].data.length === file.length && files[0].data.every((byte, i) => byte === file[i]);
  }
  const stats = colour?.stats;
  const planeDecodes = stats?.colourDecodes ?? mono?.decodes ?? 0;
  const decodes = planeDecodes + (stats?.beaconReads ?? 0);
  const seconds = frames / fps;
  return {
    complete: receiver.prism.isComplete,
    verified,
    cameraFrames: frames,
    seconds,
    goodputKBps: verified ? Number((options.bytes / 1000 / seconds).toFixed(1)) : 0,
    startFrames,
    state: colour ? colour.state : 'mono-profile',
    reason: colour?.reason ?? null,
    hint: colour?.hint ?? null,
    tileDecodes: planeDecodes,
    decodes,
    decodeMsPerFrame: Number((decodeMs / Math.max(1, frames)).toFixed(1)),
    decodesPerSecond: Math.round((planeDecodes / Math.max(1, frames)) * fps),
    fits: stats?.fits ?? 0,
    driftRefits: stats?.driftRefits ?? 0,
    rescales: stats?.rescales ?? 0,
    beaconReads: stats?.beaconReads ?? 0,
    colourReads: stats?.colourReads ?? 0,
  };
}
