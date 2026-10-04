/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadQrEncoder, type QrSymbolEncoder } from '../src/packages/qr-matrix/encoder';
import { loadWorkerModule, type InThreadWorkerScope, type WorkerModuleUnderTest } from './utils/inThreadWorker';

/** The encoder the worker loads: one instance per module graph, shared with this file. */
let QRCode: QrSymbolEncoder;
beforeAll(async () => {
  QRCode = await loadQrEncoder();
});

describe('fileSliceWorker', () => {
  let workerHandler: WorkerModuleUnderTest['handle'];
  let scope: InThreadWorkerScope;
  let originalPostMessage: any;

  beforeAll(async () => {
    // Mock the global crypto subtly to avoid dependency issues if needed, but page.test already defined it
    if (!globalThis.crypto) {
      (globalThis as any).crypto = {
        subtle: {
          digest: async () => new Uint8Array(32).buffer
        }
      };
    }
    const worker = await loadWorkerModule(new URL('../src/packages/optical-transfer/worker-slice.ts', import.meta.url));
    scope = worker.scope;
    workerHandler = worker.handle;
  });

  let digestSpy: any;

  beforeEach(() => {
    originalPostMessage = scope.postMessage;
    digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest');
    vi.clearAllMocks();
  });

  afterEach(() => {
    scope.postMessage = originalPostMessage;
    digestSpy.mockRestore();
    // Clear any active state by stopping the worker
    if (workerHandler) {
      workerHandler({ data: { type: 'STOP' } });
    }
  });

  it('scales the lookahead window based on target FPS', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    const dummyBlob = new Blob(['hello world'], { type: 'text/plain' });

    // Start with 60 FPS, lookahead should scale to at least 12 (Math.ceil(60 * 0.2) = 12)
    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: dummyBlob,
          chunkSize: 1,
          fps: 60
        }
      }
    });

    // Wait for the pipeline processing
    await new Promise(resolve => setTimeout(resolve, 10));

    // The worker should generate up to lookaheadLimit + 1 frames (the handshake frame at index 0 + lookaheadLimit frames)
    // For 60 FPS, lookahead limit is 12. So nextIndexToGenerate can generate up to lastAckedIndex + 12.
    // lastAckedIndex starts at -1, so it generates indices 0 to 11 (12 frames total)
    const frameCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'FRAME');
    expect(frameCalls.length).toBe(12);
  });

  it('bounds the lookahead window to a maximum of 16 to prevent memory exhaustion', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    const dummyBlob = new Blob([new Uint8Array(100)], { type: 'application/octet-stream' });

    // Set 120 FPS, lookahead scales but is bounded to a maximum of 16 frames
    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: dummyBlob,
          chunkSize: 1,
          fps: 120
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const frameCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'FRAME');
    // lastAckedIndex starts at -1. Capped at 16, so it generates indices 0 to 15 (16 frames)
    expect(frameCalls.length).toBe(16);
  });

  it('caches the SHA-256 hash across transfer restarts', async () => {
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest');
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    const dummyBlob = new Blob(['caching test'], { type: 'text/plain' });

    // First start
    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: dummyBlob,
          chunkSize: 5,
          fps: 15
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));
    const firstCallCount = digestSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    // Stop and restart
    await workerHandler({ data: { type: 'STOP' } });
    digestSpy.mockClear();

    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: dummyBlob,
          chunkSize: 5,
          fps: 15
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));
    // Should NOT have computed the hash again
    expect(digestSpy.mock.calls.length).toBe(0);
  });

  it('supports HEAL to resume frame generation from a specific ACK point', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    const dummyBlob = new Blob([new Uint8Array(50)], { type: 'application/octet-stream' });

    // Start with 15 FPS, lookahead is 3
    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: dummyBlob,
          chunkSize: 2,
          fps: 15
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    // Initially with lookahead 3 and lastAckedIndex = -1, it generates indices 0, 1, 2 (3 frames)
    let frameCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'FRAME');
    expect(frameCalls.length).toBe(3);

    // Clear postMessage mock to count subsequent generation
    postMessageSpy.mockClear();

    // Send HEAL with lastAckedIndex = 1
    await workerHandler({
      data: {
        type: 'HEAL',
        payload: {
          lastAckedIndex: 1
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    // Now lookahead limit allows generating up to 1 + 3 = 4 (indices 3 and 4)
    frameCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'FRAME');
    expect(frameCalls.map(c => c[0].index)).toContain(3);
    expect(frameCalls.map(c => c[0].index)).toContain(4);
  });

  it('handles ACK messages and generates next frames up to lookahead limit', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    const dummyBlob = new Blob([new Uint8Array(20)], { type: 'application/octet-stream' });

    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: dummyBlob,
          chunkSize: 5,
          fps: 15
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));
    postMessageSpy.mockClear();

    await workerHandler({
      data: {
        type: 'ACK',
        payload: {
          index: 0
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const progressCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'PROGRESS');
    expect(progressCalls.length).toBe(1);
    expect(progressCalls[0][0].index).toBe(1);

    const frameCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'FRAME');
    expect(frameCalls.length).toBe(1);
    expect(frameCalls[0][0].index).toBe(3);
  });

  it('posts ERROR message when SHA-256 computation fails', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValueOnce(new Error('Mocked hash error'));
    const dummyBlob = new Blob(['hash fail'], { type: 'text/plain' });

    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: dummyBlob,
          chunkSize: 5,
          fps: 15
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const errorCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'ERROR');
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][0].message).toContain('Encoding failed: Mocked hash error');

    digestSpy.mockRestore();
  });

  it('ignores unknown message types', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    await workerHandler({
      data: {
        type: 'UNKNOWN_TYPE_BLABLA'
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  it('posts ERROR message when the encoder throws an error during frame generation', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    const createSpy = vi.spyOn(QRCode, 'create').mockImplementationOnce(() => {
      throw new Error('Mocked QR creation failure');
    });

    const dummyBlob = new Blob(['one'], { type: 'text/plain' });

    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: dummyBlob,
          chunkSize: 5,
          fps: 15
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const errorCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'ERROR');
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][0].message).toContain('Failed to generate frame 0: Mocked QR creation failure');

    createSpy.mockRestore();
  });

  it('posts ERROR message when START payload has no file', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: undefined,
          chunkSize: 5,
          fps: 15
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    const errorCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'ERROR');
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][0].message).toBe('No file provided');
  });

  it('covers remaining edge case branches of fileSliceWorker', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    const dummyBlob = new Blob(['fallback fps test'], { type: 'text/plain' });
    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: dummyBlob,
          chunkSize: 5
        }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    postMessageSpy.mockClear();
    await workerHandler({
      data: {
        type: 'ACK',
        payload: { index: -2 }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(postMessageSpy).not.toHaveBeenCalled();

    await workerHandler({
      data: {
        type: 'HEAL'
      }
    });
    await workerHandler({
      data: {
        type: 'HEAL',
        payload: {}
      }
    });
    await workerHandler({
      data: {
        type: 'HEAL',
        payload: { lastAckedIndex: 'not a number' }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));

    await workerHandler({ data: { type: 'STOP' } });

    const freshBlob = new Blob(['fresh unique hash fail content'], { type: 'text/plain' });
    const digestSpy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockRejectedValueOnce('Mocked string hash error');
    postMessageSpy.mockClear();
    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: freshBlob,
          chunkSize: 5
        }
      }
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    const errorCalls = postMessageSpy.mock.calls.filter(c => c[0].type === 'ERROR');
    expect(errorCalls.length).toBe(1);
    expect(errorCalls[0][0].message).toBe('Encoding failed: Mocked string hash error');

    digestSpy.mockRestore();
  });
});

