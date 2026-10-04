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

import { describe, expect, it } from 'vitest';
import {
  PrismReceiver,
  createPrismSession,
  createReceiverNonce,
  crc32c,
  decodeBase45,
  decodeFrame,
  encodeBase45,
  encodeFeedbackFrame,
  looksLikePrismFrame,
  type FeedbackLayer,
} from '../index';

const SESSION = Uint8Array.from([1, 2, 3, 4, 5, 6]);
const NONCE = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);

const feedback = (overrides: Partial<{ fractionDecoded: number; frameSuccessRate: number; densestLayer: FeedbackLayer; done: boolean }> = {}) =>
  encodeFeedbackFrame({ sessionId: SESSION, nonce: NONCE, fractionDecoded: 0.5, frameSuccessRate: 0.75, densestLayer: 'balanced', done: false, ...overrides });

describe('feedback frame (#1146)', () => {
  it('round-trips every field, quantised to 16 and 8 bits', () => {
    const decoded = decodeFrame(feedback({ fractionDecoded: 0.3333, frameSuccessRate: 0.9, densestLayer: 'fast', done: true }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || decoded.frame.type !== 'feedback') throw new Error('not a feedback frame');
    expect(decoded.frame.sessionId).toBe('010203040506');
    expect(decoded.frame.nonce).toBe('deadbeef');
    expect(decoded.frame.fractionDecoded).toBeCloseTo(0.3333, 4);
    expect(decoded.frame.frameSuccessRate).toBeCloseTo(0.9, 2);
    expect(decoded.frame.densestLayer).toBe('fast');
    expect(decoded.frame.done).toBe(true);
  });

  it.each<FeedbackLayer>(['none', 'steady', 'balanced', 'fast'])('carries the %s layer', (layer) => {
    const decoded = decodeFrame(feedback({ densestLayer: layer }));
    expect(decoded.ok && decoded.frame.type === 'feedback' && decoded.frame.densestLayer).toBe(layer);
  });

  it('clamps out-of-range fractions instead of wrapping', () => {
    const decoded = decodeFrame(feedback({ fractionDecoded: 7, frameSuccessRate: Number.NaN }));
    expect(decoded.ok && decoded.frame.type === 'feedback' && [decoded.frame.fractionDecoded, decoded.frame.frameSuccessRate]).toEqual([1, 0]);
  });

  it('is small enough for a corner of the screen', () => {
    // 12 header bytes, 9 payload bytes and a CRC: 25 bytes, 38 Base45 characters.
    expect(feedback().length).toBeLessThanOrEqual(40);
  });

  it('still looks like a Prism frame, so a camera filter keeps it for decodeFrame to classify', () => {
    expect(looksLikePrismFrame(feedback())).toBe(true);
  });

  it('rejects a flipped bit, a wrong payload length and an unknown layer or done byte', () => {
    const bytes = decodeBase45(feedback()) ?? new Uint8Array();
    const seal = (copy: Uint8Array) => {
      new DataView(copy.buffer).setUint32(copy.length - 4, crc32c(copy.subarray(0, copy.length - 4)));
      return decodeFrame(encodeBase45(copy));
    };
    const flipped = bytes.slice();
    flipped[14] ^= 0x01;
    expect(decodeFrame(encodeBase45(flipped))).toMatchObject({ ok: false, reason: 'corrupt' });
    const longer = new Uint8Array(bytes.length + 1);
    longer.set(bytes.subarray(0, bytes.length - 4));
    expect(seal(longer)).toMatchObject({ ok: false, reason: 'malformed' });
    const badLayer = bytes.slice();
    badLayer[12 + 7] = 9;
    expect(seal(badLayer)).toMatchObject({ ok: false, reason: 'malformed' });
    const badDone = bytes.slice();
    badDone[12 + 8] = 2;
    expect(seal(badDone)).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('refuses a nonce of the wrong size', () => {
    expect(() => encodeFeedbackFrame({ sessionId: SESSION, nonce: new Uint8Array(3), fractionDecoded: 0, frameSuccessRate: 0, densestLayer: 'none', done: false })).toThrow(RangeError);
  });

  it('makes a fresh random nonce each time', () => {
    const a = createReceiverNonce();
    const b = createReceiverNonce();
    expect(a).toHaveLength(4);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('is never ingested as data: a receiver ignores it, before and after the manifest', async () => {
    const file = Uint8Array.from({ length: 900 }, (_, i) => (i * 31) % 251);
    const session = await createPrismSession(file, { fileName: 'a.bin', mimeType: 'image/png', errorCorrectionLevel: 'L', maxVersion: 10 });
    const receiver = new PrismReceiver();
    const frames = [session.stream.frameText(0), session.stream.frameText(1), session.stream.frameText(2)];
    const bogus = encodeFeedbackFrame({ sessionId: session.stream.sessionId, nonce: NONCE, fractionDecoded: 1, frameSuccessRate: 1, densestLayer: 'fast', done: true });
    expect(receiver.ingest(bogus)).toBeNull();
    expect(receiver.manifest).toBeNull();
    for (const frame of frames) receiver.ingest(frame);
    const before = receiver.snapshot();
    expect(before).not.toBeNull();
    expect(receiver.ingest(bogus)).toBeNull();
    expect(receiver.snapshot()).toEqual(before);
    expect(receiver.isComplete).toBe(false);
  });
});
