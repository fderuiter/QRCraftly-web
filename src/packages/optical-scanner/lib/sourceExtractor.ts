import { loadQrReader } from '@/packages/qr-decode';
import {
  getDownscaledDimensions,
  mapCorners,
  type DecodedCode,
  type ScanDecoder,
  type ScanOptions,
  type ScanResult,
  type ScanSource,
} from './contracts';
import { dispatchWorkerRequest } from './workerRunner';
import { decodeImageDataSync, decodeRgbaCode } from './decodeSync';
import { decodeImageAtSizes, FILE_SCAN_MESSAGE, type FileScanRequest } from './imageFile';
import { getNativeQrDetector, type NativeQrDetector } from './nativeDetector';
import { assertImageWithinLimits, exceedsPixelLimit, IMAGE_TOO_LARGE_PIXELS_MESSAGE } from './imageLimits';

/** A large photo gets the multi-pass decoder at two sizes; allow a slow phone time for that. */
const FILE_SCAN_TIMEOUT_MS = 10_000;
/** File scans number their requests apart from camera frames, which share the worker. */
let fileSequenceId = 1_000_000;

const NO_CODE_IN_IMAGE = 'No QR code detected in this image. Try a clearer or higher-contrast QR code image.';
const NOT_AN_IMAGE = 'Only images can be scanned. Use a photo or screenshot of the QR code.';
const UNREADABLE_IMAGE = 'Failed to load image file.';
/** Longest side, in pixels, an SVG file is drawn at before it is read. */
const SVG_RASTER_SIZE = 1024;

/** A decode and the decoder that produced it. */
interface Decoded {
  code: DecodedCode | null;
  source: ScanDecoder;
}

/** A decoded image and how to release it. */
interface LoadedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** Loads an image with FileReader and an image element. */
function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(UNREADABLE_IMAGE));
      img.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

/** Whether a file is an SVG drawing, which `createImageBitmap` cannot decode (#1294). */
function isSvg(file: Blob): boolean {
  return file.type === 'image/svg+xml';
}

/**
 * Draws an SVG at {@link SVG_RASTER_SIZE} on its longest side. A drawing has no pixel size of its
 * own, so a fixed size also keeps the 40-megapixel limit (#1299).
 */
function rasterizeSvg(img: HTMLImageElement): LoadedImage {
  const naturalWidth = img.naturalWidth || img.width;
  const naturalHeight = img.naturalHeight || img.height;
  // A drawing with no width and height of its own is drawn square.
  const scale = naturalWidth && naturalHeight ? SVG_RASTER_SIZE / Math.max(naturalWidth, naturalHeight) : 0;
  const width = scale ? Math.max(1, Math.round(naturalWidth * scale)) : SVG_RASTER_SIZE;
  const height = scale ? Math.max(1, Math.round(naturalHeight * scale)) : SVG_RASTER_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(UNREADABLE_IMAGE);
  // Transparent drawings are read as dark marks on white, like a printed code.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return { image: canvas, width, height, close: () => {} };
}

/** Refuses a decoded image whose header did not show it was over the pixel limit (#1299). */
function withinPixelLimit(loaded: LoadedImage): LoadedImage {
  if (!exceedsPixelLimit(loaded.width, loaded.height)) return loaded;
  loaded.close();
  throw new Error(IMAGE_TOO_LARGE_PIXELS_MESSAGE);
}

/**
 * Decodes the file into pixels on this thread, applying its EXIF orientation. An SVG, or a file
 * `createImageBitmap` cannot decode, goes through an image element instead.
 */
async function loadImage(file: Blob): Promise<LoadedImage> {
  if (isSvg(file)) {
    if (typeof document === 'undefined') throw new Error(UNREADABLE_IMAGE);
    return rasterizeSvg(await loadImageElement(file));
  }
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return withinPixelLimit({ image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() });
    } catch (err) {
      if (err instanceof Error && err.message === IMAGE_TOO_LARGE_PIXELS_MESSAGE) throw err;
      if (typeof document === 'undefined') throw new Error(UNREADABLE_IMAGE);
    }
  }
  const img = await loadImageElement(file);
  return withinPixelLimit({ image: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, close: () => {} });
}

/** Main-thread fallback when the worker cannot decode the file (no OffscreenCanvas, hung, crashed). */
async function decodeImageFileHere(file: Blob): Promise<DecodedCode | null> {
  if (typeof document === 'undefined') {
    throw new Error('File decoding requires DOM environment');
  }
  const reader = await loadQrReader();
  const loaded = await loadImage(file);
  try {
    return await decodeImageAtSizes(
      loaded.image,
      loaded.width,
      loaded.height,
      (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas.getContext('2d', { willReadFrequently: true });
      },
      (data, width, height) => decodeRgbaCode(reader, data, width, height)
    );
  } finally {
    loaded.close();
  }
}

/** Whether a file can be an image. Files with no type (some pickers) are tried anyway. */
function mayBeImage(file: Blob): boolean {
  return file.type === '' || file.type.startsWith('image/');
}

/** Decodes an image file with the platform's detector (EXIF orientation applied). */
async function detectInImageFile(detector: NativeQrDetector, file: Blob): Promise<DecodedCode | null> {
  const loaded = await loadImage(file);
  try {
    if (typeof ImageBitmap !== 'undefined' && loaded.image instanceof ImageBitmap) {
      return await detector.detect(loaded.image);
    }
    if (typeof HTMLImageElement !== 'undefined' && loaded.image instanceof HTMLImageElement) {
      return await detector.detect(loaded.image);
    }
    if (typeof HTMLCanvasElement !== 'undefined' && loaded.image instanceof HTMLCanvasElement) {
      return await detector.detect(loaded.image);
    }
    return null;
  } finally {
    loaded.close();
  }
}

