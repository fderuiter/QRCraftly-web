import jsQR from 'jsqr';
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { describe, it, expect } from 'vitest';
import {
  CALIBRATION_SWATCHES,
  COLOUR_FALLBACK_BEACONS,
  COLOUR_PROFILE,
  ColourCalibrator,
  EMIT_DARK,
  EMIT_LIGHT,
  MULTI_RATE_PROFILES,
  TILE_LAYOUTS,
  beaconPatchRects,
  composeBeacon,
  composeColourTile,
  createColourSender,
  createPrismSession,
  createPrng,
  decodeFrame,
  fitCrossTalk,
  isBeaconFrame,
  meanColour,
  qrModuleCount,
  samplePatch,
  shouldFallBackToMono,
  splitChannels,
  tileRectsFromBeacon,
  type Matrix3,
  type Rgb,
  type RgbaImage,
} from '../index';

const MATRIX: Matrix3 = [
  [0.8, 0.14, 0.06],
  [0.12, 0.76, 0.12],
  [0.06, 0.16, 0.78],
];

/** What a camera with this response reports for an emitted colour, in whole levels. */
function observe(emitted: Rgb, matrix: Matrix3 = MATRIX, gains: Rgb = [1, 1, 1], black = 6): Rgb {
  const channel = (i: number): number => Math.round((matrix[i][0] * emitted[0] + matrix[i][1] * emitted[1] + matrix[i][2] * emitted[2]) * gains[i] + black);
  return [channel(0), channel(1), channel(2)];
}

/** The eight swatches as a camera sees them: the screen emits EMIT_DARK or EMIT_LIGHT per channel. */
function patch(matrix: Matrix3 = MATRIX, gains: Rgb = [1, 1, 1]): Rgb[] {
  return CALIBRATION_SWATCHES.map((swatch) => observe([swatch[0] ? EMIT_LIGHT : EMIT_DARK, swatch[1] ? EMIT_LIGHT : EMIT_DARK, swatch[2] ? EMIT_LIGHT : EMIT_DARK], matrix, gains));
}

/** Pushes every pixel of an image through the response. */
function throughCamera(image: RgbaImage, matrix: Matrix3 = MATRIX, gains: Rgb = [1, 1, 1]): RgbaImage {
  const data = new Uint8ClampedArray(image.data.length);
  for (let at = 0; at < data.length; at += 4) {
    const seen = observe([image.data[at], image.data[at + 1], image.data[at + 2]], matrix, gains);
    data[at] = seen[0];
    data[at + 1] = seen[1];
    data[at + 2] = seen[2];
    data[at + 3] = 255;
  }
  return { data, width: image.width, height: image.height };
}

const grid = (text: string, version: number) => QRCode.create(text, { errorCorrectionLevel: 'L', version }).modules;

describe('cross-talk fit (#1147)', () => {
  it('recovers the matrix and the black level from the eight swatches', () => {
    const fit = fitCrossTalk(patch());
    expect(fit).not.toBeNull();
    const swing = EMIT_LIGHT - EMIT_DARK;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(fit!.matrix[i][j]).toBeCloseTo(MATRIX[i][j] * swing, 0);
    expect(fit!.residual).toBeLessThanOrEqual(1);
  });

  it('is exact on integers: the same swatches always give the same bits', () => {
    // Observations that are exactly linear in whole levels, so every sum in the fit is an integer.
    const exact: Matrix3 = [
      [200, 20, 8],
      [16, 180, 24],
      [8, 28, 190],
    ];
    const black: Rgb = [10, 12, 9];
    const row = (i: number, s: Rgb): number => exact[i][0] * s[0] + exact[i][1] * s[1] + exact[i][2] * s[2] + black[i];
    const swatches: Rgb[] = CALIBRATION_SWATCHES.map((s) => [row(0, s), row(1, s), row(2, s)]);
    const fit = fitCrossTalk(swatches);
    expect(fit?.matrix).toEqual(exact);
    expect(fit?.offset).toEqual([10, 12, 9]);
    expect(fit?.residual).toBe(0);
    expect(fitCrossTalk(swatches)).toEqual(fit);
  });

  it('refuses a patch it cannot trust', () => {
    expect(fitCrossTalk(patch().slice(0, 7))).toBeNull();
    // A channel with almost no swing.
    expect(fitCrossTalk(patch([[0.1, 0.0, 0.0], MATRIX[1], MATRIX[2]]))).toBeNull();
    // Three channels that all see the same mixture cannot be separated.
    expect(
      fitCrossTalk(
        patch([
          [0.34, 0.33, 0.33],
          [0.33, 0.34, 0.33],
          [0.33, 0.33, 0.34],
        ])
      )
    ).toBeNull();
    // A channel that follows another more than its own.
    expect(fitCrossTalk(patch([[0.3, 0.7, 0], MATRIX[1], MATRIX[2]]))).toBeNull();
    // A swatch the linear model cannot explain (a glare spot on the patch).
    const glare = patch();
    glare[1] = [250, 250, 250];
    expect(fitCrossTalk(glare)).toBeNull();
  });

  it('undoes the cross-talk: after correction each plane is its emitted channel alone', () => {
    const fit = fitCrossTalk(patch());
    // One pixel of every colour of the cube, as the camera sees it.
    const pixels = CALIBRATION_SWATCHES.map((s) => observe([s[0] ? EMIT_LIGHT : EMIT_DARK, s[1] ? EMIT_LIGHT : EMIT_DARK, s[2] ? EMIT_LIGHT : EMIT_DARK]));
    const image: RgbaImage = { data: new Uint8ClampedArray(pixels.flatMap((p) => [p[0], p[1], p[2], 255])), width: 8, height: 1 };
    const planes = splitChannels(image, null, fit);
    CALIBRATION_SWATCHES.forEach((s, x) => {
      for (let channel = 0; channel < 3; channel++) expect(Math.abs(planes[channel].data[x] - (s[channel] ? 255 : 0))).toBeLessThanOrEqual(4);
    });
    // Without the model the planes are the raw camera channels.
    const raw = splitChannels(image, null, null);
    expect(raw[0].data[1]).toBe(pixels[1][0]);
  });
});

