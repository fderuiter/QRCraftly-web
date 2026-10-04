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

import { KERNEL_MAX_SYMBOLS, compareGrids, runReferenceKernel, type GridDifference, type KernelUniforms } from './kernel';
import type { RgbaImage } from './layout';
import { createRng } from './prng';
import type { SampledGrid } from './sample';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './shader';

/** Why the GPU kernel is not in use. The receiver shows this and stays on the QR profiles. */
export type GpuFallbackReason = 'no-webgl2' | 'shader-failed' | 'context-lost' | 'not-bit-exact';

/** What the person is told when the receiver has no GPU path. */
export const GPU_FALLBACK_MESSAGES: Readonly<Record<GpuFallbackReason, string>> = {
  'no-webgl2': 'This browser has no WebGL 2, so the colour modem is off. QR profiles still work.',
  'shader-failed': 'The graphics driver could not compile the colour decoder, so the colour modem is off. QR profiles still work.',
  'context-lost': 'The graphics context was lost, so the colour modem is off. QR profiles still work.',
  'not-bit-exact': 'This graphics chip does not match the reference decoder bit for bit, so the colour modem is off. QR profiles still work.',
};

/** Anything WebGL 2 can take as a texture source: a canvas, a bitmap, a video element or a `VideoFrame`. */
export type GpuFrameSource = RgbaImage | TexImageSource;

/** A compiled decode kernel bound to one WebGL 2 context. */
export interface GpuKernel {
  /** The driver's renderer string, where the browser reveals it; null otherwise. */
  readonly renderer: string | null;
  /**
   * Runs the kernel. Reads back only the symbol and confidence of each cell, and the mean colour when asked.
   * @param source - The frame: raw RGBA pixels or any texture source.
   * @param uniforms - Homography, palette and grid size.
   * @param options - `means` also reads back the mean colours (for conformance tests; the receiver does not need them).
   * @returns The grid, or null once the context is lost.
   */
  run(source: GpuFrameSource, uniforms: KernelUniforms, options?: { means?: boolean }): SampledGrid | null;
  /** Releases the GPU objects. */
  dispose(): void;
}

/** Result of {@link createGpuKernel}. */
export type GpuKernelResult = { ok: true; kernel: GpuKernel } | { ok: false; reason: GpuFallbackReason };

/** What the kernel needs of a canvas; an `HTMLCanvasElement` and an `OffscreenCanvas` both fit. */
export interface GpuCanvas {
  getContext(contextId: 'webgl2', options?: WebGLContextAttributes): WebGL2RenderingContext | null;
  addEventListener?(type: string, listener: (event: Event) => void): void;
  removeEventListener?(type: string, listener: (event: Event) => void): void;
}

function isRgbaImage(source: GpuFrameSource): source is RgbaImage {
  return 'data' in source && 'width' in source && 'height' in source && source.data instanceof Uint8ClampedArray;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
}

/**
 * Compiles the decode kernel on a WebGL 2 context. WebGL 2 is the one GPU path built: WebGPU compute
 * is not, and nothing here needs it, because the kernel is a per-cell map with no shared memory.
 * @param canvas - The canvas to take a context from; by default an offscreen canvas.
 * @returns The kernel, or the reason there is none.
 */
