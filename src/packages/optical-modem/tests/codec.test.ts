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

import { beforeAll, describe, expect, it } from 'vitest';
import { MODEM_PROFILES, decodeModemFrame, encodeModemFrame, frameCapacity, simulateCapture, type ModemProfile, type RgbaImage , loadOpticalModem } from '../index';

const SESSION = 99;
const PITCH = 4;

function payloadFor(profile: ModemProfile, salt: number): Uint8Array {
  return Uint8Array.from({ length: frameCapacity(profile).payloadBytes }, (_, i) => (i * 37 + salt * 11 + 3) & 255);
}

/** A 32-bit FNV-1a hash of the pixels, to pin a frame without storing it. */
function hash(image: RgbaImage): number {
  let h = 0x811c9dc5;
  for (const v of image.data) h = Math.imul(h ^ v, 0x01000193) >>> 0;
  return h;
}

function repairedAll(result: ReturnType<typeof decodeModemFrame>, payload: Uint8Array, profile: ModemProfile): boolean {
  if (!result.ok) return false;
  return result.blocks.every((block, b) => block !== null && block.every((v, i) => v === payload[b * profile.packetBytes + i]));
}

beforeAll(() => loadOpticalModem());

describe('frame capacity', () => {
  it('fills the grid with whole blocks and refuses shapes that cannot hold one', () => {
    for (const profile of MODEM_PROFILES) {
      const capacity = frameCapacity(profile);
      expect(capacity.blocks * capacity.blockBytes).toBeLessThanOrEqual(capacity.streamBytes);
      expect(capacity.streamBytes - capacity.blocks * capacity.blockBytes).toBeLessThan(capacity.blockBytes);
      expect(capacity.payloadBytes).toBe(capacity.blocks * profile.packetBytes);
    }
    expect(() => frameCapacity({ ...MODEM_PROFILES[0], packetBytes: 200, parity: 60 })).toThrow();
    expect(() => encodeModemFrame(MODEM_PROFILES[0], new Uint8Array(frameCapacity(MODEM_PROFILES[0]).payloadBytes + 1), SESSION, 0, PITCH)).toThrow();
  });
});

describe('modem frames', () => {
  it('is deterministic: the same input draws the same pixels, and a changed sequence changes them', () => {
    const profile = MODEM_PROFILES[1];
    const payload = payloadFor(profile, 1);
    const a = encodeModemFrame(profile, payload, SESSION, 5, PITCH);
    expect(hash(encodeModemFrame(profile, payload, SESSION, 5, PITCH))).toBe(hash(a));
    expect(hash(encodeModemFrame(profile, payload, SESSION, 6, PITCH))).not.toBe(hash(a));
    // Pinned: integer maths only, so every JavaScript engine must produce exactly this frame.
    expect(hash(a)).toBe(PINNED_FRAME_HASH);
  });

  it.each(MODEM_PROFILES.map((p) => [`P${p.id} ${p.name}`, p] as const))('round-trips %s through a good channel, with the header read from the frame', { timeout: 60000 }, (_, profile) => {
    const payload = payloadFor(profile, profile.id);
    const capture = simulateCapture(encodeModemFrame(profile, payload, SESSION, 3, PITCH), 'studio', { pixelsPerCell: 6, cellPitch: PITCH, seed: 5 });
    const result = decodeModemFrame(capture);
    expect(repairedAll(result, payload, profile)).toBe(true);
    if (!result.ok) return;
    expect(result.header).toMatchObject({ profile: profile.id, session: SESSION, seq: 3, packetBytes: profile.packetBytes, parity: profile.parity, cols: profile.cols, rows: profile.rows });
  });

  it('survives a stripe lost across the whole frame because blocks are interleaved', { timeout: 60000 }, () => {
    const profile = MODEM_PROFILES[1];
    const payload = payloadFor(profile, 2);
    const capture = simulateCapture(encodeModemFrame(profile, payload, SESSION, 4, PITCH), 'studio', { pixelsPerCell: 6, cellPitch: PITCH, seed: 2 });
    // Grey out about a fifth of the data rows, as an unlucky screen refresh or a reflection would.
    const data = capture.data.slice();
    const from = Math.floor(capture.height * 0.4) * capture.width * 4;
    const to = Math.floor(capture.height * 0.52) * capture.width * 4;
    for (let i = from; i < to; i++) data[i] = 128;
    const damaged = { width: capture.width, height: capture.height, data };
    expect(repairedAll(decodeModemFrame(damaged), payload, profile)).toBe(true);
  });

  it('repairs at least as many blocks with erasures as without on a hard channel, and never returns wrong data', { timeout: 120000 }, () => {
    const profile = MODEM_PROFILES[2];
    let hard = 0;
    let soft = 0;
    for (const seed of [1, 2]) {
      const payload = payloadFor(profile, seed);
      const capture = simulateCapture(encodeModemFrame(profile, payload, SESSION, seed, PITCH), 'typical', { pixelsPerCell: 5, cellPitch: PITCH, seed });
      for (const soft_ of [false, true]) {
        const result = decodeModemFrame(capture, { soft: soft_ });
        if (!result.ok) continue;
        result.blocks.forEach((block, b) => {
          if (!block) return;
          // A repaired block is the block that was sent: the code never invents data silently.
          expect(block.every((v, i) => v === payload[b * profile.packetBytes + i])).toBe(true);
          if (soft_) soft++;
          else hard++;
        });
      }
    }
    expect(soft).toBeGreaterThanOrEqual(hard);
    expect(soft).toBeGreaterThan(0);
  });

  it('reports an image without a frame, and a frame of a size the receiver does not know', { timeout: 60000 }, () => {
    const blank: RgbaImage = { width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4).fill(200) };
    expect(decodeModemFrame(blank)).toEqual({ ok: false, reason: 'no-fiducials' });
    const profile = MODEM_PROFILES[0];
    const capture = simulateCapture(encodeModemFrame(profile, payloadFor(profile, 1), SESSION, 1, PITCH), 'studio', { pixelsPerCell: 6, cellPitch: PITCH, seed: 1 });
    const other = decodeModemFrame(capture, { geometries: [{ cols: 120, rows: 67 }] });
    expect(other.ok).toBe(false);
  });
});

/** Hash of profile 3, session 99, sequence 5 at 4 px per cell; see the determinism test. */
const PINNED_FRAME_HASH = 960878469;
