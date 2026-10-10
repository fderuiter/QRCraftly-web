import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadWorkerModule, type InThreadWorkerScope, type WorkerModuleUnderTest } from './utils/inThreadWorker';
import { fakeQrRead } from './utils/fakeQrRead';
import { getLuminanceFromRgb } from '@/utils/colorUtils';

const qrRead = vi.hoisted(() => vi.fn());
vi.mock('@/packages/qr-decode', () => ({ loadQrReader: () => Promise.resolve({ read: qrRead }) }));

// Spy on the luminance helper the contrast audit uses, so a test can make processing crash.
vi.mock('@/utils/colorUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/colorUtils')>();
  return { ...actual, getLuminanceFromRgb: vi.fn(actual.getLuminanceFromRgb) };
});

/** Gives the worker a minimal OffscreenCanvas (Node has none) so bitmap extraction succeeds. */
function stubOffscreenCanvas() {
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return {
          clearRect: () => {},
          drawImage: () => {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
            width: w,
            height: h,
          }),
        };
      }
    },
  );
}

describe('scannabilityWorker', () => {
  let workerHandler: WorkerModuleUnderTest['handle'];
  let worker: WorkerModuleUnderTest;
  let scope: InThreadWorkerScope;
  let originalPostMessage: any;
  let originalImageData: any;

  beforeAll(async () => {
    originalImageData = globalThis.ImageData;
    class MockImageData {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    }
    globalThis.ImageData = MockImageData as any;

    worker = await loadWorkerModule(new URL('../src/packages/scannability/worker.ts', import.meta.url));
    scope = worker.scope;
    workerHandler = worker.handle;
  });

  beforeEach(() => {
    originalPostMessage = scope.postMessage;
    vi.clearAllMocks();
  });

  afterEach(() => {
    scope.postMessage = originalPostMessage;
  });

  const createDummyRequest = (configId = '123', moduleCount?: number) => {
    return {
      imageData: {
        data: new Uint8ClampedArray(400),
        width: 10,
        height: 10,
      },
      width: 10,
      height: 10,
      configId,
      moduleCount,
    };
  };

  it('sets self.onmessage and processes safe digital pass and physical pass request', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    // Control mocks
    qrRead.mockReturnValueOnce([fakeQrRead('https://safe.com')]) // digital
                  .mockReturnValueOnce([fakeQrRead('https://safe.com')]); // physical

    expect(workerHandler).toBeDefined();

    // Trigger handler
    await workerHandler({ data: createDummyRequest() } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith({
      success: true,
      physicalReady: true,
      localContrastViolations: 0,
      minLocalContrast: 21,
      configId: '123',
    });
  });

  it('handles safe digital pass but physical scan failure', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    qrRead.mockReturnValueOnce([fakeQrRead('https://safe.com')]) // digital
                  .mockReturnValueOnce([]); // physical fails (dontInvert)
    qrRead.mockReturnValueOnce([]); // physical fails (onlyInvert)

    await workerHandler({ data: createDummyRequest() } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith({
      success: true,
      physicalReady: false,
      localContrastViolations: 0,
      minLocalContrast: 21,
      configId: '123',
    });
  });

  it('handles dangerous URLs via ValidationEngine as security violation', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    qrRead.mockReturnValueOnce([fakeQrRead('javascript:alert(1)')]);

    await workerHandler({ data: createDummyRequest() } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      physicalReady: false,
      error: 'SECURITY_VIOLATION',
      configId: '123',
    }));
  });

  it('handles case where first digital scan fails but second (onlyInvert) passes', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    qrRead.mockReturnValueOnce([]) // digital 1 fails
                  .mockReturnValueOnce([fakeQrRead('https://safe.com')]) // digital 2 passes
                  .mockReturnValueOnce([fakeQrRead('https://safe.com')]); // physical passes

    await workerHandler({ data: createDummyRequest() } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      physicalReady: true,
      configId: '123',
    }));
  });

  it('handles case where both digital scans fail', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    qrRead.mockReturnValueOnce([]) // digital 1 fails
                  .mockReturnValueOnce([]); // digital 2 fails

    await workerHandler({ data: createDummyRequest() } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      physicalReady: false,
      error: 'NOT_FOUND',
      configId: '123',
    }));
  });

  it('reads the simulated print of the found code, as the camera scanner reads (#1248)', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    qrRead.mockReturnValueOnce([fakeQrRead('https://safe.com')]) // digital
                  .mockReturnValueOnce([fakeQrRead('https://safe.com')]); // physical

    await workerHandler({ data: createDummyRequest('123') } as MessageEvent);

    // A version 1 code is 21 modules plus a 4-module quiet zone each side, 6 pixels a module, in grey.
    const side = (21 + 8) * 6;
    const [printed, width, height, options] = qrRead.mock.calls[1];
    expect(printed).toHaveLength(side * side);
    expect([width, height]).toEqual([side, side]);
    expect(options).toEqual({ inverted: true, global: true, half: true });
    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      physicalReady: true,
      configId: '123',
    }));
  });

  it('does not count a different text in the simulated print as a pass', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    qrRead.mockReturnValueOnce([fakeQrRead('https://safe.com')]) // digital
                  .mockReturnValueOnce([fakeQrRead('https://safe.co')]); // physical misread

    await workerHandler({ data: createDummyRequest('123') } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      physicalReady: false,
      configId: '123',
    }));
  });

  it('catches validation error if the payload is invalid', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    // Send invalid payload to trigger isWorkerRequest/assertWorkerRequest validation error
    await workerHandler({ data: { invalidPayload: true } } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith({
      success: false,
      physicalReady: false,
      error: 'VALIDATION_ERROR',
      configId: undefined,
    });
  });

  it('treats a decoder exception as "no code found", like the main-thread check', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    qrRead.mockImplementation(() => {
      throw new Error('Simulation crash');
    });

    await workerHandler({ data: createDummyRequest() } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      physicalReady: false,
      error: 'NOT_FOUND',
      configId: '123',
    }));
    qrRead.mockReset();
  });

  it('catches crash error if global processing fails internally', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    vi.mocked(getLuminanceFromRgb).mockImplementationOnce(() => {
      throw new Error('Contrast audit crash');
    });

    await workerHandler({ data: createDummyRequest('123', 5) } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith({
      success: false,
      physicalReady: false,
      error: 'CRASH',
      configId: '123',
    });
  });

  it('handles postMessage crash fallback when postMessage throws', async () => {
    // Make postMessage throw first time to trigger catch fallback
    scope.postMessage = vi.fn().mockImplementationOnce(() => {
      throw new Error('postMessage crash');
    });

    await workerHandler({ data: { invalidPayload: true } } as MessageEvent);

    // Should fall back to posting basic crash payload
    expect(scope.postMessage).toHaveBeenCalledTimes(2);
  });

  it('handles falsy e.data or non-object e.data gracefully', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    // Send null data
    await workerHandler({ data: null } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith({
      success: false,
      physicalReady: false,
      error: 'VALIDATION_ERROR',
      configId: undefined,
    });
  });

  it('reports a screen-only pass when the simulated print does not read', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    qrRead.mockReturnValueOnce([fakeQrRead('https://safe.com')]) // digital passes
                  .mockReturnValueOnce([]); // the simulated print does not read

    await workerHandler({ data: createDummyRequest() } as MessageEvent);

    expect(qrRead).toHaveBeenCalledTimes(2);
    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      physicalReady: false,
      configId: '123',
    }));
  });

  it('cooperatively cancels older execution sequence when a newer configId is dispatched', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    // Mock responses
    qrRead.mockReturnValue([fakeQrRead('https://safe.com')]);

    // Dispatch two requests: '101' and then '102'
    const firstPromise = workerHandler({ data: createDummyRequest('101') } as MessageEvent);
    const secondPromise = workerHandler({ data: createDummyRequest('102') } as MessageEvent);

    await Promise.all([firstPromise, secondPromise]);

    // The stale request must acknowledge cancellation so the caller can release
    // its busy state, while the latest request still returns its result.
    expect(postMessageSpy).toHaveBeenCalledTimes(2);
    expect(postMessageSpy).toHaveBeenCalledWith({
      configId: '101',
      dropped: true,
    });
    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      physicalReady: true,
      configId: '102',
    }));
  });

  it('releases transferred image handle immediately upon detecting cooperative cancellation', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;
    qrRead.mockReturnValue([fakeQrRead('https://safe.com')]);
    // Extraction must succeed, or the worker hands the second bitmap back instead of closing it.
    stubOffscreenCanvas();

    const closeSpy1 = vi.fn();
    const closeSpy2 = vi.fn();

    const req1 = {
      imageBitmap: { width: 10, height: 10, close: closeSpy1 },
      width: 10,
      height: 10,
      configId: '201',
    };

    const req2 = {
      imageBitmap: { width: 10, height: 10, close: closeSpy2 },
      width: 10,
      height: 10,
      configId: '202',
    };

    const p1 = workerHandler({ data: req1 } as MessageEvent);
    const p2 = workerHandler({ data: req2 } as MessageEvent);

    await Promise.all([p1, p2]);

    expect(closeSpy1).toHaveBeenCalledTimes(1);
    expect(closeSpy2).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('releases transferred image handle when context extraction or processing throws an exception', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;
    // Node has no OffscreenCanvas; give the worker a minimal one so extraction succeeds and processing throws.
    stubOffscreenCanvas();

    const closeSpy = vi.fn();
    const req = {
      imageBitmap: { width: 10, height: 10, close: closeSpy },
      width: 10,
      height: 10,
      configId: '301',
      moduleCount: 5,
    };

    vi.mocked(getLuminanceFromRgb).mockImplementationOnce(() => {
      throw new Error('Processing failure');
    });

    try {
      await workerHandler({ data: req } as MessageEvent);
    } finally {
      vi.unstubAllGlobals();
    }

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: 'CRASH',
        configId: '301',
      })
    );
  });

  it('requests image data when worker canvas extraction is unavailable', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    delete (globalThis as { OffscreenCanvas?: typeof OffscreenCanvas }).OffscreenCanvas;

    const closeSpy = vi.fn();
    const bitmap = { width: 10, height: 10, close: closeSpy };
    await workerHandler({
      data: {
        imageBitmap: bitmap,
        width: 10,
        height: 10,
        configId: 'needs-image-data',
        },
    } as MessageEvent);

    // The bitmap goes back to the main thread (transferred, not closed) so it can resend the same frame.
    expect(closeSpy).not.toHaveBeenCalled();
    expect(postMessageSpy).toHaveBeenCalledWith(
      {
        configId: 'needs-image-data',
        retryWithImageData: true,
        imageBitmap: bitmap,
      },
      [bitmap]
    );
    globalThis.OffscreenCanvas = originalOffscreenCanvas;
  });

  it('recycles pre-allocated double-buffer ArrayBuffer back to main thread in postMessage transfer list', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    qrRead.mockReturnValueOnce([fakeQrRead('https://safe.com')])
                  .mockReturnValueOnce([fakeQrRead('https://safe.com')]);

    const buffer = new ArrayBuffer(400);
    const req = {
      imageData: {
        data: new Uint8ClampedArray(buffer),
        width: 10,
        height: 10,
      },
      buffer,
      width: 10,
      height: 10,
      configId: 'buf-123',
      sequenceId: 1,
    };

    await workerHandler({ data: req } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        physicalReady: true,
        configId: 'buf-123',
        sequenceId: 1,
        buffer,
      }),
      [buffer]
    );
  });

  it('executes frame evaluation using pure JavaScript logic without WebAssembly instantiation or stubs', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    const instantiateSpy = vi.spyOn(globalThis.WebAssembly, 'instantiate');

    qrRead.mockReturnValueOnce([fakeQrRead('https://pure-js.com')])
                  .mockReturnValueOnce([fakeQrRead('https://pure-js.com')]);

    await workerHandler({ data: createDummyRequest('pure-js-1') } as MessageEvent);

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        physicalReady: true,
        configId: 'pure-js-1',
      })
    );
    expect(instantiateSpy).not.toHaveBeenCalled();
    instantiateSpy.mockRestore();
  });
});
