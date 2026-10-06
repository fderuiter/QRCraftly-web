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

import { assertWorkerRequest, isWorkerResponse } from '@/packages/scannability';
import { DoubleBufferPool } from '@/packages/optical-scanner/scheduler';
import { isDangerousUrl } from '@/utils/security';

/** Side of the square frame handed to the scanners. */
export const SCAN_FRAME_SIZE = 256;

/** A worker is considered stalled after this long without a reply. */
export const SCAN_WATCHDOG_MS = 1500;

/** Minimal `BarcodeDetector` surface. */
export interface DetectorLike {
  /** Decodes barcodes in an image. */
  detect: (source: ImageData) => Promise<ReadonlyArray<{ rawValue: string }>>;
}

/** Minimal `Worker` surface. */
export interface WorkerLike {
  /** Posts a message with transferables. */
  postMessage: (message: unknown, transfer: Transferable[]) => void;
  /** Adds a message listener. */
  addEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void;
  /** Removes a message listener. */
  removeEventListener: (type: 'message', listener: (event: MessageEvent<unknown>) => void) => void;
  /** Stops the worker. */
  terminate: () => void;
}

/** Layer 2 (empirical) verdict. */
export type EmpiricalStatus = 'scannable' | 'corrupted' | 'unavailable';

/** Result of one empirical scan. */
export interface ScanOutcome {
  /** Verdict. */
  status: EmpiricalStatus;
  /** Decoded payload when scannable. */
  decoded: string | null;
  /** Which decoder produced the verdict. */
  engine: 'native' | 'worker' | 'none';
}

/** Dependencies of {@link EmpiricalScanPipeline}; all injectable so it runs headless. */
export interface EmpiricalScanOptions {
  /** Renders the current board into a {@link SCAN_FRAME_SIZE}² frame. */
  captureFrame: () => ImageData | null;
  /** Payload the board encodes (shown when the worker, which returns no text, succeeds). */
  expectedPayload: () => string;
  /** Whether the player is still firing; catch-up scans wait until input stops. */
  isInputActive: () => boolean;
  /** Receives each fresh verdict. Stale verdicts are never reported. */
  onResult: (outcome: ScanOutcome) => void;
  /** Native `BarcodeDetector`, tried first when present. */
  detector?: DetectorLike | null;
  /** Spawns the fallback Scannability Worker (lazily, on first use). */
  createWorker?: () => WorkerLike | null;
}

/**
 * Layer 2 of the dual-layer verification engine. Each request captures the damaged board,
 * then decodes it with the native `BarcodeDetector` when available, falling back to the
 * off-thread Scannability Worker with zero-copy `ArrayBuffer` transfer and a double-buffered
 * pool that recycles the returned buffers.
 *
 * Only one scan is in flight. Requests made while busy are coalesced into a single
 * "blocked" flag; when the in-flight scan finishes and input has stopped, one catch-up scan
 * runs so the verdict always reflects the final board. Replies for superseded scans are
 * discarded by sequence token, and a watchdog frees a stalled worker.
 */
export class EmpiricalScanPipeline {
  private readonly options: EmpiricalScanOptions;
  private readonly pool = new DoubleBufferPool(SCAN_FRAME_SIZE, SCAN_FRAME_SIZE);
  private worker: WorkerLike | null = null;
  private workerUnavailable = false;
  private busy = false;
  private blocked = false;
  private sequence = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  /**
   * Creates a pipeline.
   * @param options - Injected capture, decoders and callbacks.
   */
  constructor(options: EmpiricalScanOptions) {
    this.options = options;
  }

  /** @returns Whether a scan is in flight. */
  get isBusy(): boolean {
    return this.busy;
  }

  /** @returns Whether a request arrived while busy and still needs a catch-up scan. */
  get hasPendingCatchUp(): boolean {
    return this.blocked;
  }

  /** Requests a scan of the current board (coalesced while one is in flight). */
  request(): void {
    if (this.disposed) return;
    if (this.busy) {
      this.blocked = true;
      return;
    }
    void this.run();
  }

  /** Runs the pending catch-up scan once input has stopped. */
  settle(): void {
    if (!this.disposed && this.blocked && !this.busy && !this.options.isInputActive()) void this.run();
  }

