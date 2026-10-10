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
 * Logos in EPS and PDF exports (#1362). Neither format can hold a PNG or SVG file as is,
 * so each `<image>` is decoded in the browser and embedded as RGB samples with its alpha.
 */

import { matrixScale, type SvgScene } from './vectorScene';

/** Decoded image samples: RGB, plus alpha when any pixel is not fully opaque. */
export interface RasterImage {
  width: number;
  height: number;
  rgb: Uint8Array;
  alpha: Uint8Array | null;
}

/** RGBA pixels, as `ImageData` holds them. */
export interface RgbaPixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Draws an image URL at the given pixel size. Rejects when it cannot be decoded. */
export type ImageDecoder = (href: string, width: number, height: number) => Promise<RgbaPixels>;

/** Options for the EPS and PDF writers. */
export interface VectorExportOptions {
  /** Image decoder for logos; defaults to the browser's. */
  decodeImage?: ImageDecoder;
}

/** Thrown when an export would otherwise leave out a logo it cannot embed. */
export class MissingImageError extends Error {
  constructor() {
    super("The logo couldn't be embedded in this file. Download PNG or SVG instead, or upload the logo again.");
    this.name = 'MissingImageError';
  }
}

/** Image samples per drawn unit (one SVG pixel, one PDF point): about 300 dpi in print. */
const SAMPLES_PER_UNIT = 4;
/** Longest side of an embedded image, in samples. */
const MAX_SAMPLES = 1024;

/** Decodes an image with the browser's `Image` and a canvas. */
const browserDecoder: ImageDecoder = (href, width, height) =>
  new Promise((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      reject(new Error('No image decoder'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('No 2D canvas'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(ctx.getImageData(0, 0, width, height));
    };
    img.onerror = () => reject(new Error('Image failed to decode'));
    // Only data URLs reach here: the SVG builder inlines every image.
    img.src = href;
  });

/** Splits RGBA pixels into RGB samples and an alpha channel (null when fully opaque). */
export function splitAlpha(pixels: RgbaPixels): RasterImage {
  const count = pixels.width * pixels.height;
  const rgb = new Uint8Array(count * 3);
  const alpha = new Uint8Array(count);
  let opaque = true;
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = pixels.data[i * 4];
    rgb[i * 3 + 1] = pixels.data[i * 4 + 1];
    rgb[i * 3 + 2] = pixels.data[i * 4 + 2];
    alpha[i] = pixels.data[i * 4 + 3];
    if (alpha[i] !== 255) opaque = false;
  }
  return { width: pixels.width, height: pixels.height, rgb, alpha: opaque ? null : alpha };
}

/**
 * Decodes every image a scene draws, at a resolution suited to its largest placement.
 * Images that fail to decode are left out of the map; the writers then refuse the export
 * with {@link MissingImageError} rather than drop the logo silently.
 * @param scene - The scene read from the export SVG.
 * @param decode - Image decoder; defaults to the browser's.
 * @returns Decoded images keyed by URL.
 */
export async function decodeSceneImages(scene: SvgScene, decode: ImageDecoder = browserDecoder): Promise<Map<string, RasterImage>> {
  const sizes = new Map<string, { width: number; height: number }>();
  for (const el of scene.elements) {
    if (el.kind !== 'image') continue;
    const scale = matrixScale(el.matrix) * SAMPLES_PER_UNIT;
    const fit = Math.min(1, MAX_SAMPLES / Math.max(el.width * scale, el.height * scale));
    const width = Math.max(1, Math.round(el.width * scale * fit));
    const height = Math.max(1, Math.round(el.height * scale * fit));
    const known = sizes.get(el.href);
    if (!known || width * height > known.width * known.height) sizes.set(el.href, { width, height });
  }

  const images = new Map<string, RasterImage>();
  await Promise.all(
    Array.from(sizes, async ([href, size]) => {
      try {
        images.set(href, splitAlpha(await decode(href, size.width, size.height)));
      } catch {
        // Left out: the writer refuses the export.
      }
    })
  );
  return images;
}

/**
 * Compresses bytes with zlib (PDF `FlateDecode`, PostScript `/FlateDecode filter`).
 * @returns The compressed bytes, or null when the runtime has no `CompressionStream`.
 */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined' || typeof Response === 'undefined') return null;
  const source = new Response(bytes.slice()).body;
  if (!source) return null;
  return new Uint8Array(await new Response(source.pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
}

/** Packs an alpha channel into a 1-bit mask (1 = painted), each row padded to a byte. */
export function alphaToMask(image: RasterImage, alpha: Uint8Array): Uint8Array {
  const rowBytes = Math.ceil(image.width / 8);
  const mask = new Uint8Array(rowBytes * image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (alpha[y * image.width + x] >= 128) mask[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return mask;
}
