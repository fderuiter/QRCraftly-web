import { loadQrReader } from '@/packages/qr-decode';
import { cameraStrategyFor, decodeCameraCode, decodeRgbaCode } from './decodeSync';
import {
  isValidScannerRequest,
  assertScannerResponse,
  cornersToArray,
  mapCorners,
  type DecodedCode,
  type ScanDecoder,
  type ScannerResponse,
  type ScanRegion,
} from './contracts';
import { decodeImageAtSizes, FILE_SCAN_MESSAGE, FILE_SCAN_UNREADABLE, FILE_SCAN_UNSUPPORTED } from './imageFile';
import { exceedsPixelLimit, IMAGE_TOO_LARGE_PIXELS_MESSAGE } from './imageLimits';
import { createStaleFrameGuard } from './frameGuard';

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Camera frame staleness, judged per scan session (epoch), not across sessions (#1095). */
const frameGuard = createStaleFrameGuard();
let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

/** The dedicated worker scope's `postMessage`, which accepts a transfer list. */
interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

/**
 * `self` as the dedicated worker scope. The app compiles against the DOM lib (not the WebWorker
 * lib), which types `self` as `Window`, whose `postMessage` has no transfer-list overload.
 * `self` is read on every call rather than captured once at module load, so the scope that is
 * current when a message is posted is the one that receives it.
 */
const workerScope: WorkerScope = {
  postMessage(message, transfer) {
    const scope = self as unknown as WorkerScope;
    if (transfer) {
      scope.postMessage(message, transfer);
    } else {
      scope.postMessage(message);
    }
  },
};

/** The fields a decoded code adds to a response. */
function codeFields(code: DecodedCode | null, decoder: ScanDecoder): Partial<ScannerResponse> {
  if (!code) return { decodedData: null };
  return { decodedData: code.text, decodedBytes: code.bytes, corners: cornersToArray(code.corners), decoder };
}

/** Maps a code found in a cut-out (and possibly resized) frame back to the camera frame. */
function toCameraFrame(code: DecodedCode | null, width: number, height: number, region?: ScanRegion): DecodedCode | null {
  if (!code || !region) return code;
  return { ...code, corners: mapCorners(code.corners, region.width / width, region.height / height, region.x, region.y) };
}

/**
 * Every message shape this worker accepts (image file scan, raw buffer / ImageData scan, camera
 * ImageBitmap scan). Fields are optional and checked before use.
 */
interface ScannerWorkerMessage {
  type?: string;
  file?: unknown;
  region?: ScanRegion;
  epochId?: number;
  buffer?: unknown;
  imageData?: { data: Uint8ClampedArray | ArrayLike<number> };
  width?: unknown;
  height?: unknown;
  sequenceId?: number;
  image?: unknown;
}

/**
 * Decodes an uploaded image file here, off the main thread: the browser decodes it (applying its
 * EXIF orientation) into an ImageBitmap, which is drawn at each of the file scan sizes (#1098).
 */
async function scanImageFile(file: unknown, sequenceId: number): Promise<void> {
  let response: ScannerResponse;
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined' || !(file instanceof Blob)) {
    response = { status: 'fail', sequenceId, error: FILE_SCAN_UNSUPPORTED };
  } else {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      // A format whose header did not give its size is checked once decoded (#1299).
      if (exceedsPixelLimit(bitmap.width, bitmap.height)) throw new Error(IMAGE_TOO_LARGE_PIXELS_MESSAGE);
      const reader = await loadQrReader();
      const code = await decodeImageAtSizes(
        bitmap,
        bitmap.width,
        bitmap.height,
        (width, height) => new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true }),
        (data, width, height) => decodeRgbaCode(reader, data, width, height)
      );
      response = { status: code ? 'pass' : 'fail', sequenceId, ...codeFields(code, 'qr-decode') };
    } catch (err) {
      const tooLarge = err instanceof Error && err.message === IMAGE_TOO_LARGE_PIXELS_MESSAGE;
      response = { status: 'fail', sequenceId, error: tooLarge ? IMAGE_TOO_LARGE_PIXELS_MESSAGE : FILE_SCAN_UNREADABLE };
    } finally {
      bitmap?.close();
    }
  }
  assertScannerResponse(response);
  workerScope.postMessage(response);
}

