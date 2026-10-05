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

import { qrEncoder as QRCode } from './fixtures/qrEncoder';
import { describe, expect, it } from 'vitest';
import { COLOUR_FALLBACK_HINT, composeBeacon, composeColourTile, fitCrossTalk, qrModuleCount, samplePatch, splitChannels } from '../src/packages/optical-transfer/index';
import { CLEAN_CHANNEL, COLOUR_BLIND_CHANNEL, REFERENCE_CHANNEL, capture, qrDecoders, runColourTransfer } from './utils/colourBench';
import { createRandom } from './utils/scannerCorpus';

// A smaller screen makes every full-frame decode cheaper; the beacons (3 px modules) still read.
const SMALL_SCREEN = { width: 800, height: 800, modulePx: 3 };

describe('Colour layer simulation (#1147)', () => {
  it('moves a file through cross-talk, a white balance shift and JPEG-like noise, three decodes per tile', async () => {
    // The white balance starts to move right after the first beacon, so a later beacon has to refit.
    const channel = { ...REFERENCE_CHANNEL, shiftAt: 13, shiftOver: 4 };
    const result = await runColourTransfer({ mode: 'colour', bytes: 200_000, channel });
    expect(result.complete).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.state).toBe('colour');
    expect(result.colourReads).toBeGreaterThan(100);
    expect(result.fits).toBeGreaterThanOrEqual(2);
    expect(result.driftRefits + result.rescales).toBeGreaterThanOrEqual(1);
    // Each tile of each frame costs three decodes, so the count is a multiple of three.
    expect(result.tileDecodes % 3).toBe(0);
    expect(result.tileDecodes).toBeGreaterThanOrEqual(result.colourReads);
  }, 240_000);

  it('needs the correction: the raw channels of the same camera do not decode, the corrected ones do', () => {
    const grid = (text: string) => QRCode.create(text, { errorCorrectionLevel: 'L', version: 20 }).modules;
    const texts = ['RED ' + 'r'.repeat(300), 'GREEN ' + 'g'.repeat(300), 'BLUE ' + 'b'.repeat(300)];
    const tile = composeColourTile([grid(texts[0]), grid(texts[1]), grid(texts[2])], { modulePx: 4 });
    const seen = capture(tile, REFERENCE_CHANNEL, 0, createRandom(3));
    const seenBeacon = capture(composeBeacon(QRCode.create('beacon', { errorCorrectionLevel: 'L', version: 40 }).modules, { modulePx: 4 }), REFERENCE_CHANNEL, 0, createRandom(4));
    const modules = qrModuleCount(40);
    const patch = samplePatch(seenBeacon, { x: 16, y: 16, width: modules * 4, height: modules * 4 }, modules);
    const model = patch ? fitCrossTalk(patch) : null;
    expect(model).not.toBeNull();
    const read = (planes: ReturnType<typeof splitChannels>) => planes.map((plane) => qrDecoders.decodePlane(plane)?.text);
    expect(read(splitChannels(seen, null, null))).not.toEqual(texts);
    expect(read(splitChannels(seen, null, model))).toEqual(texts);
  });

  it('completes from the beacons when colour never reads, and says so', async () => {
    // A decoder that cannot read any colour crop: the camera is too slow or too small for it.
    const result = await runColourTransfer({ mode: 'colour', bytes: 8_000, channel: CLEAN_CHANNEL, screen: SMALL_SCREEN, decodePlane: () => null, fallbackBeacons: 1, maxFrames: 400 });
    expect(result.complete).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.state).toBe('mono');
    expect(result.reason).toBe('unreadable');
    expect(result.hint).toBe(COLOUR_FALLBACK_HINT);
    expect(result.colourReads).toBe(0);
    expect(result.beaconReads).toBeGreaterThan(2);
  }, 240_000);

  it('completes from the beacons when the patch cannot be trusted (a camera that sees no colour)', async () => {
    const result = await runColourTransfer({ mode: 'colour', bytes: 3_000, channel: COLOUR_BLIND_CHANNEL, screen: SMALL_SCREEN, maxFrames: 400 });
    expect(result.complete).toBe(true);
    expect(result.verified).toBe(true);
    expect(result.state).toBe('mono');
    expect(result.fits).toBe(0);
    expect(result.reason).toBe('calibration');
    expect(result.hint).toBe(COLOUR_FALLBACK_HINT);
  }, 240_000);
});
