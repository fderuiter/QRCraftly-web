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

import { describe, it, expect } from 'vitest';
import {
  FEEDBACK_WINDOW_FRAMES,
  TILE_LAYOUTS,
  createFeedbackMeter,
  createMultiRateSender,
  createPrismSession,
  createPrng,
  switchableProfile,
  type MultiRateProfileName,
} from '../index';

/** The dense tiles and a beacon of one profile, each with its QR version. */
async function codesOf(name: MultiRateProfileName) {
  const random = createPrng(9);
  const file = Uint8Array.from({ length: 4000 }, () => Math.floor(random() * 256));
  const session = await createPrismSession(file, { fileName: 'meter.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 20 });
  const profile = switchableProfile(name);
  const sender = createMultiRateSender({ message: file, manifest: session.manifest, profile });
  const version = TILE_LAYOUTS[profile.layoutId].version;
  const dense = sender.frame(1).texts.map((text) => ({ text, version }));
  const beacon = sender.frame(profile.beaconEvery - 1).texts.map((text) => ({ text, version: profile.beaconVersion }));
  return { dense, beacon };
}

describe('the receiver feedback meter (#1146)', () => {
  it('scores each camera frame by the share of its layout read and names the densest layer', async () => {
    const balanced = await codesOf('balanced');
    const meter = createFeedbackMeter();
    meter.record(balanced.dense);
    meter.record(balanced.dense.slice(0, 2));
    expect(meter.measure()).toEqual({ frameSuccessRate: 0.75, densestLayer: 'balanced' });
  });

  it('counts a beacon-only frame as read but names no dense layer, and an empty frame as missed', async () => {
    const steady = await codesOf('steady');
    const meter = createFeedbackMeter();
    meter.record(steady.beacon);
    meter.record([]);
    meter.record([{ text: 'https://example.com', version: 3 }]);
    expect(meter.measure()).toEqual({ frameSuccessRate: 1 / 3, densestLayer: 'none' });
  });

  it('keeps only the last frames and starts over on reset', async () => {
    const fast = await codesOf('fast');
    const steady = await codesOf('steady');
    const meter = createFeedbackMeter();
    meter.record(fast.dense);
    for (let frame = 0; frame < FEEDBACK_WINDOW_FRAMES; frame++) meter.record(steady.dense);
    expect(meter.measure()).toEqual({ frameSuccessRate: 1, densestLayer: 'steady' });
    meter.reset();
    expect(meter.measure()).toEqual({ frameSuccessRate: 0, densestLayer: 'none' });
  });
});