self.onmessage = async (e: MessageEvent<ScannerWorkerMessage | null>) => {
  const payload = e.data;
  if (!payload) return;
  const epochId = payload.epochId;

  // 1. Uploaded image file
  if (payload.type === FILE_SCAN_MESSAGE && typeof payload.sequenceId === 'number') {
    await scanImageFile(payload.file, payload.sequenceId);
    return;
  }

  // 2. Raw RGBA pixels (a buffer or ImageData) decoded with the multi-pass decoder
  const { width: requestWidth, height: requestHeight, imageData } = payload;
  const requestBuffer = payload.buffer instanceof ArrayBuffer ? payload.buffer : null;

  if (typeof requestWidth === 'number' && typeof requestHeight === 'number' && (requestBuffer || imageData)) {
    const sequenceId = payload.sequenceId;
    let data: Uint8ClampedArray;

    if (requestBuffer) {
      data = new Uint8ClampedArray(requestBuffer);
    } else if (imageData) {
      data = imageData.data instanceof Uint8ClampedArray ? imageData.data : new Uint8ClampedArray(imageData.data);
    } else {
      return;
    }

    let code: DecodedCode | null = null;
    try {
      code = decodeRgbaCode(await loadQrReader(), data, requestWidth, requestHeight);
    } catch {
      // Our reader (#1178) did not load: answer with a miss so the buffer goes back to the pool.
    }

    const response = {
      status: code ? ('pass' as const) : ('fail' as const),
      sequenceId,
      ...codeFields(code, 'qr-decode'),
      buffer: requestBuffer ?? undefined,
      epochId,
    };
    assertScannerResponse(response);
    if (requestBuffer) {
      workerScope.postMessage(response, [requestBuffer]);
    } else {
      workerScope.postMessage(response);
    }
    return;
  }

  // 3. Camera scanning mode (ImageBitmap)
  if (!isValidScannerRequest(payload)) {
    if (payload.image instanceof ImageBitmap) {
      try {
        payload.image.close();
      } catch (err) {
        console.error('Failed to close image in validation fail:', err);
      }
    }
    const response = {
      status: 'fail' as const,
      sequenceId: (payload && typeof payload.sequenceId === 'number') ? payload.sequenceId : -1,
      error: 'INVALID_REQUEST_PAYLOAD',
      epochId,
    };
    try {
      assertScannerResponse(response);
    } catch (validationErr) {
      console.error('Validation error on emergency payload:', validationErr);
    }
    workerScope.postMessage(response);
    return;
  }

  const { image, width, height, sequenceId, region } = payload;

  if (!frameGuard.admit(epochId, sequenceId)) {
    try {
      image.close();
    } catch (err) {
      console.error('Failed to close stale image:', err);
    }
    const response = {
      status: 'fail' as const,
      sequenceId,
      error: 'STALE_FRAME',
      epochId,
    };
    assertScannerResponse(response);
    workerScope.postMessage(response);
    return;
  }

  await yieldToEventLoop();

  if (!frameGuard.isCurrent(epochId, sequenceId)) {
    try {
      image.close();
    } catch (err) {
      console.error('Failed to close stale image after yield:', err);
    }
    const response = {
      status: 'fail' as const,
      sequenceId,
      error: 'STALE_FRAME',
      epochId,
    };
    assertScannerResponse(response);
    workerScope.postMessage(response);
    return;
  }

  try {
    if (!offscreenCanvas) {
      offscreenCanvas = new OffscreenCanvas(width, height);
      offscreenCtx = offscreenCanvas.getContext('2d');
    } else if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
      offscreenCanvas.width = width;
      offscreenCanvas.height = height;
      offscreenCtx = offscreenCanvas.getContext('2d');
    }

    if (!offscreenCtx) {
      throw new Error('OFFSCREEN_CONTEXT_UNAVAILABLE');
    }

    offscreenCtx.drawImage(image, 0, 0, width, height);
    const imageData = offscreenCtx.getImageData(0, 0, width, height);

    try {
      image.close();
    } catch (err) {
      console.error('Failed to close image after drawing:', err);
    }

    // One bounded pass of our reader per frame, consecutive frames rotating strategies (#1096).
    // The engine already cut the frame to match.
    const reader = await loadQrReader();
    const found = decodeCameraCode(reader, imageData.data, width, height, cameraStrategyFor(sequenceId));
    const code = toCameraFrame(found, width, height, region);

    const response = {
      status: code ? ('pass' as const) : ('fail' as const),
      sequenceId,
      ...codeFields(code, 'qr-decode'),
      epochId,
    };
    assertScannerResponse(response);
    workerScope.postMessage(response);
  } catch (error) {
    try {
      image.close();
    } catch {
      // Ignored
    }
    const response = {
      status: 'fail' as const,
      sequenceId,
      error: (error instanceof Error && error.message) || 'DECODE_ERROR',
      epochId,
    };
    assertScannerResponse(response);
    workerScope.postMessage(response);
  }
};

