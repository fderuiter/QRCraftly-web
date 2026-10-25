// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isLowTierDevice,
  isOffThreadSupported,
  processImageOffThread,
  processImageOnMainThread
} from './imageResizeHelper';
import { InThreadWorker } from '../../tests/utils/inThreadWorker';

/** The real worker module on this thread, remembering every instance made. */
class TestWorker extends InThreadWorker {
  static made: TestWorker[] = [];
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    TestWorker.made.push(this);
  }
}

/** A worker that answers every request with `reply` instead of running the module. */
const answering = (reply: unknown) =>
  class extends TestWorker {
    postMessage(): void {
      setTimeout(() => this.dispatchMessage(reply), 0);
    }
  };

/** A worker that never answers. */
class SilentWorker extends TestWorker {
  postMessage(): void {}
}

describe('imageResizeHelper', () => {
  const originalNavigator = global.navigator;
  const originalWindow = global.window;

  afterEach(() => {
    vi.restoreAllMocks();
    global.navigator = originalNavigator;
    global.window = originalWindow;
  });

  describe('isLowTierDevice', () => {
    it('returns true if hardwareConcurrency < 4', () => {
      Object.defineProperty(global, 'navigator', {
        value: { hardwareConcurrency: 2 },
        writable: true,
        configurable: true
      });
      expect(isLowTierDevice()).toBe(true);
    });

    it('returns true if deviceMemory < 4', () => {
      Object.defineProperty(global, 'navigator', {
        value: { hardwareConcurrency: 8, deviceMemory: 2 },
        writable: true,
        configurable: true
      });
      expect(isLowTierDevice()).toBe(true);
    });

    it('returns false if device has high specs', () => {
      Object.defineProperty(global, 'navigator', {
        value: { hardwareConcurrency: 8, deviceMemory: 8 },
        writable: true,
        configurable: true
      });
      expect(isLowTierDevice()).toBe(false);
    });
  });

  describe('isOffThreadSupported', () => {
    it('returns true if Worker, OffscreenCanvas, and createImageBitmap are in window', () => {
      Object.defineProperty(global, 'window', {
        value: {
          Worker: class {},
          OffscreenCanvas: class {},
          createImageBitmap: () => {}
        },
        writable: true,
        configurable: true
      });
      expect(isOffThreadSupported()).toBe(true);
    });

    it('returns false if Worker is missing', () => {
      Object.defineProperty(global, 'window', {
        value: {
          OffscreenCanvas: class {},
          createImageBitmap: () => {}
        },
        writable: true,
        configurable: true
      });
      expect(isOffThreadSupported()).toBe(false);
    });
  });

  describe('processImageOnMainThread', () => {
    it('successfully processes an image and outputs optimized dataUrl', async () => {
      // Mock global URL methods
      const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
      const revokeObjectURLMock = vi.fn();
      global.URL.createObjectURL = createObjectURLMock;
      global.URL.revokeObjectURL = revokeObjectURLMock;

      // Mock Image constructor
      const mockImage = {
        naturalWidth: 2000,
        naturalHeight: 1000,
        onload: null as any,
        onerror: null as any,
        src: ''
      };
      
      const originalImage = global.Image;
      global.Image = vi.fn().mockImplementation(function (this: any) {
        // Automatically trigger onload on src set
        setTimeout(() => {
          if (mockImage.onload) mockImage.onload();
        }, 0);
        return mockImage;
      }) as any;

      // Mock HTMLCanvasElement
      const mockToDataURL = vi.fn().mockReturnValue('data:image/webp;base64,mockWebP');
      const mockCtx = {
        drawImage: vi.fn(),
        clearRect: vi.fn()
      };
      const mockCanvas = {
        getContext: () => mockCtx,
        toDataURL: mockToDataURL,
        width: 0,
        height: 0
      };

      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'canvas') {
          return mockCanvas as any;
        }
        return {} as any;
      });

      const file = new Blob(['dummy content'], { type: 'image/png' });
      const result = await processImageOnMainThread(file, 1000);

      expect(createObjectURLMock).toHaveBeenCalledWith(file);
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url');
      expect(mockCanvas.width).toBe(1000);
      expect(mockCanvas.height).toBe(500);
      expect(mockCtx.drawImage).toHaveBeenCalledWith(mockImage, 0, 0, 1000, 500);
      expect(mockToDataURL).toHaveBeenCalledWith('image/webp', 0.8);
      expect(result).toBe('data:image/webp;base64,mockWebP');

      global.Image = originalImage;
    });
  });

  /*
   * The real worker module (#1612), run on the test thread by InThreadWorker. jsdom has no
   * createImageBitmap or OffscreenCanvas, so those are stubbed and record what the worker drew.
   */
  describe('processImageOffThread', () => {
    const drawn: { width: number; height: number; args: unknown[] }[] = [];
    const bitmap = { width: 4000, height: 3000, close: vi.fn() };

    class FakeOffscreenCanvas {
      width: number;
      height: number;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }
      getContext() {
        return {
          clearRect: () => {},
          drawImage: (...args: unknown[]) => drawn.push({ width: this.width, height: this.height, args }),
        };
      }
      convertToBlob({ type }: { type: string }) {
        return Promise.resolve(new Blob(['resized'], { type }));
      }
    }

    beforeEach(() => {
      drawn.length = 0;
      TestWorker.made = [];
      vi.stubGlobal('Worker', TestWorker);
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
      vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('scales a 4000x3000 image to fit maxDim, keeping its aspect ratio', async () => {
      const result = await processImageOffThread(new Blob(['png'], { type: 'image/png' }), 1200);
      expect(drawn).toEqual([{ width: 1200, height: 900, args: [bitmap, 0, 0, 1200, 900] }]);
      expect(bitmap.close).toHaveBeenCalled();
      expect(TestWorker.made.map((worker) => worker.terminated)).toEqual([true]);
      // Without FileReaderSync the worker sends the blob and the helper reads it on this thread.
      expect(result).toBe(`data:image/webp;base64,${btoa('resized')}`);
    });

    it('leaves an image that already fits at its own size', async () => {
      bitmap.width = 800;
      bitmap.height = 600;
      try {
        await processImageOffThread(new Blob(['png'], { type: 'image/png' }), 1200);
        expect(drawn[0]?.args).toEqual([bitmap, 0, 0, 800, 600]);
      } finally {
        bitmap.width = 4000;
        bitmap.height = 3000;
      }
    });

    it('uses the data URL the worker made itself when it can read blobs synchronously', async () => {
      vi.stubGlobal('FileReaderSync', class { readAsDataURL = () => 'data:image/webp;base64,fromWorker'; });
      await expect(processImageOffThread(new Blob(['png']), 1200)).resolves.toBe('data:image/webp;base64,fromWorker');
    });

    it("rejects with the worker's own error message", async () => {
      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('The source image could not be decoded.')));
      await expect(processImageOffThread(new Blob(['not an image']), 1200)).rejects.toThrow('The source image could not be decoded.');
    });

    it('rejects a success message that carries neither a data URL nor a blob', async () => {
      vi.stubGlobal('Worker', answering({ success: true }));
      await expect(processImageOffThread(new Blob(['png']), 1200)).rejects.toThrow('Invalid worker response structure');
    });

    it('stops a worker that never answers and rejects once the timeout passes', async () => {
      vi.stubGlobal('Worker', SilentWorker);
      await expect(processImageOffThread(new Blob(['png']), 1200, 50)).rejects.toThrow('Worker resize timed out after 50 ms');
      expect(TestWorker.made.map((worker) => worker.terminated)).toEqual([true]);
    });
  });
});