describe('the calibrator follows white balance (#1147)', () => {
  it('fits, stays steady, refits when white moves and rejects a bad patch', () => {
    const calibrator = new ColourCalibrator();
    expect(calibrator.update(patch())).toBe('fitted');
    expect(calibrator.update(patch())).toBe('steady');
    expect(calibrator.update(patch(MATRIX, [1.12, 1, 0.86]))).toBe('refit');
    expect(calibrator.driftRefits).toBe(1);
    const before = calibrator.model;
    expect(calibrator.update(patch().slice(0, 3))).toBe('rejected');
    expect(calibrator.model).toBe(before);
    expect(calibrator.rejects).toBe(1);
  });

  it('rescales between patches when the quiet-zone white moves, and ignores noise', () => {
    const calibrator = new ColourCalibrator();
    calibrator.update(patch());
    const white = observe([EMIT_LIGHT, EMIT_LIGHT, EMIT_LIGHT]);
    expect(calibrator.observeWhite([white[0] + 3, white[1] - 2, white[2]])).toBe(false);
    const moved = observe([EMIT_LIGHT, EMIT_LIGHT, EMIT_LIGHT], MATRIX, [1.05, 1, 0.85]);
    expect(calibrator.observeWhite(moved)).toBe(true);
    expect(calibrator.rescales).toBe(1);
    // The rescaled model reads a white pixel of the new balance as all three channels on.
    const image: RgbaImage = { data: new Uint8ClampedArray([moved[0], moved[1], moved[2], 255]), width: 1, height: 1 };
    for (const plane of splitChannels(image, null, calibrator.model)) expect(Math.abs(plane.data[0] - 255)).toBeLessThanOrEqual(2);
  });

  it('does not rescale to a sample that is far from white (a box on the wrong thing)', () => {
    const calibrator = new ColourCalibrator();
    calibrator.update(patch());
    // A strip that fell on the grey background, or on the dark modules of a code.
    expect(calibrator.observeWhite([128, 128, 128])).toBe(false);
    expect(calibrator.observeWhite([40, 40, 40])).toBe(false);
    expect(calibrator.rescales).toBe(0);
  });

  it('is only cheaper than a new patch: the model it keeps is the model a patch of that balance gives', () => {
    const rescaled = new ColourCalibrator();
    rescaled.update(patch());
    rescaled.observeWhite(observe([EMIT_LIGHT, EMIT_LIGHT, EMIT_LIGHT], MATRIX, [1.05, 1, 0.85]));
    const refit = fitCrossTalk(patch(MATRIX, [1.05, 1, 0.85]));
    for (let i = 0; i < 3; i++) expect(rescaled.model!.matrix[i][i]).toBeCloseTo(refit!.matrix[i][i], -1);
  });
});

