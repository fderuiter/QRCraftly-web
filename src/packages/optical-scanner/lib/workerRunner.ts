import {
  isValidScannerResponse,
  ZXING_MODULE_MESSAGE,
  type DecodedCode,
  type ScanDecoder,
  type ScannerRequest,
  cornersFromArray,
} from './contracts';
import { compileZxingModule } from './zxingModule';

let sharedWorker: Worker | null = null;
let consecutiveRestarts = 0;
const MAX_CONSECUTIVE_RESTARTS = 3;
/** Settles once the current worker has been offered the zxing reader (or it could not be). */
let readerOffered: Promise<void> = Promise.resolve();

/**
 * Offers the compiled zxing reader to a new worker (ADR 0023). The worker scans with our reader (#1178) until
 * the module arrives, and keeps doing so if it never does.
 */
function offerZxingReader(worker: Worker): Promise<void> {
  return compileZxingModule().then(
    (module) => {
      if (module && sharedWorker === worker) {
        worker.postMessage({ type: ZXING_MODULE_MESSAGE, module });
      }
    },
    () => undefined
  );
}

/**
 * Retrieves or lazily instantiates the shared background Web Worker for optical scanning. Only
 * scans the platform's own detector cannot handle reach it, so creating it is also when the zxing
 * reader is loaded.
 */
export function getScannerWorker(): Worker {
  if (typeof window === 'undefined') {
    throw new Error('Web Worker can only be instantiated in browser environment');
  }
  if (!sharedWorker) {
    const worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    sharedWorker = worker;
    readerOffered = offerZxingReader(worker);
  }
  return sharedWorker;
}

/** Resolves once the shared worker has been offered the zxing reader (never rejects). */
export function whenReaderOffered(): Promise<void> {
  return readerOffered;
}

function disposeSharedWorker(): void {
  if (sharedWorker) {
    try {
      sharedWorker.terminate();
    } catch (err) {
      console.error('Failed to terminate shared scanner worker:', err);
    }
    sharedWorker = null;
  }
}

/**
 * Terminates the shared scanner worker, releasing its memory, and clears the crash counter.
 * The next scan lazily provisions a fresh worker.
 */
export function terminateScannerWorker(): void {
  disposeSharedWorker();
  consecutiveRestarts = 0;
}

/**
 * Terminates the current worker and provisions a fresh worker instance.
 * Returns null if the maximum consecutive restart limit has been reached.
 */
function recreateScannerWorker(): Worker | null {
  consecutiveRestarts += 1;
  disposeSharedWorker();

  if (consecutiveRestarts > MAX_CONSECUTIVE_RESTARTS) {
    console.error(
      `Optical scanner worker exceeded max consecutive restarts (${consecutiveRestarts} > ${MAX_CONSECUTIVE_RESTARTS}). Halting auto-restart.`
    );
    return null;
  }

  console.warn(
    `Watchdog: Recreating optical scanner worker (Attempt ${consecutiveRestarts} of ${MAX_CONSECUTIVE_RESTARTS}).`
  );

  try {
    return getScannerWorker();
  } catch (err) {
    console.error('Failed to provision new scanner worker:', err);
    return null;
  }
}

/**
 * Resets the consecutive crash counter upon a confirmed healthy worker decode cycle.
 */
function markWorkerHealthy(): void {
  consecutiveRestarts = 0;
}

export interface DispatchWorkerRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Awaited after the worker is created and before the request is posted (never delays the timeout). */
  before?: () => Promise<void>;
}

export interface DispatchWorkerRequestResult {
  decoded: string | null;
  error?: string | null;
  /** The full decoded code, when one was found. */
  code?: DecodedCode | null;
  /** The decoder that read it. */
  decoder?: ScanDecoder;
}

/**
 * Posts one request to the shared worker and resolves with its answer (matched by `sequenceId`),
 * with a bounded watchdog timeout, worker recreation after a hang or crash, and clean listener
 * detachment. It never rejects: failures resolve with an `error` code.
 */
