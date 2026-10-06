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
 * The browser side of `scripts/optical_gpu_conformance.ts`: bundled to one script, loaded into a
 * headless browser, and driven from Node. It only runs the GPU kernel and times it; the reference
 * kernel and every comparison stay in Node.
 */
import { createGpuKernel, selfTestGpuKernel, type GpuKernel, type GpuSelfTest } from '../../src/packages/optical-modem/gpu.ts';
import { loadOpticalModem } from '../../src/packages/optical-modem/index.ts';

/** Kernel inputs as plain numbers, so they cross the browser boundary as JSON. */
export interface WireUniforms {
  cols: number;
  dataRows: number;
  rowOffset: number;
  homography: number[];
  palette: number[];
}

export interface PageApi {
  /** Loads the modem module from its bytes (the reference kernel of the self-test runs in it), then builds the GPU kernel. */
  init(moduleBase64: string): Promise<{ ok: true; renderer: string | null; selfTest: GpuSelfTest } | { ok: false; reason: string }>;
  run(width: number, height: number, pixels: string, uniforms: WireUniforms): { symbols: string; confidence: string; means: string } | null;
  time(width: number, height: number, uniforms: WireUniforms, reps: number): number[];
}

declare global {
  interface Window {
    opticalGpu: PageApi;
  }
}

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(out);
};

let kernel: GpuKernel | null = null;

const unwire = (u: WireUniforms) => ({ cols: u.cols, dataRows: u.dataRows, rowOffset: u.rowOffset, homography: Float32Array.from(u.homography), palette: Int32Array.from(u.palette) });

window.opticalGpu = {
  async init(moduleBase64) {
    await loadOpticalModem(fromBase64(moduleBase64));
    const made = createGpuKernel();
    if (!made.ok) return { ok: false, reason: made.reason };
    kernel = made.kernel;
    return { ok: true, renderer: kernel.renderer, selfTest: selfTestGpuKernel(kernel) };
  },
  run(width, height, pixels, uniforms) {
    const bytes = fromBase64(pixels);
    const data = new Uint8ClampedArray(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const grid = kernel?.run({ width, height, data }, unwire(uniforms), { means: true });
    return grid ? { symbols: toBase64(grid.symbols), confidence: toBase64(grid.confidence), means: toBase64(grid.means) } : null;
  },
  time(width, height, uniforms, reps) {
    if (!kernel) return [];
    // Noise frame made in the page, so no pixels cross the boundary while timing.
    const data = new Uint8ClampedArray(width * height * 4);
    let state = 12345;
    for (let i = 0; i < data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[i] = i % 4 === 3 ? 255 : state >>> 24;
    }
    const image = { width, height, data };
    const u = unwire(uniforms);
    const times: number[] = [];
    kernel.run(image, u);
    for (let r = 0; r < reps; r++) {
      const start = performance.now();
      kernel.run(image, u);
      times.push(performance.now() - start);
    }
    return times;
  },
};
