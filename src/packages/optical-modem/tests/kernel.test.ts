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

import { describe, expect, it, vi } from 'vitest';
import {
  FRAGMENT_SHADER,
  FrameRateMeter,
  KERNEL_MAX_SYMBOLS,
  MODEM_PROFILES,
  VERTEX_SHADER,
  compareGrids,
  decodeModemFrame,
  encodeModemFrame,
  frameCapacity,
  grantedSettings,
  runReferenceKernel,
  simulateCapture,
  watchFrames,
  type KernelUniforms,
  type SampledGrid,
} from '../index';

const PROFILE = MODEM_PROFILES[0];

function capture() {
  const payload = Uint8Array.from({ length: frameCapacity(PROFILE).payloadBytes }, (_, i) => (i * 29 + 5) & 255);
  return { payload, image: simulateCapture(encodeModemFrame(PROFILE, payload, 7, 2, 4), 'typical', { pixelsPerCell: 5, cellPitch: 4, seed: 3 }) };
}

/** Runs a decode with a hook that records what the kernel was given. */
function uniformsOf(image: ReturnType<typeof capture>['image']): KernelUniforms {
  let found: KernelUniforms | null = null;
  decodeModemFrame(image, {
    sampleGrid: (_image, uniforms) => {
      found = uniforms;
      return null;
    },
  });
  if (!found) throw new Error('The frame was not found');
  return found;
}

describe('reference kernel', () => {
  it('is what the decoder uses: a hook that returns the reference result changes nothing, and null falls back to it', () => {
    const { image } = capture();
    const plain = decodeModemFrame(image);
    const uniforms = uniformsOf(image);
    expect(uniforms).toMatchObject({ cols: PROFILE.cols, dataRows: PROFILE.rows - 18, rowOffset: 9 });
    expect(uniforms.homography).toHaveLength(9);
    expect(uniforms.palette).toHaveLength(4 * 3);
    const viaHook = decodeModemFrame(image, { sampleGrid: (img, u) => runReferenceKernel(img, u) });
    expect(viaHook).toEqual(plain);
  });

  it('lets another kernel take over, and shows what it was given', () => {
    const { image, payload } = capture();
    const wrong = vi.fn((_: unknown, u: KernelUniforms): SampledGrid => {
      const cells = u.cols * u.dataRows;
      return { symbols: new Uint8Array(cells), confidence: new Uint8Array(cells), means: new Uint8Array(cells * 3) };
    });
    const result = decodeModemFrame(image, { sampleGrid: wrong });
    expect(wrong).toHaveBeenCalledTimes(1);
    // An all-zero grid is nothing like the frame: no block comes back as the data that was sent.
    expect(result.ok && result.blocks.some((block) => block !== null && block.every((v, i) => v === payload[i]))).toBe(false);
  });

  it('gives one symbol, one confidence and one mean colour for each data cell, with symbols inside the palette', () => {
    const { image } = capture();
    const uniforms = uniformsOf(image);
    const grid = runReferenceKernel(image, uniforms);
    const cells = uniforms.cols * uniforms.dataRows;
    expect([grid.symbols.length, grid.confidence.length, grid.means.length]).toEqual([cells, cells, cells * 3]);
    expect(Math.max(...grid.symbols)).toBeLessThan(uniforms.palette.length / 3);
    expect(uniforms.palette.length / 3).toBeLessThanOrEqual(KERNEL_MAX_SYMBOLS);
  });
});

describe('compareGrids', () => {
  it('counts every kind of difference and is zero for equal grids', () => {
    const a: SampledGrid = { symbols: Uint8Array.from([1, 2, 3]), confidence: Uint8Array.from([9, 9, 9]), means: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]) };
    expect(compareGrids(a, { ...a, means: a.means.slice() })).toEqual({ cells: 3, symbolMismatches: 0, confidenceMismatches: 0, meanMismatches: 0 });
    const b: SampledGrid = { symbols: Uint8Array.from([1, 0, 3]), confidence: Uint8Array.from([9, 9, 0]), means: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 0]) };
    expect(compareGrids(a, b)).toEqual({ cells: 3, symbolMismatches: 1, confidenceMismatches: 1, meanMismatches: 1 });
    expect(compareGrids(a, { ...a, symbols: Uint8Array.from([1, 2]) }).symbolMismatches).toBeGreaterThan(0);
  });
});

