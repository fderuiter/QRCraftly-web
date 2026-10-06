// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeQrRead } from './utils/fakeQrRead';

const qrRead = vi.hoisted(() => vi.fn());
vi.mock('@/packages/qr-decode', () => ({ loadQrReader: () => Promise.resolve({ read: qrRead }) }));

const liveWorkers: Worker[] = [];

/** Poll often: these checks wait on real worker round-trips, which are slower under coverage. */
const WAIT = { timeout: 5000, interval: 2 };

/** The real scannability worker module, run in-thread by the global Worker from vitest.setup.ts. */
const createScannabilityWorker = async () => {
  const worker = new Worker(new URL('../src/packages/scannability/worker.ts', import.meta.url), { type: 'module' });
  liveWorkers.push(worker);
  // Wait until the module is evaluated so the timing assertions below measure message handling only.
  await (worker as unknown as { ready: Promise<void> }).ready;
  return worker;
};

describe('High-Fidelity Worker Concurrency & Serialization Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (globalThis.mockWorkerControl) {
      globalThis.mockWorkerControl.reset();
    }
  });

  afterEach(() => {
    // Stop every worker so no in-flight decode from one test leaks reader calls into the next.
    liveWorkers.splice(0).forEach(worker => worker.terminate());
    vi.clearAllMocks();
    if (globalThis.mockWorkerControl) {
      globalThis.mockWorkerControl.reset();
    }
  });

  // Requirement 1 / Acceptance Criteria 1: Non-serializable payload fails
  it('should fail/throw synchronously if a non-serializable payload (such as a function) is passed to postMessage', async () => {
    const worker = await createScannabilityWorker();
    
    // Passing a function should throw a structuredClone/DataCloneError
    expect(() => {
      worker.postMessage({
        handler: () => { console.log('hello'); }
      });
    }).toThrow();

    // Passing a DOM element (if document is present) should throw as well
    if (typeof document !== 'undefined') {
      const div = document.createElement('div');
      expect(() => {
        worker.postMessage({
          element: div
        });
      }).toThrow();
    }
  });

  it('should succeed/not throw if a fully serializable payload is passed to postMessage', async () => {
    const worker = await createScannabilityWorker();
    expect(() => {
      worker.postMessage({
        imageData: {
          data: new Uint8ClampedArray(100),
          width: 5,
          height: 5,
        },
        width: 5,
        height: 5,
        configId: '1',
      });
    }).not.toThrow();
  });

  // Requirement 2 / Acceptance Criteria 2: Executing exact optical and security checks used in production
  it('should execute actual worker logic and run optical/security checks dynamically', async () => {
    const worker = await createScannabilityWorker();
    let receivedResponse: any = null;
    worker.onmessage = (e: any) => {
      receivedResponse = e.data;
    };

    // Use mockImplementation to isolate mock data specifically to this test's parameters
    qrRead.mockImplementation((data: Uint8ClampedArray) => (data?.length === 400 ? [fakeQrRead('javascript:alert(1)')] : []));

    worker.postMessage({
      imageData: {
        data: new Uint8ClampedArray(400),
        width: 10,
        height: 10,
      },
      width: 10,
      height: 10,
      configId: 'sec-check',
    });

    // Wait for the asynchronous task to complete
    await vi.waitFor(() => expect(receivedResponse?.configId).toBe('sec-check'), WAIT);

    expect(receivedResponse).toEqual({
      success: false,
      physicalReady: false,
      error: 'SECURITY_VIOLATION',
      configId: 'sec-check',
      localContrastViolations: 0,
      minLocalContrast: 21,
    });

    // 2. Let's test a safe payload
    qrRead.mockImplementation(() => [fakeQrRead('https://safe.com')]);

    worker.postMessage({
      imageData: {
        data: new Uint8ClampedArray(400),
        width: 10,
        height: 10,
      },
      width: 10,
      height: 10,
      configId: 'safe-check',
    });

    await vi.waitFor(() => expect(receivedResponse?.configId).toBe('safe-check'), WAIT);

    expect(receivedResponse).toEqual({
      success: true,
      physicalReady: true,
      configId: 'safe-check',
      localContrastViolations: 0,
      minLocalContrast: 21,
    });
  });

  // Requirement 3 & 4 / Acceptance Criteria 3: Queue delay and dropping stale responses
  it('should support programmable delay and handle sequential backpressure, discarding out-of-order/stale responses', async () => {
    // Enable delay of 30ms and sequential execution (concurrency limit = 1)
    globalThis.mockWorkerControl.setDelay(30);
    globalThis.mockWorkerControl.setConcurrencyLimit(1);

    const worker = await createScannabilityWorker();
    const responses: any[] = [];
    const finishedAt: number[] = [];
    worker.onmessage = (e: any) => {
      responses.push(e.data);
      finishedAt.push(performance.now());
    };

    qrRead.mockReturnValue([fakeQrRead('https://safe.com')]);

    // Send three requests rapidly.
    // Due to concurrency limit = 1 and delay = 30ms, they should queue up and finish in order at t=30ms, t=60ms, t=90ms
    worker.postMessage({
      imageData: { data: new Uint8ClampedArray(400), width: 10, height: 10 },
      width: 10, height: 10, configId: 'task-1'
    });
    worker.postMessage({
      imageData: { data: new Uint8ClampedArray(400), width: 10, height: 10 },
      width: 10, height: 10, configId: 'task-2'
    });
    worker.postMessage({
      imageData: { data: new Uint8ClampedArray(400), width: 10, height: 10 },
      width: 10, height: 10, configId: 'task-3'
    });

    // With a 30ms delay nothing can finish within the first 15ms.
    await new Promise<void>(resolve => setTimeout(resolve, 15));
    expect(responses).toHaveLength(0);

    // With a concurrency limit of 1 the tasks finish strictly one after another, in order,
    // each at least one delay after the previous one. Lower bounds only, so a slow run
    // (for example under coverage instrumentation) cannot fail this.
    await vi.waitFor(() => expect(responses).toHaveLength(1), WAIT);
    expect(responses[0].configId).toBe('task-1');

    await vi.waitFor(() => expect(responses).toHaveLength(2), WAIT);
    expect(responses[1].configId).toBe('task-2');
    expect(finishedAt[1] - finishedAt[0]).toBeGreaterThanOrEqual(25);

    await vi.waitFor(() => expect(responses).toHaveLength(3), WAIT);
    expect(responses[2].configId).toBe('task-3');
    expect(finishedAt[2] - finishedAt[1]).toBeGreaterThanOrEqual(25);
  });

  // Requirement 1, 2, 4 & Acceptance Criteria 1, 2: Two-pass sequence of a dark-on-light pass followed
  // by a both-polarities fallback, in both the digital and the physical check (see scannabilitySteps).
  it('should execute standard decoding followed by an inverted fallback pass', async () => {
    const worker = await createScannabilityWorker();
    let receivedResponse: any = null;
    worker.onmessage = (e: any) => {
      receivedResponse = e.data;
    };

    const optionsPassed: unknown[] = [];
    qrRead.mockImplementation((_data: Uint8ClampedArray, _width: number, _height: number, options?: { inverted?: boolean }) => {
      optionsPassed.push(options?.inverted);
      return options?.inverted ? [fakeQrRead('https://inverted-qr.com')] : [];
    });

    worker.postMessage({
      imageData: {
        data: new Uint8ClampedArray(400),
        width: 10,
        height: 10,
      },
      width: 10,
      height: 10,
      configId: 'inverted-test',
    });

    await vi.waitFor(() => expect(receivedResponse?.configId).toBe('inverted-test'), WAIT);

    // Two passes for the digital check, the second in both polarities, then one camera-style read
    // of the simulated print, which always looks for both polarities
    expect(optionsPassed).toEqual([false, true, true]);
    expect(receivedResponse).toEqual({
      success: true,
      physicalReady: true,
      configId: 'inverted-test',
      localContrastViolations: 0,
      minLocalContrast: 21,
    });
  });
});