describe('fileSliceWorker State Cache', () => {
  let workerHandler: WorkerModuleUnderTest['handle'];
  let scope: InThreadWorkerScope;
  let originalPostMessage: any;
  let digestSpy: any;
  let postedMessages: any[] = [];

  beforeAll(async () => {
    const worker = await loadWorkerModule(new URL('../src/packages/optical-transfer/worker-slice.ts', import.meta.url));
    scope = worker.scope;
    workerHandler = worker.handle;
  });

  beforeEach(() => {
    postedMessages = [];
    originalPostMessage = scope.postMessage;
    const spy = vi.fn((msg) => postedMessages.push(msg));
    scope.postMessage = spy;
    digestSpy = vi.spyOn(crypto.subtle, 'digest');
  });

  afterEach(() => {
    scope.postMessage = originalPostMessage;
    digestSpy.mockRestore();
    if (workerHandler) {
      workerHandler({ data: { type: 'STOP' } });
    }
  });

  function createTestFile(name = 'test.bin', content = 'Hello Animated QR World', type = 'application/octet-stream') {
    const blob = new Blob([content], { type });
    return new File([blob], name, { type, lastModified: 1700000000 });
  }

  it('computes SHA-256 on first run and includes hash in handshake frame', async () => {
    const testFile = createTestFile('sample1.txt', 'Sample Content 1');

    await workerHandler({
      data: {
        type: 'START',
        payload: {
          file: testFile,
          chunkSize: 64,
          errorCorrectionLevel: 'M',
        },
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(digestSpy).toHaveBeenCalledTimes(1);

    const frame0 = postedMessages.find((m) => m.type === 'FRAME' && m.index === 0);
    expect(frame0).toBeDefined();

    // Verify progress message
    const progress0 = postedMessages.find((m) => m.type === 'PROGRESS' && m.index === 0);
    expect(progress0).toBeDefined();
    expect(progress0.fileName).toBe('sample1.txt');
  });

  it('skips SHA-256 calculation on loop restart when file has not changed', async () => {
    const testFile = createTestFile('loop_test.bin', 'Loop Test Payload');

    // 1. Initial run
    await workerHandler({
      data: {
        type: 'START',
        payload: { file: testFile, chunkSize: 64, errorCorrectionLevel: 'M' },
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const initialDigestCalls = digestSpy.mock.calls.length;
    expect(initialDigestCalls).toBe(1);

    // Capture initial handshake frame
    const initialFrame0 = postedMessages.find((m) => m.type === 'FRAME' && m.index === 0);
    expect(initialFrame0).toBeDefined();

    postedMessages.length = 0;

    // 2. Loop restart (send START again with same file instance/metadata)
    await workerHandler({
      data: {
        type: 'START',
        payload: { file: testFile, chunkSize: 64, errorCorrectionLevel: 'M' },
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Verify digest was NOT called again during loop restart
    expect(digestSpy.mock.calls.length).toBe(initialDigestCalls);

    const loopFrame0 = postedMessages.find((m) => m.type === 'FRAME' && m.index === 0);
    expect(loopFrame0).toBeDefined();
    // Frame size and structure should match
    expect(loopFrame0.size).toBe(initialFrame0.size);
  });

  it('preserves cached hash on STOP message and reuse on next START with same file', async () => {
    const testFile = createTestFile('stop_test.bin', 'Stop Test Data');

    // Initial start
    await workerHandler({
      data: {
        type: 'START',
        payload: { file: testFile, chunkSize: 64, errorCorrectionLevel: 'M' },
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(digestSpy).toHaveBeenCalledTimes(1);

    // STOP
    await workerHandler({
      data: { type: 'STOP' },
    } as MessageEvent);

    // START again with same file
    await workerHandler({
      data: {
        type: 'START',
        payload: { file: testFile, chunkSize: 64, errorCorrectionLevel: 'M' },
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Hash is preserved across transfers for the same file
    expect(digestSpy).toHaveBeenCalledTimes(1);
  });

  it('recomputes SHA-256 when a new file is loaded', async () => {
    const file1 = createTestFile('file1.bin', 'File One Data');
    const file2 = createTestFile('file2.bin', 'File Two Data (Different)');

    // Start with file1
    await workerHandler({
      data: {
        type: 'START',
        payload: { file: file1, chunkSize: 64, errorCorrectionLevel: 'M' },
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(digestSpy).toHaveBeenCalledTimes(1);

    // Start with file2 without explicit STOP
    await workerHandler({
      data: {
        type: 'START',
        payload: { file: file2, chunkSize: 64, errorCorrectionLevel: 'M' },
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // Digest should be called again for file2 because metadata changed
    expect(digestSpy).toHaveBeenCalledTimes(2);
  });

  it('preserves handshake checksum consistency across loop restarts', async () => {
    const file = createTestFile('consistency.bin', 'Consistency payload for checksum test');

    // Run 1
    await workerHandler({
      data: {
        type: 'START',
        payload: { file, chunkSize: 64, errorCorrectionLevel: 'M' },
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const run1Frame0 = postedMessages.find((m) => m.type === 'FRAME' && m.index === 0);
    expect(run1Frame0).toBeDefined();
    const run1Frame0Data = new Uint8Array(run1Frame0.data);

    postedMessages.length = 0;

    // Run 2 (Loop restart)
    await workerHandler({
      data: {
        type: 'START',
        payload: { file, chunkSize: 64, errorCorrectionLevel: 'M' },
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const run2Frame0 = postedMessages.find((m) => m.type === 'FRAME' && m.index === 0);
    expect(run2Frame0).toBeDefined();
    const run2Frame0Data = new Uint8Array(run2Frame0.data);

    expect(run1Frame0Data).toEqual(run2Frame0Data);
  });

  it('invalidates stale session and silently aborts previous emissions when START is dispatched mid-stream', async () => {
    const file1 = createTestFile('superseded.bin', 'This transfer will be interrupted mid-stream');
    const file2 = createTestFile('active.bin', 'This is the fresh new transfer session');

    // Start session 1
    const start1Promise = workerHandler({
      data: {
        type: 'START',
        payload: { file: file1, chunkSize: 10, fps: 15 },
      },
    } as MessageEvent);

    // Immediately dispatch session 2 START while session 1 is still processing
    const start2Promise = workerHandler({
      data: {
        type: 'START',
        payload: { file: file2, chunkSize: 10, fps: 15 },
      },
    } as MessageEvent);

    await Promise.all([start1Promise, start2Promise]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Inspect emitted PROGRESS and FRAME messages
    const progressMessages = postedMessages.filter((m) => m.type === 'PROGRESS');
    const frameMessages = postedMessages.filter((m) => m.type === 'FRAME');

    // All emitted progress and frames must belong strictly to active file2 session ('active.bin')
    const file1Progress = progressMessages.filter((m) => m.fileName === 'superseded.bin');
    expect(file1Progress.length).toBe(0);

    const file2Progress = progressMessages.filter((m) => m.fileName === 'active.bin');
    expect(file2Progress.length).toBeGreaterThan(0);

    // Ensure frame sequence numbers start cleanly at index 0 for the active session
    expect(frameMessages[0].index).toBe(0);
    const initialized = postedMessages.filter((m) => m.type === 'INITIALIZED');
    expect(frameMessages[0].total).toBe(initialized[initialized.length - 1].totalFrames);
  });
});