export function dispatchWorkerRequest(
  message: { sequenceId: number },
  transfer: Transferable[],
  options: DispatchWorkerRequestOptions = {}
): Promise<DispatchWorkerRequestResult> {
  const { timeoutMs = 1500, signal, before } = options;
  const { sequenceId } = message;

  return new Promise((resolve) => {
    let worker: Worker | null = null;
    try {
      worker = getScannerWorker();
    } catch {
      worker = null;
    }

    if (!worker || signal?.aborted) {
      resolve({ decoded: null, error: signal?.aborted ? 'ABORTED' : 'WORKER_UNAVAILABLE' });
      return;
    }

    let isDone = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: DispatchWorkerRequestResult) => {
      if (isDone) return;
      isDone = true;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      signal?.removeEventListener('abort', onAbort);
      try {
        worker?.removeEventListener('message', handleMessage);
        worker?.removeEventListener('error', handleError);
      } catch {
        // Ignore listener removal errors
      }
      resolve(result);
    };

    const handleMessage = (e: MessageEvent) => {
      const payload = e.data;
      if (!isValidScannerResponse(payload) || payload.sequenceId !== sequenceId) return;
      markWorkerHealthy();
      const decoded = (payload.status === 'pass' ? payload.decodedData : null) ?? null;
      finish({
        decoded,
        error: payload.error ?? null,
        code:
          decoded === null
            ? null
            : { text: decoded, bytes: payload.decodedBytes ?? null, corners: cornersFromArray(payload.corners) },
        decoder: payload.decoder,
      });
    };

    const handleError = (err: unknown) => {
      if (isDone) return;
      console.warn('Worker error during scan request:', err);
      finish({ decoded: null, error: 'WORKER_ERROR' });
      recreateScannerWorker();
    };

    const onAbort = () => finish({ decoded: null, error: 'ABORTED' });

    // Watchdog timeout to prevent unbounded hang
    timerId = setTimeout(() => {
      if (isDone) return;
      console.warn(`Watchdog: Off-thread scan request ${sequenceId} timed out after ${timeoutMs}ms.`);
      finish({ decoded: null, error: 'WATCHDOG_TIMEOUT' });
      recreateScannerWorker();
    }, timeoutMs);

    signal?.addEventListener('abort', onAbort);

    const target = worker;
    const post = () => {
      if (isDone) return;
      try {
        target.addEventListener('message', handleMessage);
        target.addEventListener('error', handleError);
        target.postMessage(message, transfer);
      } catch (postErr) {
        console.error('Failed to postMessage to scanner worker:', postErr);
        finish({ decoded: null, error: 'DISPATCH_ERROR' });
      }
    };
    if (before) {
      before().then(post, post);
    } else {
      post();
    }
  });
}

/**
 * Callbacks the Camera Scanner Engine registers on the worker it drives.
 */
export interface ScannerWorkerHandlers {
  onMessage: (data: unknown) => void;
  onError: (reason: unknown) => void;
}

/**
 * The engine's private view of a scanner worker: post a camera frame, detach, or kill it.
 */
export interface ScannerWorkerHandle {
  /** Posts a camera frame request, transferring ownership of the listed objects. */
  postFrame: (request: ScannerRequest, transfer: Transferable[]) => void;
  /** Detaches the engine's listeners but leaves the worker running for other callers. */
  release: () => void;
  /** Detaches listeners and terminates the worker (used by watchdog recovery). */
  terminate: () => void;
}

/**
 * Creates a worker handle wired to the given handlers. Throws when no worker can be spawned
 * (for example under a strict CSP), which makes the engine fall back to main-thread decoding.
 */
export type ScannerWorkerFactory = (handlers: ScannerWorkerHandlers) => ScannerWorkerHandle;

/**
 * Default engine worker factory: attaches to the package's shared scanner worker so camera scanning
 * and file scanning reuse a single background thread.
 */
export const connectSharedScannerWorker: ScannerWorkerFactory = (handlers) => {
  const worker = getScannerWorker();
  const onMessage = (event: MessageEvent) => handlers.onMessage(event.data);
  const onError = (event: Event) => handlers.onError(event);
  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onError);

  let attached = true;
  const release = () => {
    if (!attached) return;
    attached = false;
    try {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
    } catch (err) {
      console.error('Failed to detach scanner worker listeners:', err);
    }
  };

  return {
    postFrame: (request, transfer) => worker.postMessage(request, transfer),
    release,
    terminate: () => {
      release();
      if (sharedWorker === worker) {
        disposeSharedWorker();
      } else {
        worker.terminate();
      }
    },
  };
};