export function createGpuKernel(canvas?: GpuCanvas): GpuKernelResult {
  const surface: GpuCanvas | null = canvas ?? (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : typeof document !== 'undefined' ? document.createElement('canvas') : null);
  const gl = surface?.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) return { ok: false, reason: 'no-webgl2' };
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = vertex && fragment ? gl.createProgram() : null;
  if (!vertex || !fragment || !program) return { ok: false, reason: 'shader-failed' };
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return { ok: false, reason: 'shader-failed' };
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
  const where = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  const locations = { image: where('uImage'), h: where('uH[0]'), rowOffset: where('uRowOffset'), symbols: where('uSymbols'), palette: where('uPalette[0]') };
  const frameTexture = gl.createTexture();
  const targets = [gl.createTexture(), gl.createTexture()];
  const framebuffer = gl.createFramebuffer();
  const vao = gl.createVertexArray();
  const paletteBuffer = new Int32Array(KERNEL_MAX_SYMBOLS * 3);
  let targetSize = { cols: 0, rows: 0 };
  let lost = false;
  const onLost = (event: Event): void => {
    event.preventDefault();
    lost = true;
  };
  surface?.addEventListener?.('webglcontextlost', onLost);

  gl.bindTexture(gl.TEXTURE_2D, frameTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const sizeTargets = (cols: number, rows: number): void => {
    if (targetSize.cols === cols && targetSize.rows === rows) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    targets.forEach((texture, i) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8UI, cols, rows, 0, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, texture, 0);
    });
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    targetSize = { cols, rows };
  };

  const read = (attachment: number, cols: number, rows: number): Uint8Array => {
    const out = new Uint8Array(cols * rows * 4);
    gl.readBuffer(gl.COLOR_ATTACHMENT0 + attachment);
    gl.readPixels(0, 0, cols, rows, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, out);
    return out;
  };

  const kernel: GpuKernel = {
    renderer,
    run(source, uniforms, options) {
      if (lost || gl.isContextLost()) return null;
      const { cols, dataRows } = uniforms;
      sizeTargets(cols, dataRows);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frameTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      if (isRgbaImage(source)) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(source.data.buffer, source.data.byteOffset, source.data.byteLength));
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
      paletteBuffer.fill(0);
      paletteBuffer.set(uniforms.palette.subarray(0, KERNEL_MAX_SYMBOLS * 3));
      gl.uniform1i(locations.image, 0);
      gl.uniform1fv(locations.h, uniforms.homography);
      gl.uniform1i(locations.rowOffset, uniforms.rowOffset);
      gl.uniform1i(locations.symbols, Math.min(KERNEL_MAX_SYMBOLS, uniforms.palette.length / 3));
      gl.uniform3iv(locations.palette, paletteBuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, cols, dataRows);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const cells = cols * dataRows;
      const pairs = read(0, cols, dataRows);
      const symbols = new Uint8Array(cells);
      const confidence = new Uint8Array(cells);
      for (let i = 0; i < cells; i++) {
        symbols[i] = pairs[i * 4];
        confidence[i] = pairs[i * 4 + 1];
      }
      const means = new Uint8Array(cells * 3);
      if (options?.means) {
        const raw = read(1, cols, dataRows);
        for (let i = 0; i < cells; i++) means.set(raw.subarray(i * 4, i * 4 + 3), i * 3);
      }
      return { symbols, confidence, means };
    },
    dispose() {
      surface?.removeEventListener?.('webglcontextlost', onLost);
      gl.deleteTexture(frameTexture);
      targets.forEach((texture) => gl.deleteTexture(texture));
      gl.deleteFramebuffer(framebuffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    },
  };
  return { ok: true, kernel };
}

/** Result of {@link selfTestGpuKernel}. */
export interface GpuSelfTest {
  /** True when the GPU and the reference kernel agreed on every cell of every case. */
  exact: boolean;
  cells: number;
  /** Worst case, summed over the test cases. */
  difference: GridDifference;
}

/**
 * Builds noise frames with a perspective homography and a palette of 4, 8 and 16 colours, runs them
 * through the reference kernel and the GPU kernel and compares the bytes. Noise puts many sample
 * positions close to a pixel boundary, which is where a floating point difference would show. A
 * receiver runs this once, before it trusts the GPU; if the answer is not exact it stays on the CPU.
 * No modem frame is needed, because the kernel is a function of pixels, homography and palette only.
 * @param kernel - The GPU kernel to test.
 * @returns Whether it is bit for bit equal to the reference, with the counts.
 */
export function selfTestGpuKernel(kernel: GpuKernel): GpuSelfTest {
  const total: GridDifference = { cells: 0, symbolMismatches: 0, confidenceMismatches: 0, meanMismatches: 0 };
  const rng = createRng(0x51ca9e);
  for (const symbols of [4, 8, 16]) {
    const width = 160;
    const height = 96;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i++) data[i] = i % 4 === 3 ? 255 : rng.nextUint32() & 255;
    const image: RgbaImage = { width, height, data };
    const palette = Int32Array.from({ length: symbols * 3 }, () => rng.nextUint32() & 255);
    // About 1.3 pixels per cell with a mild perspective, so samples fall everywhere between pixels.
    const homography = Float32Array.from([1.31, 0.07, 3.3, -0.05, 1.27, 2.9, 0.0011, 0.0007, 1]);
    const uniforms: KernelUniforms = { cols: 104, dataRows: 40, rowOffset: 9, homography, palette };
    const gpu = kernel.run(image, uniforms, { means: true });
    if (!gpu) return { exact: false, cells: total.cells, difference: total };
    const diff = compareGrids(runReferenceKernel(image, uniforms), gpu);
    total.cells += diff.cells;
    total.symbolMismatches += diff.symbolMismatches;
    total.confidenceMismatches += diff.confidenceMismatches;
    total.meanMismatches += diff.meanMismatches;
  }
  return { exact: total.symbolMismatches + total.confidenceMismatches + total.meanMismatches === 0, cells: total.cells, difference: total };
}

/**
 * Builds the GPU kernel and only returns it when the self-test is exact.
 * @param canvas - Optional canvas to take the context from.
 * @returns A trusted kernel, or why the receiver stays on the CPU.
 */
export function createVerifiedGpuKernel(canvas?: GpuCanvas): GpuKernelResult {
  const made = createGpuKernel(canvas);
  if (!made.ok) return made;
  const test = selfTestGpuKernel(made.kernel);
  if (test.exact) return made;
  made.kernel.dispose();
  return { ok: false, reason: 'not-bit-exact' };
}
