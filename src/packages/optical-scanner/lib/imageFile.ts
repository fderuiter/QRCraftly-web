/**
 * Image-file decoding shared by the scanner worker and its main-thread fallback (#1098).
 *
 * A photo or screenshot is decoded at its native size capped at {@link FILE_SCAN_SIZES}[0] first,
 * where small codes in large photos still have enough pixels, then downscaled, where large, blurry
 * or noisy codes read better. Each size gets our reader's multi-pass decode (#1178).
 */
import { getDownscaledDimensions, mapCorners, type DecodedCode } from './contracts';

/** The sizes (longest side, px) an image file is decoded at, in order. */
export const FILE_SCAN_SIZES = [2048, 1024] as const;

/** Message type of a file scan request to the scanner worker. */
export const FILE_SCAN_MESSAGE = 'scan-file';

/** Worker answer when it cannot decode images itself (no `createImageBitmap` / `OffscreenCanvas`). */
export const FILE_SCAN_UNSUPPORTED = 'FILE_SCAN_UNSUPPORTED';

/** Worker answer when the browser could not read the file as an image. */
export const FILE_SCAN_UNREADABLE = 'FILE_SCAN_UNREADABLE';

/** A file scan request to the scanner worker. */
export interface FileScanRequest {
  type: typeof FILE_SCAN_MESSAGE;
  file: Blob;
  sequenceId: number;
}

/** The parts of a 2D context the decoder draws with. */
export interface PixelContext {
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
}

/** Decodes RGBA pixels: our reader's multi-pass decode. */
export type RgbaDecoder = (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => DecodedCode | null | Promise<DecodedCode | null>;

/**
 * Decodes a QR code in a decoded image at each of {@link FILE_SCAN_SIZES}.
 * @param image The decoded image (EXIF orientation already applied).
 * @param width Its width.
 * @param height Its height.
 * @param createContext Returns a 2D context of the given size (an `OffscreenCanvas` in the worker).
 * @param decode The pixel decoder.
 * @returns The decoded code, its corners in the image's own pixels, or null.
 */
export async function decodeImageAtSizes(
  image: CanvasImageSource,
  width: number,
  height: number,
  createContext: (width: number, height: number) => PixelContext | null,
  decode: RgbaDecoder
): Promise<DecodedCode | null> {
  let previous = '';
  for (const maxDimension of FILE_SCAN_SIZES) {
    const size = getDownscaledDimensions(width, height, maxDimension);
    const key = `${size.width}x${size.height}`;
    if (size.width === 0 || key === previous) continue;
    previous = key;
    const context = createContext(size.width, size.height);
    if (!context) throw new Error('Failed to create canvas context.');
    context.drawImage(image, 0, 0, size.width, size.height);
    const code = await decode(context.getImageData(0, 0, size.width, size.height).data, size.width, size.height);
    if (code) return { ...code, corners: mapCorners(code.corners, width / size.width, height / size.height) };
  }
  return null;
}
