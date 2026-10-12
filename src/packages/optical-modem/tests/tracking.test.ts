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
import { HIGH_RATE_PROFILES, decodeModemFrame, encodeModemFrame, frameCapacity, loadOpticalModem, simulateCapture, type ModemProfile, type RgbaImage } from '../index';

const SESSION = 7;
const PITCH = 2;
const SHAPE: ModemProfile = { ...HIGH_RATE_PROFILES[0] };

/** The frame through the studio camera at about 4 camera pixels per cell, then moved by `dx`, `dy` pixels. */
function capture(frame: RgbaImage, dx: number, dy: number, seed: number): RgbaImage {
  const image = simulateCapture(frame, 'studio', { pixelsPerCell: 4.2, cellPitch: PITCH, seed });
  const { width, height } = image;
  const moved = new Uint8ClampedArray(image.data.length).fill(16);
  for (let y = 0; y < height; y++) {
    const from = y - dy;
    if (from < 0 || from >= height) continue;
    for (let x = 0; x < width; x++) {
      const fromX = x - dx;
      if (fromX < 0 || fromX >= width) continue;
      moved.set(image.data.subarray((from * width + fromX) * 4, (from * width + fromX) * 4 + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data: moved };
}

function sendFrame(seq: number): { image: RgbaImage; payload: Uint8Array } {
  const payload = Uint8Array.from({ length: frameCapacity(SHAPE).payloadBytes }, (_, i) => (i * 29 + seq * 13) & 255);
  return { image: encodeModemFrame(SHAPE, payload, SESSION, seq, PITCH), payload };
}

function allBlocks(result: ReturnType<typeof decodeModemFrame>, payload: Uint8Array): boolean {
  return result.ok && result.blocks.every((block, b) => block !== null && block.every((v, i) => v === payload[b * SHAPE.packetBytes + i]));
}

beforeAll(() => loadOpticalModem());

describe('tracked acquisition', () => {
  it('follows a frame that moves a few cells between camera frames and reads every block', () => {
    const first = sendFrame(1);
    const locked = decodeModemFrame(capture(first.image, 0, 0, 1), { geometries: [SHAPE] });
    expect(locked.ok && locked.tracked).toBe(false);
    expect(allBlocks(locked, first.payload)).toBe(true);
    if (!locked.ok) return;
    let hint = locked.track;
    // About 4 camera pixels per cell: these moves are up to five cells.
    for (const [seq, dx, dy] of [
      [2, 12, -8],
      [3, -20, 6],
      [4, 9, 18],
    ]) {
      const sent = sendFrame(seq);
      const result = decodeModemFrame(capture(sent.image, dx, dy, seq), { geometries: [SHAPE], track: hint });
      expect(result.ok && result.tracked, `frame ${seq}`).toBe(true);
      expect(allBlocks(result, sent.payload), `frame ${seq}`).toBe(true);
      if (result.ok) hint = result.track;
    }
  }, 120_000);

  it('falls back to the full search when the frame is far from where it was', () => {
    const first = sendFrame(1);
    const locked = decodeModemFrame(capture(first.image, 0, 0, 1), { geometries: [SHAPE] });
    if (!locked.ok) throw new Error('first frame not found');
    const far = { ...locked.track, fiducials: { ...locked.track.fiducials, points: locked.track.fiducials.points.map((p) => ({ x: p.x + 400, y: p.y - 300 })) } };
    const sent = sendFrame(2);
    const result = decodeModemFrame(capture(sent.image, 0, 0, 2), { geometries: [SHAPE], track: far });
    expect(result.ok && result.tracked).toBe(false);
    expect(allBlocks(result, sent.payload)).toBe(true);
  }, 120_000);
});
