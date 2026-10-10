/**
 * Image files are decoded inside the scanner worker (#1098): the browser decodes the file into an
 * ImageBitmap with its EXIF orientation applied, and the worker tries the native size (capped at
 * 2048 px) before a 1024 px copy. `createImageBitmap` and `OffscreenCanvas` are stubbed with plain
 * RGBA buffers, since Node has neither.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InThreadWorker } from '../../../../tests/utils/inThreadWorker';
import { renderCorpusFrame } from '../../../../tests/utils/scannerCorpus';

const WORKER_URL = new URL('../worker.ts', import.meta.url);
const TEXT = 'https://qrcraftly.com/photo';

interface FakeBitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  close: () => void;
}

/** A canvas whose drawImage resamples a fake bitmap (nearest neighbour). */
class FakeOffscreenCanvas {
  static drawn: string[] = [];
  private pixels: Uint8ClampedArray;

  constructor(
    public width: number,
    public height: number
  ) {
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  getContext() {
    return {
      drawImage: (image: FakeBitmap, _dx: number, _dy: number, dw: number, dh: number) => {
        FakeOffscreenCanvas.drawn.push(`${dw}x${dh}`);
        for (let y = 0; y < dh; y++) {
          const sy = Math.floor((y * image.height) / dh);
          for (let x = 0; x < dw; x++) {
            const sx = Math.floor((x * image.width) / dw);
            const from = (sy * image.width + sx) * 4;
            this.pixels.set(image.data.subarray(from, from + 4), (y * dw + x) * 4);
          }
        }
      },
      getImageData: (_sx: number, _sy: number, sw: number, sh: number) => ({ data: this.pixels, width: sw, height: sh }),
    };
  }
}

function postAndWait(worker: InThreadWorker, message: unknown): Promise<{ status: string; decodedData?: string | null; error?: string | null }> {
  return new Promise((resolve) => {
    worker.onmessage = (event) => resolve(event.data);
    worker.postMessage(message);
  });
}

describe('image file scanning in the worker', () => {
  let bitmap: FakeBitmap | null;
  let worker: InThreadWorker;
  const createImageBitmap = vi.fn(async (_file: Blob, _options?: ImageBitmapOptions) => {
    if (!bitmap) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
    return bitmap;
  });

  beforeEach(() => {
    FakeOffscreenCanvas.drawn = [];
    createImageBitmap.mockClear();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    worker = new InThreadWorker(WORKER_URL, { type: 'module' });
  });

  afterEach(() => {
    worker.terminate();
    vi.unstubAllGlobals();
  });

  it('decodes a 4000x3000 photo at 2048 px, with the EXIF orientation applied', async () => {
    const photo = renderCorpusFrame({ text: TEXT, width: 4000, height: 3000, modulePx: 12, noise: 4 });
    const close = vi.fn();
    bitmap = { width: photo.width, height: photo.height, data: photo.data, close };

    const file = new Blob(['jpeg bytes'], { type: 'image/jpeg' });
    const response = await postAndWait(worker, { type: 'scan-file', file, sequenceId: 7 });

    expect(response).toMatchObject({ status: 'pass', sequenceId: 7, decodedData: TEXT });
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: 'from-image' });
    expect(FakeOffscreenCanvas.drawn).toEqual(['2048x1536']);
    expect(close).toHaveBeenCalled();
  });

  it('falls back to a 1024 px copy when the larger size finds nothing', async () => {
    const empty = renderCorpusFrame({ text: null, width: 3000, height: 2000 });
    bitmap = { width: empty.width, height: empty.height, data: empty.data, close: vi.fn() };

    const response = await postAndWait(worker, { type: 'scan-file', file: new Blob(['x']), sequenceId: 8 });

    expect(response).toMatchObject({ status: 'fail', sequenceId: 8, decodedData: null });
    expect(response.error).toBeUndefined();
    expect(FakeOffscreenCanvas.drawn).toEqual(['2048x1365', '1024x683']);
  });

  it('decodes a small screenshot once, at its own size', async () => {
    const shot = renderCorpusFrame({ text: TEXT, width: 800, height: 600 });
    bitmap = { width: shot.width, height: shot.height, data: shot.data, close: vi.fn() };

    const response = await postAndWait(worker, { type: 'scan-file', file: new Blob(['png']), sequenceId: 9 });

    expect(response).toMatchObject({ status: 'pass', decodedData: TEXT });
    expect(FakeOffscreenCanvas.drawn).toEqual(['800x600']);
  });

  it('reports a file the browser cannot read as an image', async () => {
    bitmap = null;
    const response = await postAndWait(worker, { type: 'scan-file', file: new Blob(['garbage']), sequenceId: 10 });
    expect(response).toMatchObject({ status: 'fail', sequenceId: 10, error: 'FILE_SCAN_UNREADABLE' });
  });

  it('refuses a decoded image over 40 megapixels whose header gave no size, without drawing it (#1299)', async () => {
    const close = vi.fn();
    bitmap = { width: 8000, height: 6000, data: new Uint8ClampedArray(0), close };
    const response = await postAndWait(worker, { type: 'scan-file', file: new Blob(['ico']), sequenceId: 12 });
    expect(response).toMatchObject({ status: 'fail', sequenceId: 12, error: expect.stringContaining('40 megapixels') });
    expect(FakeOffscreenCanvas.drawn).toEqual([]);
    expect(close).toHaveBeenCalled();
  });

  it('asks the main thread to decode when the worker has no OffscreenCanvas', async () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    const response = await postAndWait(worker, { type: 'scan-file', file: new Blob(['png']), sequenceId: 11 });
    expect(response).toMatchObject({ status: 'fail', sequenceId: 11, error: 'FILE_SCAN_UNSUPPORTED' });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });
});