/**
 * Decodes an image file: with the platform's detector when it reads QR codes (#1099), otherwise in
 * the scanner worker with our reader, or here when the worker cannot. Concurrent calls are
 * independent: a newer file does not fail because an older one is still being decoded.
 */
async function scanImageFile(file: Blob, signal?: AbortSignal): Promise<Decoded> {
  const detector = await getNativeQrDetector();
  if (detector) return { code: await detectInImageFile(detector, file), source: 'native' };

  // The worker has no image element to draw an SVG with.
  if (isSvg(file)) return { code: await decodeImageFileHere(file), source: 'qr-decode' };

  fileSequenceId += 1;
  const request: FileScanRequest = { type: FILE_SCAN_MESSAGE, file, sequenceId: fileSequenceId };
  const worker = dispatchWorkerRequest(request, [], {
    signal,
    timeoutMs: FILE_SCAN_TIMEOUT_MS,
  });
  const result = await worker;
  if (result.code || signal?.aborted) return { code: result.code ?? null, source: result.decoder ?? 'qr-decode' };
  // No error: the worker read the image and found no code. Otherwise it could not decode it.
  if (result.error === IMAGE_TOO_LARGE_PIXELS_MESSAGE) throw new Error(IMAGE_TOO_LARGE_PIXELS_MESSAGE);
  if (!result.error) return { code: null, source: result.decoder ?? 'qr-decode' };
  return { code: await decodeImageFileHere(file), source: 'qr-decode' };
}

/** Builds a scan result from a decode. */
function toScanResult(decoded: Decoded, start: number, noCodeError: string): ScanResult {
  const { code, source } = decoded;
  return {
    status: code ? 'pass' : 'fail',
    data: code?.text ?? null,
    error: code ? null : noCodeError,
    durationMs: performance.now() - start,
    bytes: code?.bytes ?? null,
    corners: code?.corners ?? null,
    source,
  };
}

/** The platform detector's answer for an in-memory source, or undefined when there is no detector. */
async function detectNatively(source: ImageData | ImageBitmap | HTMLCanvasElement): Promise<Decoded | undefined> {
  const detector = await getNativeQrDetector();
  if (!detector) return undefined;
  return { code: await detector.detect(source), source: 'native' };
}

/**
 * Extracts and decodes QR codes from any supported ScanSource.
 */
export async function scanSource(source: ScanSource, options: ScanOptions = {}): Promise<ScanResult> {
  const start = performance.now();
  const signal = options.signal;

  if (signal?.aborted) {
    return {
      status: 'fail',
      data: null,
      error: 'ABORTED',
      durationMs: 0,
    };
  }

  try {
    // 1-3. Pixels already in memory: the platform's detector when it reads QR codes, else our reader here.
    const inMemory =
      (typeof ImageData !== 'undefined' && source instanceof ImageData) ||
      (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) ||
      (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap);
    if (inMemory) {
      const native = await detectNatively(source);
      if (native) return toScanResult(native, start, 'NO_QR_DETECTED');
    }

    // 1. Direct ImageData
    if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
      const code = decodeImageDataSync(await loadQrReader(), source, source.width, source.height);
      return toScanResult({ code, source: 'qr-decode' }, start, 'NO_QR_DETECTED');
    }

    // 2. HTMLCanvasElement
    if (typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement) {
      const ctx = source.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to acquire canvas 2D rendering context');
      }
      const imgData = ctx.getImageData(0, 0, source.width, source.height);
      const code = decodeImageDataSync(await loadQrReader(), imgData, source.width, source.height);
      return toScanResult({ code, source: 'qr-decode' }, start, 'NO_QR_DETECTED');
    }

    // 3. ImageBitmap
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
      const { width: dWidth, height: dHeight } = getDownscaledDimensions(
        source.width,
        source.height,
        options.maxDimension ?? 1280
      );
      let imgData: ImageData | null = null;
      if (typeof OffscreenCanvas !== 'undefined') {
        const offscreen = new OffscreenCanvas(dWidth, dHeight);
        const ctx = offscreen.getContext('2d');
        if (ctx) {
          ctx.drawImage(source, 0, 0, dWidth, dHeight);
          imgData = ctx.getImageData(0, 0, dWidth, dHeight);
        }
      } else if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = dWidth;
        canvas.height = dHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(source, 0, 0, dWidth, dHeight);
          imgData = ctx.getImageData(0, 0, dWidth, dHeight);
        }
      }

      if (!imgData) {
        throw new Error('Failed to extract pixels from ImageBitmap');
      }

      const found = decodeImageDataSync(await loadQrReader(), imgData, dWidth, dHeight);
      // Corners back in the bitmap's own pixels.
      const code = found && { ...found, corners: mapCorners(found.corners, source.width / dWidth, source.height / dHeight) };
      return toScanResult({ code, source: 'qr-decode' }, start, 'NO_QR_DETECTED');
    }

    // 4. Image File or Blob
    if (typeof Blob !== 'undefined' && source instanceof Blob) {
      if (!mayBeImage(source)) {
        throw new Error(NOT_AN_IMAGE);
      }
      await assertImageWithinLimits(source);
      const decoded = await scanImageFile(source, signal);
      if (signal?.aborted) {
        return { status: 'fail', data: null, error: 'ABORTED', durationMs: performance.now() - start };
      }
      return toScanResult(decoded, start, NO_CODE_IN_IMAGE);
    }

    throw new Error('Unsupported scan source type');
  } catch (err) {
    const durationMs = performance.now() - start;
    return {
      status: 'fail',
      data: null,
      error: (err instanceof Error && err.message) || 'Scanning failed',
      durationMs,
    };
  }
}
