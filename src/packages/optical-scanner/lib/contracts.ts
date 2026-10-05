/**
 * Type-guards, assertions, dimension calculators, and contracts
 * for the Optical Detection Engine package.
 */

/** A point in the scanned frame or image, in its pixels. */
export interface ScanPoint {
  x: number;
  y: number;
}

/** The four corners of a code: top-left, top-right, bottom-right, bottom-left (as the code reads). */
export type ScanCorners = readonly [ScanPoint, ScanPoint, ScanPoint, ScanPoint];

/**
 * Which decoder read a code: the platform's `BarcodeDetector`, the zxing-cpp WebAssembly reader
 * (ADR 0023) or our own Rust reader, `qr-decode` (#1178).
 */
export type ScanDecoder = 'native' | 'zxing' | 'qr-decode';

/** One decoded code, byte-exact (#1099). */
export interface DecodedCode {
  /** The payload as text. */
  text: string;
  /** The payload bytes exactly as encoded, when the decoder reports them (the native detector does not). */
  bytes: Uint8Array | null;
  /** Where the code is, in the coordinates of the frame or image that was scanned, when known. */
  corners: ScanCorners | null;
}

/** Message type of the compiled zxing reader posted to the scanner worker (ADR 0023). */
export const ZXING_MODULE_MESSAGE = 'zxing-module';

/** Where a camera frame posted to the worker was cut from, in the camera's own pixels. */
export interface ScanRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScannerRequest {
  image: ImageBitmap;
  width: number;
  height: number;
  sequenceId: number;
  epochId?: number;
  /** The part of the camera frame `image` shows (the whole frame when omitted). */
  region?: ScanRegion;
}

export interface ScannerResponse {
  status: 'pass' | 'fail';
  sequenceId: number;
  decodedData?: string | null;
  error?: string | null;
  buffer?: ArrayBuffer;
  epochId?: number;
  /** Payload bytes of a decoded code. */
  decodedBytes?: Uint8Array | null;
  /** Corners of a decoded code as x0, y0, ... x3, y3, in the camera frame's (or image's) pixels. */
  corners?: number[] | null;
  /** The decoder that read the code. */
  decoder?: ScanDecoder;
}

export type ScanSource = File | Blob | ImageData | ImageBitmap | HTMLCanvasElement;

export interface ScanResult {
  status: 'pass' | 'fail';
  /** The decoded text, or null. */
  data: string | null;
  error?: string | null;
  durationMs: number;
  /** The payload bytes exactly as encoded, when the decoder reports them. */
  bytes?: Uint8Array | null;
  /** Where the code is in the scanned image. */
  corners?: ScanCorners | null;
  /** The decoder that read the code. */
  source?: ScanDecoder;
}

/** Flattens corners for a worker message. */
export function cornersToArray(corners: ScanCorners | null): number[] | null {
  return corners ? corners.flatMap((point) => [point.x, point.y]) : null;
}

/** Rebuilds corners from a worker message (eight finite numbers), or null. */
export function cornersFromArray(values: readonly number[] | null | undefined): ScanCorners | null {
  if (!values || values.length !== 8 || !values.every((value) => Number.isFinite(value))) return null;
  return [
    { x: values[0], y: values[1] },
    { x: values[2], y: values[3] },
    { x: values[4], y: values[5] },
    { x: values[6], y: values[7] },
  ];
}

/**
 * Maps corners from a resized or cut-out image back to the image it came from:
 * `x' = offsetX + x * scaleX` (and likewise for y).
 */
export function mapCorners(
  corners: ScanCorners | null,
  scaleX: number,
  scaleY: number,
  offsetX = 0,
  offsetY = 0
): ScanCorners | null {
  if (!corners) return null;
  const map = (point: ScanPoint): ScanPoint => ({ x: offsetX + point.x * scaleX, y: offsetY + point.y * scaleY });
  return [map(corners[0]), map(corners[1]), map(corners[2]), map(corners[3])];
}

const DECODERS: readonly ScanDecoder[] = ['native', 'zxing', 'qr-decode'];

/** Checks the optional rich-result fields of a worker response. */
function richFieldsError(d: Record<string, unknown>): string | null {
  if (d.decodedBytes !== undefined && d.decodedBytes !== null && !(d.decodedBytes instanceof Uint8Array)) {
    return 'Scanner response decodedBytes must be a Uint8Array or null';
  }
  if (
    d.corners !== undefined &&
    d.corners !== null &&
    !(Array.isArray(d.corners) && d.corners.length === 8 && d.corners.every((n) => typeof n === 'number'))
  ) {
    return 'Scanner response corners must be eight numbers or null';
  }
  if (d.decoder !== undefined && !DECODERS.includes(d.decoder as ScanDecoder)) {
    return 'Scanner response decoder must be native, zxing or qr-decode';
  }
  return null;
}

export interface ScanOptions {
  signal?: AbortSignal;
  maxDimension?: number;
}

/**
 * Type-guard function for validating ScanOptions.
 */
export function isValidScanOptions(options: unknown): options is ScanOptions {
  if (options === undefined || options === null) return true;
  if (typeof options !== 'object') return false;
  const o = options as Record<string, unknown>;
  if (o.signal !== undefined && !(o.signal instanceof AbortSignal)) return false;
  if (
    o.maxDimension !== undefined &&
    (typeof o.maxDimension !== 'number' || !Number.isFinite(o.maxDimension) || o.maxDimension <= 0)
  ) {
    return false;
  }
  return true;
}

/**
 * Assertion function for ScanOptions.
 */
