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
import { GPU_FALLBACK_MESSAGES, createGpuKernel, createVerifiedGpuKernel, selfTestGpuKernel, type GpuCanvas, type GpuKernel } from '../gpu';
import { runReferenceKernel, type KernelUniforms } from '../index';

type Call = [string, unknown[]];

/**
 * A stand-in for a WebGL 2 context. Every method records its call and returns undefined, every
 * constant is its own name, and `overrides` replace what a test cares about. It proves the
 * orchestration (what is uploaded, what is read back); that the shader is right is proved in a
 * browser by `pnpm run bench:optical-gpu`.
 */
function fakeGl(overrides: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const gl = new Proxy(
    {},
    {
      get(_, name: string) {
        if (name in overrides) return overrides[name];
        if (/^[A-Z][A-Z0-9_]+$/.test(name)) return name;
        return (...args: unknown[]) => {
          calls.push([name, args]);
          return name.startsWith('create') ? { created: name } : undefined;
        };
      },
    }
  );
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

const canvasOf = (gl: WebGL2RenderingContext | null): GpuCanvas => ({ getContext: () => gl });

const UNIFORMS: KernelUniforms = { cols: 3, dataRows: 2, rowOffset: 9, homography: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]), palette: Int32Array.from([0, 0, 0, 255, 255, 255]) };
const IMAGE = { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(9) };

describe('GPU kernel set-up', () => {
  it('says why there is no kernel, in words the receiver can show', () => {
    expect(createGpuKernel(canvasOf(null))).toEqual({ ok: false, reason: 'no-webgl2' });
    const noCompile = fakeGl({ getShaderParameter: () => false });
    expect(createGpuKernel(canvasOf(noCompile.gl))).toEqual({ ok: false, reason: 'shader-failed' });
    const noLink = fakeGl({ getShaderParameter: () => true, getProgramParameter: () => false });
    expect(createGpuKernel(canvasOf(noLink.gl))).toEqual({ ok: false, reason: 'shader-failed' });
    for (const message of Object.values(GPU_FALLBACK_MESSAGES)) expect(message).toMatch(/QR profiles still work/);
  });

  it('uploads the pixels untouched, sets the colour handling off, and reads back only symbols and confidences by default', () => {
    const read: number[] = [];
    let attachment = 0;
    const { gl, calls } = fakeGl({
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 'R' }),
      getParameter: () => 'Test GPU',
      isContextLost: () => false,
      COLOR_ATTACHMENT0: 100,
      readBuffer: (name: number) => {
        attachment = name;
      },
      readPixels: (_x: number, _y: number, _w: number, _h: number, _f: unknown, _t: unknown, out: Uint8Array) => {
        read.push(attachment);
        for (let i = 0; i < out.length; i += 4) {
          out[i] = i / 4;
          out[i + 1] = 200;
          out[i + 2] = 3;
        }
      },
    });
    const made = createGpuKernel(canvasOf(gl));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.kernel.renderer).toBe('Test GPU');
    const grid = made.kernel.run(IMAGE, UNIFORMS);
    expect(grid?.symbols).toEqual(Uint8Array.from([0, 1, 2, 3, 4, 5]));
    expect(grid?.confidence).toEqual(new Uint8Array(6).fill(200));
    expect(read).toEqual([100]);
    const named = (name: string) => calls.filter(([n]) => n === name).map(([, args]) => args);
    expect(named('pixelStorei')).toEqual(
      expect.arrayContaining([
        ['UNPACK_PREMULTIPLY_ALPHA_WEBGL', false],
        ['UNPACK_COLORSPACE_CONVERSION_WEBGL', 'NONE'],
        ['UNPACK_FLIP_Y_WEBGL', false],
      ])
    );
    expect(named('uniform1fv')[0][1]).toEqual(UNIFORMS.homography);
    expect(named('uniform1i')).toContainEqual([undefined, 9]);
    const palette = named('uniform3iv')[0][1] as Int32Array;
    expect(palette).toHaveLength(48);
    expect(Array.from(palette.subarray(0, 6))).toEqual([0, 0, 0, 255, 255, 255]);
    expect(named('viewport')).toEqual([[0, 0, 3, 2]]);
    const upload = named('texImage2D').find((args) => args.length === 9 && args[3] === 2);
    expect(upload?.[8]).toBeInstanceOf(Uint8Array);

    const withMeans = made.kernel.run(IMAGE, UNIFORMS, { means: true });
    expect(Array.from(withMeans?.means ?? [])).toEqual([0, 1, 2, 3, 4, 5].flatMap((i) => [i, 200, 3]));
    expect(read).toEqual([100, 100, 101]);
    made.kernel.dispose();
    expect(calls.some(([n]) => n === 'deleteProgram')).toBe(true);
  });

  it('takes a video frame or any texture source without copying it through the CPU', () => {
    const { gl, calls } = fakeGl({ getShaderParameter: () => true, getProgramParameter: () => true, getExtension: () => null, isContextLost: () => false, readPixels: () => undefined });
    const made = createGpuKernel(canvasOf(gl));
    if (!made.ok) throw new Error('no kernel');
    const bitmap = { width: 2, height: 2, close: () => undefined } as unknown as ImageBitmap;
    made.kernel.run(bitmap, UNIFORMS);
    expect(calls.some(([n, args]) => n === 'texImage2D' && args.length === 6 && args[5] === bitmap)).toBe(true);
    expect(made.kernel.renderer).toBeNull();
  });

  it('returns nothing once the context is lost, so the receiver can fall back', () => {
    const { gl } = fakeGl({ getShaderParameter: () => true, getProgramParameter: () => true, isContextLost: () => true });
    const made = createGpuKernel(canvasOf(gl));
    if (!made.ok) throw new Error('no kernel');
    expect(made.kernel.run(IMAGE, UNIFORMS)).toBeNull();
  });
});

describe('self-test', () => {
  const reference: GpuKernel = {
    renderer: null,
    run: (image, u) => ('data' in image ? runReferenceKernel(image, u) : null),
    dispose: () => undefined,
  };

  it('passes a kernel that is the reference and fails one that is off by a single symbol', () => {
    const exact = selfTestGpuKernel(reference);
    expect(exact.exact).toBe(true);
    expect(exact.cells).toBe(3 * 104 * 40);
    const off: GpuKernel = {
      ...reference,
      run: (image, u) => {
        const grid = reference.run(image, u);
        if (grid) grid.symbols[100] ^= 1;
        return grid;
      },
    };
    const result = selfTestGpuKernel(off);
    expect(result.exact).toBe(false);
    expect(result.difference.symbolMismatches).toBe(3);
  });

  it('fails a kernel that has lost its context', () => {
    expect(selfTestGpuKernel({ ...reference, run: () => null }).exact).toBe(false);
  });

  it('builds a kernel only after it has passed: a GL that returns zeros is refused as not bit-exact', () => {
    const { gl } = fakeGl({ getShaderParameter: () => true, getProgramParameter: () => true, getExtension: () => null, isContextLost: () => false, readPixels: vi.fn() });
    expect(createVerifiedGpuKernel(canvasOf(gl))).toEqual({ ok: false, reason: 'not-bit-exact' });
    expect(createVerifiedGpuKernel(canvasOf(null))).toEqual({ ok: false, reason: 'no-webgl2' });
  });
});