  /** Stops the worker and ignores any late replies. */
  dispose(): void {
    this.disposed = true;
    this.clearWatchdog();
    if (this.worker) {
      this.worker.removeEventListener('message', this.handleMessage);
      this.worker.terminate();
      this.worker = null;
    }
    this.pool.clear();
  }

  private async run(): Promise<void> {
    this.busy = true;
    this.blocked = false;
    const token = ++this.sequence;
    const frame = this.options.captureFrame();
    if (!frame) {
      this.busy = false;
      return;
    }

    if (this.options.detector) {
      try {
        const codes = await this.options.detector.detect(frame);
        const decoded = codes[0]?.rawValue ?? '';
        const ok = decoded.length > 0 && !isDangerousUrl(decoded);
        this.finish(token, { status: ok ? 'scannable' : 'corrupted', decoded: ok ? decoded : null, engine: 'native' });
        return;
      } catch (err) {
        console.warn('Native BarcodeDetector failed, using the Scannability Worker:', err);
      }
    }

    const worker = this.getWorker();
    if (!worker) {
      this.finish(token, { status: 'unavailable', decoded: null, engine: 'none' });
      return;
    }

    let buffer = this.pool.acquire();
    if (buffer.byteLength !== frame.data.length) buffer = new ArrayBuffer(frame.data.length);
    const data = new Uint8ClampedArray(buffer);
    data.set(frame.data);
    const request = {
      imageData: { data, width: frame.width, height: frame.height },
      buffer,
      width: frame.width,
      height: frame.height,
      configId: String(token),
    };
    assertWorkerRequest(request);
    this.startWatchdog(token);
    worker.postMessage(request, [buffer]);
  }

  private getWorker(): WorkerLike | null {
    if (this.worker || this.workerUnavailable) return this.worker;
    const worker = this.options.createWorker?.() ?? null;
    if (!worker) {
      this.workerUnavailable = true;
      return null;
    }
    worker.addEventListener('message', this.handleMessage);
    this.worker = worker;
    return worker;
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    const response = event.data;
    if (!isWorkerResponse(response)) return;
    if ('buffer' in response && response.buffer instanceof ArrayBuffer) this.pool.release(response.buffer);
    if (response.configId !== String(this.sequence)) {
      // A superseded scan answered late: its verdict describes an old board.
      return;
    }
    if ('dropped' in response || 'retryWithImageData' in response) {
      this.clearWatchdog();
      this.busy = false;
      this.blocked = true;
      this.settle();
      return;
    }
    this.finish(this.sequence, {
      status: response.success ? 'scannable' : 'corrupted',
      decoded: response.success ? this.options.expectedPayload() : null,
      engine: 'worker',
    });
  };

  private finish(token: number, outcome: ScanOutcome): void {
    if (this.disposed || token !== this.sequence) return;
    this.clearWatchdog();
    this.busy = false;
    this.options.onResult(outcome);
    this.settle();
  }

  private startWatchdog(token: number): void {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => {
      this.watchdog = null;
      if (token !== this.sequence || !this.busy) return;
      // Stalled worker: release the lock and schedule a fresh scan.
      this.busy = false;
      this.blocked = true;
      this.settle();
    }, SCAN_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }
}

/** A 2D context subset the frame painter needs. */
export interface FramePainter {
  /** Fill colour. */
  fillStyle: string | CanvasGradient | CanvasPattern;
  /** Fills a rectangle. */
  fillRect: (x: number, y: number, w: number, h: number) => void;
}

/**
 * Paints a binary board into a square scan frame with a quiet zone. Only module state is
 * painted (no particles, reticle or shake), so the verdict reflects damage, not effects.
 * @param ctx - Target context, sized `px`².
 * @param px - Frame side in pixels.
 * @param cells - Cells along one side of the board.
 * @param quietCells - Quiet-zone width in cells.
 * @param isDark - Whether a cell is dark.
 * @param colors - Foreground and background colours.
 * @param colors.fg - Dark cell colour.
 * @param colors.bg - Light cell and quiet zone colour.
 */
export function paintScanFrame(
  ctx: FramePainter,
  px: number,
  cells: number,
  quietCells: number,
  isDark: (row: number, col: number) => boolean,
  colors: { fg: string; bg: string }
): void {
  const cell = px / (cells + quietCells * 2);
  const offset = quietCells * cell;
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = colors.fg;
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      if (isDark(row, col)) ctx.fillRect(offset + col * cell, offset + row * cell, cell + 0.5, cell + 0.5);
    }
  }
}