describe('shader source', () => {
  it('keeps to the determinism rules: no transcendental or fused built-ins, integers for everything that is rounded', () => {
    for (const forbidden of ['pow', 'exp', 'log', 'sin', 'cos', 'tan', 'sqrt', 'inversesqrt', 'fma', 'mix', 'smoothstep', 'round', 'texture', 'mod']) {
      expect(FRAGMENT_SHADER).not.toMatch(new RegExp(`\\b${forbidden}\\s*\\(`));
    }
    expect(FRAGMENT_SHADER).toContain('texelFetch');
    expect(FRAGMENT_SHADER).toContain('(sum + 4) / 9');
    expect(FRAGMENT_SHADER).toContain(`uPalette[${KERNEL_MAX_SYMBOLS}]`);
  });

  it('takes its sample positions and channel weights from the reference code', () => {
    expect(FRAGMENT_SHADER).toContain('float[3](0.3125, 0.5, 0.6875)');
    expect(FRAGMENT_SHADER).toContain('ivec3(3, 4, 2)');
    expect(VERTEX_SHADER.startsWith('#version 300 es')).toBe(true);
    expect(FRAGMENT_SHADER.startsWith('#version 300 es')).toBe(true);
  });
});

describe('frame source', () => {
  it('reads what the camera granted and reports zero for what the browser leaves out', () => {
    expect(grantedSettings({ getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }) })).toEqual({ width: 1920, height: 1080, frameRate: 60 });
    expect(grantedSettings({ getSettings: () => ({}) })).toEqual({ width: 0, height: 0, frameRate: 0 });
  });

  it('calls back once per presented video frame, until stopped', () => {
    const slot: { pending: ((now: number, metadata: { presentedFrames: number }) => void) | null } = { pending: null };
    const cancelled: number[] = [];
    const video = {
      requestVideoFrameCallback: (cb: (now: number, metadata: { presentedFrames: number }) => void) => {
        slot.pending = cb;
        return 41;
      },
      cancelVideoFrameCallback: (handle: number) => cancelled.push(handle),
    };
    const seen: [number, number | null][] = [];
    // The stand-in has only the two methods the watcher uses.
    const watcher = watchFrames(video as unknown as HTMLVideoElement, (tick) => seen.push([tick.now, tick.presentedFrames]));
    slot.pending?.(100, { presentedFrames: 1 });
    slot.pending?.(133, { presentedFrames: 2 });
    expect(seen).toEqual([
      [100, 1],
      [133, 2],
    ]);
    watcher.stop();
    expect(cancelled).toEqual([41]);
    slot.pending?.(166, { presentedFrames: 3 });
    expect(seen).toHaveLength(2);
  });

  it('falls back to animation frames where the video element has no frame callback', () => {
    const frame: { pending: FrameRequestCallback | null } = { pending: null };
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frame.pending = cb;
      return 5;
    });
    const cancel = vi.fn();
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const seen: (number | null)[] = [];
    const watcher = watchFrames({}, (tick) => seen.push(tick.presentedFrames));
    frame.pending?.(16);
    watcher.stop();
    vi.unstubAllGlobals();
    expect(seen).toEqual([null]);
    expect(cancel).toHaveBeenCalledWith(5);
  });

  it('measures frame rate over a window and counts frames the page was too slow to take', () => {
    const meter = new FrameRateMeter(1000);
    expect(meter.fps).toBe(0);
    for (let i = 0; i < 31; i++) meter.record({ now: i * 33.333, presentedFrames: i + (i > 10 ? 2 : 0) });
    expect(meter.fps).toBeCloseTo(30, 0);
    expect(meter.droppedFrames).toBe(2);
    meter.record({ now: 5000, presentedFrames: null });
    expect(meter.fps).toBe(0);
  });
});
