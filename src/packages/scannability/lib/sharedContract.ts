// Helper type to extract guarded type from a guard function
type GuardedType<T> = T extends (x: unknown) => x is infer U ? U : never;

/**
 * Type-guard function for validating the Worker Request structure.
 */
export function isWorkerRequest(data: unknown): data is {
  imageData?: {
    data: Uint8ClampedArray;
    width?: number;
    height?: number;
  };
  imageBitmap?: ImageBitmap;
  buffer?: ArrayBuffer;
  sequenceId?: number;
  width: number;
  height: number;
  configId?: string | null;
  moduleCount?: number;
} {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.imageData !== undefined) {
    if (typeof d.imageData !== 'object' || d.imageData === null) return false;
    const imgData = d.imageData as { data?: unknown };
    if (!imgData.data || !(imgData.data instanceof Uint8ClampedArray)) return false;
  } else if (d.imageBitmap !== undefined) {
    if (typeof d.imageBitmap !== 'object' || d.imageBitmap === null) return false;
  } else {
    return false;
  }
  if (d.buffer !== undefined && d.buffer !== null && !(d.buffer instanceof ArrayBuffer)) return false;
  if (d.sequenceId !== undefined && typeof d.sequenceId !== 'number') return false;
  if (typeof d.width !== 'number' || isNaN(d.width) || d.width <= 0) return false;
  if (typeof d.height !== 'number' || isNaN(d.height) || d.height <= 0) return false;
  if (d.configId !== undefined && d.configId !== null && typeof d.configId !== 'string') return false;
  if (d.moduleCount !== undefined && d.moduleCount !== null && (typeof d.moduleCount !== 'number' || isNaN(d.moduleCount) || d.moduleCount <= 0)) return false;
  return true;
}

export type WorkerRequest = GuardedType<typeof isWorkerRequest>;

/**
 * Assertion function for Worker Request.
 */
export function assertWorkerRequest(data: unknown): asserts data is WorkerRequest {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Worker request must be a non-null object');
  }
  const d = data as Record<string, unknown>;
  if (d.imageData === undefined && d.imageBitmap === undefined) {
    throw new Error('Worker request must contain an imageData object');
  }
  if (d.imageData !== undefined) {
    if (typeof d.imageData !== 'object' || d.imageData === null) {
      throw new Error('Worker request must contain an imageData object');
    }
    const imgData = d.imageData as { data?: unknown };
    if (!imgData.data || !(imgData.data instanceof Uint8ClampedArray)) {
      throw new Error('Worker request imageData.data must be a Uint8ClampedArray');
    }
  } else if (d.imageBitmap !== undefined) {
    if (typeof d.imageBitmap !== 'object' || d.imageBitmap === null) {
      throw new Error('Worker request must contain a valid imageBitmap');
    }
  }
  if (d.buffer !== undefined && d.buffer !== null && !(d.buffer instanceof ArrayBuffer)) {
    throw new Error('Worker request buffer must be an ArrayBuffer');
  }
  if (d.sequenceId !== undefined && typeof d.sequenceId !== 'number') {
    throw new Error('Worker request sequenceId must be a number');
  }
  if (typeof d.width !== 'number' || isNaN(d.width) || d.width <= 0) {
    throw new Error('Worker request width must be a positive number');
  }
  if (typeof d.height !== 'number' || isNaN(d.height) || d.height <= 0) {
    throw new Error('Worker request height must be a positive number');
  }
  if (d.configId !== undefined && d.configId !== null && typeof d.configId !== 'string') {
    throw new Error('Worker request configId must be a string');
  }
  if (d.moduleCount !== undefined && d.moduleCount !== null && (typeof d.moduleCount !== 'number' || isNaN(d.moduleCount) || d.moduleCount <= 0)) {
    throw new Error('Worker request moduleCount must be a positive number');
  }
}

/**
 * Type-guard function for validating the Worker Response structure.
 */
export function isWorkerResponse(data: unknown): data is {
  dropped: true;
  configId: string;
} | {
  retryWithImageData: true;
  configId: string;
  imageBitmap?: ImageBitmap;
} | {
  success: boolean;
  physicalReady: boolean;
  dropped?: false;
  error?: string | null;
  configId?: string | null;
  localContrastViolations?: number;
  minLocalContrast?: number;
  sequenceId?: number;
  buffer?: ArrayBuffer;
} {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.dropped === true) {
    return typeof d.configId === 'string';
  }
  if (d.retryWithImageData === true) {
    return typeof d.configId === 'string' && (d.imageBitmap === undefined || (typeof d.imageBitmap === 'object' && d.imageBitmap !== null));
  }
  if (typeof d.success !== 'boolean') return false;
  if (typeof d.physicalReady !== 'boolean') return false;
  if (d.error !== undefined && d.error !== null && typeof d.error !== 'string') return false;
  if (d.configId !== undefined && d.configId !== null && typeof d.configId !== 'string') return false;
  if (d.localContrastViolations !== undefined && d.localContrastViolations !== null && (typeof d.localContrastViolations !== 'number' || isNaN(d.localContrastViolations))) return false;
  if (d.minLocalContrast !== undefined && d.minLocalContrast !== null && (typeof d.minLocalContrast !== 'number' || isNaN(d.minLocalContrast))) return false;
  if (d.sequenceId !== undefined && typeof d.sequenceId !== 'number') return false;
  if (d.buffer !== undefined && d.buffer !== null && !(d.buffer instanceof ArrayBuffer)) return false;
  return true;
}

export type WorkerResponse = GuardedType<typeof isWorkerResponse>;

/**
 * Assertion function for Worker Response.
 */
export function assertWorkerResponse(data: unknown): asserts data is WorkerResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Worker response must be a non-null object');
  }
  const d = data as Record<string, unknown>;
  if (d.dropped === true) {
    if (typeof d.configId !== 'string') {
      throw new Error('Dropped worker response configId must be a string');
    }
    return;
  }
  if (d.retryWithImageData === true) {
    if (typeof d.configId !== 'string') {
      throw new Error('Image-data retry response configId must be a string');
    }
    return;
  }
  if (typeof d.success !== 'boolean') {
    throw new Error('Worker response success must be a boolean');
  }
  if (typeof d.physicalReady !== 'boolean') {
    throw new Error('Worker response physicalReady must be a boolean');
  }
  if (d.error !== undefined && d.error !== null && typeof d.error !== 'string') {
    throw new Error('Worker response error must be a string');
  }
  if (d.configId !== undefined && d.configId !== null && typeof d.configId !== 'string') {
    throw new Error('Worker response configId must be a string');
  }
  if (d.localContrastViolations !== undefined && d.localContrastViolations !== null && (typeof d.localContrastViolations !== 'number' || isNaN(d.localContrastViolations))) {
    throw new Error('Worker response localContrastViolations must be a number');
  }
  if (d.minLocalContrast !== undefined && d.minLocalContrast !== null && (typeof d.minLocalContrast !== 'number' || isNaN(d.minLocalContrast))) {
    throw new Error('Worker response minLocalContrast must be a number');
  }
  if (d.sequenceId !== undefined && typeof d.sequenceId !== 'number') {
    throw new Error('Worker response sequenceId must be a number');
  }
  if (d.buffer !== undefined && d.buffer !== null && !(d.buffer instanceof ArrayBuffer)) {
    throw new Error('Worker response buffer must be an ArrayBuffer');
  }
}