describe('colour frames (#1147)', () => {
  it('puts a valid QR code on each channel: thresholded alone, each channel decodes', () => {
    const version = TILE_LAYOUTS['2x2-v20'].version;
    const texts = ['RED CHANNEL 1', 'GREEN CHANNEL 2', 'BLUE CHANNEL 3'];
    const tile = composeColourTile([grid(texts[0], version), grid(texts[1], version), grid(texts[2], version)], { modulePx: 3 });
    const planes = splitChannels(tile, null, null);
    planes.forEach((plane, channel) => {
      const rgba = new Uint8ClampedArray(plane.data.length * 4);
      plane.data.forEach((value, i) => rgba.fill(value, i * 4, i * 4 + 3));
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
      expect(jsQR(rgba, plane.width, plane.height)?.data).toBe(texts[channel]);
    });
  });

  it('refuses a tile whose three codes differ in size', () => {
    expect(() => composeColourTile([grid('a', 20), grid('b', 20), grid('c', 21)], { modulePx: 2 })).toThrow(RangeError);
  });

  it('carries the patch under a beacon, readable again after the camera mixes the channels', () => {
    const version = 20;
    const modulePx = 3;
    const bitmap = composeBeacon(grid('beacon', version), { modulePx });
    const modules = qrModuleCount(version);
    const code = { x: 4 * modulePx, y: 4 * modulePx, width: modules * modulePx, height: modules * modulePx };
    expect(beaconPatchRects(code, modules)).toHaveLength(8);
    expect(samplePatch(bitmap, code, modules)).toEqual(patch([[1, 0, 0], [0, 1, 0], [0, 0, 1]]).map((p) => [p[0] - 6, p[1] - 6, p[2] - 6]));
    const seen = samplePatch(throughCamera(bitmap), code, modules);
    expect(seen).toEqual(patch());
    // A patch outside the frame is not read.
    expect(samplePatch(bitmap, { ...code, y: bitmap.height }, modules)).toBeNull();
    expect(meanColour(bitmap, { x: -5, y: 0, width: 4, height: 4 })).toBeNull();
  });

  it('places every tile from a beacon: shared centre and module size', () => {
    const layout = TILE_LAYOUTS['2x2-v25'];
    const modulePx = 4;
    const side = qrModuleCount(40) * modulePx;
    const code = { x: 960 - side / 2, y: 540 - side / 2, width: side, height: side };
    const rects = tileRectsFromBeacon(code, 40, layout);
    expect(rects).toHaveLength(4);
    const pitch = (layout.modules + 8) * modulePx;
    expect(rects[0]).toEqual({ x: 960 - pitch + 4 * modulePx, y: 540 - pitch + 4 * modulePx, width: layout.modules * modulePx, height: layout.modules * modulePx });
    expect(rects[3].x - rects[0].x).toBe(pitch);
    expect(rects[3].y - rects[0].y).toBe(pitch);
  });
});

describe('the Colour profile and sender (#1147)', () => {
  async function manifestFor(size: number) {
    const random = createPrng(9);
    const file = new Uint8Array(size);
    for (let i = 0; i < size; i++) file[i] = Math.floor(random() * 256);
    const session = await createPrismSession(file, { fileName: 'colour.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 20 });
    return { file, manifest: session.manifest };
  }

  it('is Fast with three channels, and not offered', () => {
    expect(COLOUR_PROFILE.base).toBe(MULTI_RATE_PROFILES.fast);
    expect(COLOUR_PROFILE.channels).toBe(3);
    expect(COLOUR_PROFILE.offered).toBe(false);
    expect(COLOUR_PROFILE.name).toBe('colour');
  });

  it('is off unless a caller opts in', async () => {
    const { file, manifest } = await manifestFor(4000);
    expect(createColourSender({ message: file, manifest })).toBeNull();
    expect(createColourSender({ message: file, manifest, enabled: false })).toBeNull();
    expect(createColourSender({ message: file, manifest, enabled: true })).not.toBeNull();
  });

  it('shows three independent Prism frames per tile and a single-code beacon', async () => {
    const { file, manifest } = await manifestFor(40_000);
    const sender = createColourSender({ message: file, manifest, enabled: true });
    if (!sender) throw new Error('no sender');
    const dense = sender.frame(1);
    if (dense.kind !== 'dense') throw new Error('expected a dense frame');
    expect(dense.tiles).toHaveLength(sender.layout.tiles);
    const texts = dense.tiles.flat();
    expect(texts).toHaveLength(sender.layout.tiles * 3);
    expect(new Set(texts).size).toBe(texts.length);
    const symbols = new Set<number>();
    for (const text of texts) {
      const decoded = decodeFrame(text);
      expect(decoded.ok).toBe(true);
      if (decoded.ok && decoded.frame.type === 'data') symbols.add(decoded.frame.firstSymbol);
    }
    // Different symbols, so a channel is worth a full code and not a copy of another.
    expect(symbols.size).toBeGreaterThan(sender.layout.tiles * 3 - 3);
    const every = COLOUR_PROFILE.base.beaconEvery;
    expect(isBeaconFrame(every - 1, every)).toBe(true);
    expect(sender.frame(every - 1)).toMatchObject({ kind: 'beacon' });
  });

  it('tells a sender to drop to monochrome only when beacons read and colour never did', () => {
    expect(shouldFallBackToMono({ beaconReads: COLOUR_FALLBACK_BEACONS, colourReads: 0 })).toBe(true);
    expect(shouldFallBackToMono({ beaconReads: COLOUR_FALLBACK_BEACONS - 1, colourReads: 0 })).toBe(false);
    expect(shouldFallBackToMono({ beaconReads: 20, colourReads: 1 })).toBe(false);
  });
});