export function assertScanOptions(options: unknown): asserts options is ScanOptions {
  if (options === undefined || options === null) return;
  if (typeof options !== 'object') {
    throw new Error('ScanOptions must be an object');
  }
  const o = options as Record<string, unknown>;
  if (o.signal !== undefined && !(o.signal instanceof AbortSignal)) {
    throw new Error('ScanOptions signal must be an AbortSignal instance');
  }
  if (
    o.maxDimension !== undefined &&
    (typeof o.maxDimension !== 'number' || !Number.isFinite(o.maxDimension) || o.maxDimension <= 0)
  ) {
    throw new Error('ScanOptions maxDimension must be a positive finite number');
  }
}

export type ScannerStatus = 'idle' | 'checking' | 'pass' | 'fail';

/**
 * Calculates optimal downscaled dimensions preserving aspect ratio within a max constraint.
 */
export function getDownscaledDimensions(
  width: number,
  height: number,
  maxDimension = 1280
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: 0, height: 0 };
  }

  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }

  const aspectRatio = width / height;
  if (width > height) {
    const dWidth = maxDimension;
    const dHeight = Math.round(maxDimension / aspectRatio);
    return { width: dWidth, height: dHeight };
  } else {
    const dHeight = maxDimension;
    const dWidth = Math.round(maxDimension * aspectRatio);
    return { width: dWidth, height: dHeight };
  }
}

/**
 * Type-guard function for validating the Scanner Worker Request structure.
 */
export function isValidScannerRequest(data: unknown): data is ScannerRequest {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof ImageBitmap === 'undefined' || !(d.image instanceof ImageBitmap)) return false;
  if (typeof d.width !== 'number' || !Number.isFinite(d.width) || d.width <= 0) return false;
  if (typeof d.height !== 'number' || !Number.isFinite(d.height) || d.height <= 0) return false;
  if (typeof d.sequenceId !== 'number' || !Number.isFinite(d.sequenceId)) return false;
  if (d.epochId !== undefined && (typeof d.epochId !== 'number' || !Number.isFinite(d.epochId))) return false;
  if (d.region !== undefined && !isScanRegion(d.region)) return false;
  return true;
}

/** Whether a value is a {@link ScanRegion} with a positive size. */
function isScanRegion(value: unknown): value is ScanRegion {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    [r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    (r.width as number) > 0 &&
    (r.height as number) > 0
  );
}

/**
 * Assertion function for Scanner Worker Request.
 */
export function assertScannerRequest(data: unknown): asserts data is ScannerRequest {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Scanner request must be a non-null object');
  }
  const d = data as Record<string, unknown>;
  if (typeof ImageBitmap === 'undefined' || !(d.image instanceof ImageBitmap)) {
    throw new Error('Scanner request must contain a valid ImageBitmap');
  }
  if (typeof d.width !== 'number' || !Number.isFinite(d.width) || d.width <= 0) {
    throw new Error('Scanner request width must be a positive number');
  }
  if (typeof d.height !== 'number' || !Number.isFinite(d.height) || d.height <= 0) {
    throw new Error('Scanner request height must be a positive number');
  }
  if (typeof d.sequenceId !== 'number' || !Number.isFinite(d.sequenceId)) {
    throw new Error('Scanner request sequenceId must be a valid number');
  }
  if (d.epochId !== undefined && (typeof d.epochId !== 'number' || !Number.isFinite(d.epochId))) {
    throw new Error('Scanner request epochId must be a valid number');
  }
  if (d.region !== undefined && !isScanRegion(d.region)) {
    throw new Error('Scanner request region must have finite coordinates and a positive size');
  }
}

/**
 * Type-guard function for validating the Scanner Worker Response structure.
 */
export function isValidScannerResponse(data: unknown): data is ScannerResponse {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.status !== 'pass' && d.status !== 'fail') return false;
  if (typeof d.sequenceId !== 'number' || !Number.isFinite(d.sequenceId)) return false;
  if (d.decodedData !== undefined && d.decodedData !== null && typeof d.decodedData !== 'string') return false;
  if (d.error !== undefined && d.error !== null && typeof d.error !== 'string') return false;
  if (d.epochId !== undefined && (typeof d.epochId !== 'number' || !Number.isFinite(d.epochId))) return false;
  if (richFieldsError(d) !== null) return false;
  return true;
}

/**
 * Assertion function for Scanner Worker Response.
 */
export function assertScannerResponse(data: unknown): asserts data is ScannerResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Scanner response must be a non-null object');
  }
  const d = data as Record<string, unknown>;
  if (d.status !== 'pass' && d.status !== 'fail') {
    throw new Error('Scanner response status must be either "pass" or "fail"');
  }
  if (typeof d.sequenceId !== 'number' || !Number.isFinite(d.sequenceId)) {
    throw new Error('Scanner response sequenceId must be a valid number');
  }
  if (d.decodedData !== undefined && d.decodedData !== null && typeof d.decodedData !== 'string') {
    throw new Error('Scanner response decodedData must be a string or null');
  }
  if (d.error !== undefined && d.error !== null && typeof d.error !== 'string') {
    throw new Error('Scanner response error must be a string or null');
  }
  if (d.buffer !== undefined && d.buffer !== null && !(d.buffer instanceof ArrayBuffer)) {
    throw new Error('Scanner response buffer must be an ArrayBuffer');
  }
  if (d.epochId !== undefined && (typeof d.epochId !== 'number' || !Number.isFinite(d.epochId))) {
    throw new Error('Scanner response epochId must be a valid number');
  }
  const richError = richFieldsError(d);
  if (richError) throw new Error(richError);
}

