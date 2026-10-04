import { describe, it, expect } from 'vitest';
import {
  MULTI_RATE_PROFILES,
  PrismReceiver,
  TILE_LAYOUTS,
  ROBUST_LAYER_HINT,
  STALL_HINT,
  classifyFrameText,
  createMultiRateSender,
  createPrismSession,
  createPrng,
  holdForTargetFps,
  isBeaconFrame,
  layerHint,
  type MultiRateProfileName,
} from '../index';

async function senderFor(name: MultiRateProfileName, size = 6000) {
  const random = createPrng(5);
  const file = new Uint8Array(size);
  for (let i = 0; i < size; i++) file[i] = Math.floor(random() * 256);
  // A precompressed type keeps the message equal to the file, so the manifest's length and CRC hold.
  const session = await createPrismSession(file, { fileName: 'multirate.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 20 });
  return { file, sender: createMultiRateSender({ message: file, manifest: session.manifest, profile: MULTI_RATE_PROFILES[name] }) };
}

describe('multi-rate profiles (#1143)', () => {
  it('names the three profiles and aims each at a rising tier', () => {
    expect(Object.keys(MULTI_RATE_PROFILES)).toEqual(['steady', 'balanced', 'fast']);
    expect(MULTI_RATE_PROFILES.balanced.targetKBps).toEqual([50, 150]);
    expect(MULTI_RATE_PROFILES.fast.targetKBps[0]).toBeGreaterThanOrEqual(MULTI_RATE_PROFILES.balanced.targetKBps[1]);
  });

  it('uses frame rates that are a whole number of refreshes on a 60 Hz display', () => {
    for (const profile of Object.values(MULTI_RATE_PROFILES)) {
      const hold = holdForTargetFps(60, profile.targetFps);
      expect(60 / hold).toBeLessThanOrEqual(profile.targetFps);
      expect(Number.isInteger(hold)).toBe(true);
    }
    expect(holdForTargetFps(60, MULTI_RATE_PROFILES.fast.targetFps)).toBe(1);
  });

  it('puts a beacon at the profile interval and dense frames elsewhere', () => {
    const every = MULTI_RATE_PROFILES.balanced.beaconEvery;
    const kinds = Array.from({ length: every * 2 }, (_, i) => isBeaconFrame(i, every));
    expect(kinds.filter(Boolean)).toHaveLength(2);
    expect(kinds[every - 1]).toBe(true);
    expect(kinds[0]).toBe(false);
  });
});

describe('the multi-rate sender', () => {
  it.each(['steady', 'balanced', 'fast'] as const)('shows a full dense frame or one beacon, and tells them apart by size (%s)', async (name) => {
    const { sender } = await senderFor(name);
    const layout = TILE_LAYOUTS[MULTI_RATE_PROFILES[name].layoutId];
    const every = MULTI_RATE_PROFILES[name].beaconEvery;
    const dense = sender.frame(1);
    const beacon = sender.frame(every - 1);
    expect(dense.kind).toBe('dense');
    expect(dense.texts).toHaveLength(layout.tiles);
    expect(beacon.kind).toBe('beacon');
    expect(beacon.texts).toHaveLength(1);
    for (const text of dense.texts) expect(classifyFrameText(text, layout, MULTI_RATE_PROFILES[name].beaconVersion)).toBe('dense');
    expect(classifyFrameText(beacon.texts[0], layout, MULTI_RATE_PROFILES[name].beaconVersion)).toBe('beacon');
    expect(sender.beaconSymbols).toBeGreaterThan(sender.denseSymbols);
  });

  it.each(['steady', 'balanced', 'fast'] as const)('lets a receiver that reads only the beacons finish every transfer (%s)', async (name) => {
    const { file, sender } = await senderFor(name);
    const receiver = new PrismReceiver();
    let beacons = 0;
    for (let index = 0; index < 4000 && !receiver.isComplete; index++) {
      const frame = sender.frame(index);
      if (frame.kind !== 'beacon') continue;
      beacons += 1;
      receiver.ingest(frame.texts[0]);
    }
    expect(receiver.isComplete).toBe(true);
    const { files } = await receiver.finalize();
    expect(files[0].data).toEqual(file);
    // The beacons carry symbols of the same code, so the count needed stays near K.
    expect(beacons * sender.beaconSymbols).toBeLessThan((file.length / sender.symbolSize) * 2.5 + 20);
  });

  it('finishes from a mix of dense frames and beacons, with some frames lost', async () => {
    const { file, sender } = await senderFor('balanced', 20_000);
    const receiver = new PrismReceiver();
    for (let index = 0; index < 4000 && !receiver.isComplete; index++) {
      if (index % 3 === 1) continue;
      for (const text of sender.frame(index).texts) receiver.ingest(text);
    }
    expect(receiver.isComplete).toBe(true);
    expect((await receiver.finalize()).files[0].data).toEqual(file);
  });
});

describe('the layer hint', () => {
  it('says nothing while dense frames are read', () => {
    expect(layerHint({ denseFrames: 10, beaconFrames: 2, secondsWithoutProgress: 0 })).toBeNull();
  });

  it('asks for a closer, steadier camera when only beacons are read', () => {
    expect(layerHint({ denseFrames: 0, beaconFrames: 3, secondsWithoutProgress: 1 })).toBe(ROBUST_LAYER_HINT);
  });

  it('suggests a lower speed after five seconds without progress, ahead of the layer hint', () => {
    expect(layerHint({ denseFrames: 0, beaconFrames: 3, secondsWithoutProgress: 5 })).toBe(STALL_HINT);
    expect(layerHint({ denseFrames: 0, beaconFrames: 0, secondsWithoutProgress: 4 })).toBeNull();
  });
});
