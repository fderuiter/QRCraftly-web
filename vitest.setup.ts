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

import '@testing-library/jest-dom';
import 'vitest-axe/extend-expect';
import { terminateScannerWorker } from './src/packages/optical-scanner/scheduler';
import * as matchers from 'vitest-axe/matchers';
import { vi, afterEach, expect } from 'vitest';
import { InThreadWorker, assertStructuredCloneable } from './tests/utils/inThreadWorker';
import { qrEncoder } from './tests/fixtures/qrEncoder';
import { setQrCanvasRuntime } from './src/utils/qrCanvasRuntime';


declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface Assertion<T = any> extends matchers.AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export interface AsymmetricMatchersContaining extends matchers.AxeMatchers {}
}

expect.extend(matchers);

function createMemoryStorage(): Storage {
  let store: Record<string, string> = {};
  const storageObj = {
    get length() {
      return Object.keys(store).length;
    },
    clear() {
      store = {};
    },
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    key(index: number) {
      const keys = Object.keys(store);
      return keys[index] ?? null;
    },
    removeItem(key: string) {
      delete store[key];
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
  };

  return new Proxy(storageObj as unknown as Storage, {
    get(target, prop, receiver) {
      if (prop in target || typeof prop === 'symbol') {
        return Reflect.get(target, prop, receiver);
      }
      return target.getItem(String(prop));
    },
    set(target, prop, value, receiver) {
      if (prop in target || typeof prop === 'symbol') {
        return Reflect.set(target, prop, value, receiver);
      }
      target.setItem(String(prop), String(value));
      return true;
    },
    deleteProperty(target, prop) {
      if (typeof prop === 'string' && !(prop in target)) {
        target.removeItem(prop);
        return true;
      }
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys() {
      return Object.keys(store);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(store, prop)) {
        return {
          value: store[prop],
          writable: true,
          enumerable: true,
          configurable: true,
        };
      }
      return undefined;
    },
  });
}

if (typeof window !== 'undefined') {
  const memLocal = createMemoryStorage();
  const memSession = createMemoryStorage();
  Object.defineProperty(window, 'localStorage', {
    value: memLocal,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: memSession,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: memLocal,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: memSession,
    writable: true,
    configurable: true,
  });
}

if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

declare global {
  var mockWorkerControl: {
    setInterceptor: (fn: ((message: any, worker: any) => void) | null) => void;
    setDelay: (ms: number) => void;
    setResponseOverride: (response: any) => void;
    setConcurrencyLimit: (limit: number) => void;
    getInstances: () => any[];
    reset: () => void;
    activeWorker: any;
  };
}

interface WorkerMockConfig {
  interceptor: ((message: any, worker: any) => void) | null;
  delayMs: number;
  responseOverride: any | null;
  concurrencyLimit: number;
  instances: any[];
  activeWorker: any | null;
}

const mockConfig: WorkerMockConfig = {
  interceptor: null,
  delayMs: 0,
  responseOverride: null,
  concurrencyLimit: Infinity,
  instances: [],
  activeWorker: null,
};

let runningTasksCount = 0;
const pendingTasks: Array<() => Promise<void>> = [];

function runNextTasks() {
  while (pendingTasks.length > 0 && runningTasksCount < mockConfig.concurrencyLimit) {
    const nextTask = pendingTasks.shift();
    if (nextTask) {
      runningTasksCount++;
      nextTask().finally(() => {
        runningTasksCount--;
        runNextTasks();
      });
    }
  }
}

function enqueueTask(task: () => Promise<void>) {
  pendingTasks.push(task);
  runNextTasks();
}

/**
 * jsdom has no Web Workers, so `new Worker(url)` runs the real worker module on the
 * test thread (see tests/utils/inThreadWorker.ts). `mockWorkerControl` can still
 * intercept messages, override responses, delay delivery or cap concurrency.
 */
class MockWorker extends InThreadWorker {
  constructor(url: string | URL, options?: WorkerOptions) {
    super(url, options);
    mockConfig.instances.push(this);
    mockConfig.activeWorker = this;
  }

  addEventListener = vi.fn((type: string, listener: any) => super.addEventListener(type, listener));

  removeEventListener = vi.fn((type: string, listener: any) => super.removeEventListener(type, listener));

  terminate = vi.fn(() => super.terminate());

  postMessage = vi.fn((message: any, _transfer?: any) => {
    if (this.terminated) return;
    // Reject non-serializable payloads synchronously, as a real postMessage does.
    assertStructuredCloneable(message);
    structuredClone(message);

    const delay = mockConfig.delayMs;
    const execute = async () => {
      if (this.terminated) return;
      if (mockConfig.interceptor) {
        mockConfig.interceptor(message, this);
        return;
      }
      if (mockConfig.responseOverride !== null) {
        this.dispatchMessage(mockConfig.responseOverride);
        return;
      }
      await this.deliverToWorker(message);
    };
    enqueueTask(
      () =>
        new Promise<void>(resolve => {
          setTimeout(() => {
            execute().then(resolve, resolve);
          }, delay);
        }),
    );
  });
}

globalThis.Worker = MockWorker as any;

if (typeof globalThis.ImageBitmap === 'undefined') {
  globalThis.ImageBitmap = class ImageBitmap {
    width = 0;
    height = 0;
    _data: Uint8ClampedArray | null = null;
    constructor(width = 100, height = 100, data: Uint8ClampedArray | null = null) {
      this.width = width;
      this.height = height;
      this._data = data;
    }
    close() {}
  } as any;
}

if (typeof globalThis.createImageBitmap === 'undefined') {
  globalThis.createImageBitmap = vi.fn().mockImplementation((source, options) => {
    let width = 100;
    let height = 100;
    if (options && typeof options.resizeWidth === 'number') {
      width = options.resizeWidth;
    } else if (source && typeof source.videoWidth === 'number') {
      width = source.videoWidth;
    }
    if (options && typeof options.resizeHeight === 'number') {
      height = options.resizeHeight;
    } else if (source && typeof source.videoHeight === 'number') {
      height = source.videoHeight;
    }
    const img = new (globalThis.ImageBitmap as any)(width, height);
    return {
      then(cb: any) {
        cb(img);
        return {
          catch() {
            return this;
          }
        };
      }
    } as any;
  });
}

if (typeof globalThis.ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  } as any;
}
if (typeof window !== 'undefined') {
  (window as any).Worker = MockWorker as any;
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (callback: (time: number) => void) => {
    return setTimeout(() => callback(Date.now()), 16) as any;
  };
}

if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id: any) => {
    clearTimeout(id);
  };
}

if (typeof window !== 'undefined') {
  if (typeof (window as any).requestAnimationFrame === 'undefined') {
    (window as any).requestAnimationFrame = globalThis.requestAnimationFrame;
  }
  if (typeof (window as any).cancelAnimationFrame === 'undefined') {
    (window as any).cancelAnimationFrame = globalThis.cancelAnimationFrame;
  }
}

globalThis.mockWorkerControl = {
  setInterceptor: (fn: ((message: any, worker: any) => void) | null) => {
    mockConfig.interceptor = fn;
  },
  setDelay: (ms: number) => {
    mockConfig.delayMs = ms;
  },
  setResponseOverride: (response: any) => {
    mockConfig.responseOverride = response;
  },
  setConcurrencyLimit: (limit: number) => {
    mockConfig.concurrencyLimit = limit;
  },
  getInstances: () => mockConfig.instances,
  get activeWorker() {
    return mockConfig.activeWorker;
  },
  set activeWorker(val) {
    mockConfig.activeWorker = val;
  },
  reset: () => {
    mockConfig.interceptor = null;
    mockConfig.delayMs = 0;
    mockConfig.responseOverride = null;
    mockConfig.concurrencyLimit = Infinity;
    runningTasksCount = 0;
    pendingTasks.length = 0;
    mockConfig.instances = [];
    mockConfig.activeWorker = null;
  }
};

// ---------------------------------------------------------------------------
// Global mocks for Canvas Context, Fetch, URL
// ---------------------------------------------------------------------------

function parseColor(color: string): { r: number, g: number, b: number, a: number } {
  if (!color) return { r: 0, g: 0, b: 0, a: 0 };
  const trimmed = color.trim().toLowerCase();
  
  if (trimmed.startsWith('#')) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b, a: 255 };
    }
    if (hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = parseInt(hex[3] + hex[3], 16);
      return { r, g, b, a };
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 255 };
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16);
      return { r, g, b, a };
    }
  }

  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    const a = rgbMatch[4] !== undefined ? Math.round(parseFloat(rgbMatch[4]) * 255) : 255;
    return { r, g, b, a };
  }

  if (trimmed === 'white') return { r: 255, g: 255, b: 255, a: 255 };
  if (trimmed === 'black') return { r: 0, g: 0, b: 0, a: 255 };
  if (trimmed === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  return { r: 0, g: 0, b: 0, a: 255 };
}

const createMockContext = (canvasEl?: any) => {
  const ctx = {
    _virtualGrid: new Map<string, string>(),
    _bgColor: '',
    _segments: [] as any[],
    _currentPoint: { x: 0, y: 0 },
    
    isFilled(x: number, y: number): boolean {
      const px = Math.floor(x);
      const py = Math.floor(y);
      const color = this._virtualGrid.get(`${px},${py}`);
      if (!color) return false;
      const parsed = parseColor(color);
      if (parsed.a === 0) return false;
      // White is background/empty
      if (parsed.r === 255 && parsed.g === 255 && parsed.b === 255) return false;
      if (this._bgColor) {
        const bgParsed = parseColor(this._bgColor);
        if (parsed.r === bgParsed.r && parsed.g === bgParsed.g && parsed.b === bgParsed.b) {
          return false;
        }
      }
      return true;
    },

    clearRect: vi.fn().mockImplementation(function(this: any, x: number, y: number, w: number, h: number) {
      const startX = Math.floor(x);
      const endX = Math.ceil(x + w);
      const startY = Math.floor(y);
      const endY = Math.ceil(y + h);
      for (let px = startX; px < endX; px++) {
        for (let py = startY; py < endY; py++) {
          this._virtualGrid.delete(`${px},${py}`);
        }
      }
    }),
    
    fillRect: vi.fn().mockImplementation(function(this: any, x: number, y: number, w: number, h: number) {
      const startX = Math.floor(x);
      const endX = Math.ceil(x + w);
      const startY = Math.floor(y);
      const endY = Math.ceil(y + h);
      const fillStyle = this.fillStyle || '#000000';
      
      const canvasW = this.canvas?.width || 0;
      const canvasH = this.canvas?.height || 0;
      if (canvasW > 0 && canvasH > 0 && w >= canvasW - 10 && h >= canvasH - 10) {
        this._bgColor = fillStyle;
      }
      
      for (let px = startX; px < endX; px++) {
        for (let py = startY; py < endY; py++) {
          this._virtualGrid.set(`${px},${py}`, fillStyle);
        }
      }
    }),
    
    roundRect: vi.fn().mockImplementation(function(this: any, x: number, y: number, w: number, h: number, _r?: any) {
      this._segments.push({ type: 'rect', x, y, w, h });
    }),
    
    beginPath: vi.fn().mockImplementation(function(this: any) {
      this._segments = [];
      this._currentPoint = { x: 0, y: 0 };
    }),
    
    fill: vi.fn().mockImplementation(function(this: any) {
      const fillStyle = this.fillStyle || '#000000';
      for (const segment of this._segments) {
        if (segment.type === 'rect') {
          const { x, y, w, h } = segment;
          const startX = Math.floor(x);
          const endX = Math.ceil(x + w);
          const startY = Math.floor(y);
          const endY = Math.ceil(y + h);
          for (let px = startX; px < endX; px++) {
            for (let py = startY; py < endY; py++) {
              this._virtualGrid.set(`${px},${py}`, fillStyle);
            }
          }
        } else if (segment.type === 'arc') {
          const { cx, cy, r } = segment;
          const startX = Math.floor(cx - r);
          const endX = Math.ceil(cx + r);
          const startY = Math.floor(cy - r);
          const endY = Math.ceil(cy + r);
          for (let px = startX; px < endX; px++) {
            for (let py = startY; py < endY; py++) {
              const dx = px - cx;
              const dy = py - cy;
              if (dx * dx + dy * dy <= r * r) {
                this._virtualGrid.set(`${px},${py}`, fillStyle);
              }
            }
          }
        } else if (segment.type === 'points' && segment.points && segment.points.length > 0) {
          const xs = segment.points.map((p: any) => p.x);
          const ys = segment.points.map((p: any) => p.y);
          const minX = Math.floor(Math.min(...xs));
          const maxX = Math.ceil(Math.max(...xs));
          const minY = Math.floor(Math.min(...ys));
          const maxY = Math.ceil(Math.max(...ys));
          for (let px = minX; px < maxX; px++) {
            for (let py = minY; py < maxY; py++) {
              this._virtualGrid.set(`${px},${py}`, fillStyle);
            }
          }
        }
      }
    }),
    
    arc: vi.fn().mockImplementation(function(this: any, cx: number, cy: number, r: number, _startAngle?: any, _endAngle?: any) {
      this._segments.push({ type: 'arc', cx, cy, r });
    }),
    
    rect: vi.fn().mockImplementation(function(this: any, x: number, y: number, w: number, h: number) {
      this._segments.push({ type: 'rect', x, y, w, h });
    }),
    
    save: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(),
    
    moveTo: vi.fn().mockImplementation(function(this: any, x: number, y: number) {
      this._currentPoint = { x, y };
      this._segments.push({ type: 'points', points: [{ x, y }] });
    }),
    
    lineTo: vi.fn().mockImplementation(function(this: any, x: number, y: number) {
      let lastSeg = this._segments[this._segments.length - 1];
      if (!lastSeg || lastSeg.type !== 'points') {
        lastSeg = { type: 'points', points: [this._currentPoint || { x, y }] };
        this._segments.push(lastSeg);
      }
      lastSeg.points.push({ x, y });
      this._currentPoint = { x, y };
    }),
    
    closePath: vi.fn(),
    
    bezierCurveTo: vi.fn().mockImplementation(function(this: any, cpx1: number, cpy1: number, cpx2: number, cpy2: number, x: number, y: number) {
      let lastSeg = this._segments[this._segments.length - 1];
      if (!lastSeg || lastSeg.type !== 'points') {
        lastSeg = { type: 'points', points: [this._currentPoint || { x, y }] };
        this._segments.push(lastSeg);
      }
      lastSeg.points.push({ x: cpx1, y: cpy1 });
      lastSeg.points.push({ x: cpx2, y: cpy2 });
      lastSeg.points.push({ x, y });
      this._currentPoint = { x, y };
    }),
    
    quadraticCurveTo: vi.fn().mockImplementation(function(this: any, cpx: number, cpy: number, x: number, y: number) {
      let lastSeg = this._segments[this._segments.length - 1];
      if (!lastSeg || lastSeg.type !== 'points') {
        lastSeg = { type: 'points', points: [this._currentPoint || { x, y }] };
        this._segments.push(lastSeg);
      }
      lastSeg.points.push({ x: cpx, y: cpy });
      lastSeg.points.push({ x, y });
      this._currentPoint = { x, y };
    }),
    
    setLineDash: vi.fn(),
    strokeRect: vi.fn(),
    stroke: vi.fn().mockImplementation(function(this: any) {
      this.fill();
    }),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 0 }),
    
    getImageData: vi.fn().mockImplementation(function(this: any, x: number, y: number, w: number, h: number) {
      const data = new Uint8ClampedArray(w * h * 4);
      const defaultBg = this._bgColor ? parseColor(this._bgColor) : { r: 255, g: 255, b: 255, a: 255 };
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          const px = Math.floor(x + i);
          const py = Math.floor(y + j);
          const colorStr = this._virtualGrid.get(`${px},${py}`);
          const color = colorStr ? parseColor(colorStr) : defaultBg;
          
          const idx = (j * w + i) * 4;
          data[idx] = color.r;
          data[idx + 1] = color.g;
          data[idx + 2] = color.b;
          data[idx + 3] = color.a;
        }
      }
      return {
        data,
        width: w,
        height: h,
      };
    }),
    
    putImageData: vi.fn(),
    createImageData: vi.fn().mockReturnValue([]),
    setTransform: vi.fn(),
    transform: vi.fn(),
    clip: vi.fn(),
    canvas: canvasEl || { width: 0, height: 0 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
  };

  return ctx;
};

HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(function (this: HTMLCanvasElement, contextId: string) {
  if (contextId === '2d') {
    if (!(this as any)._mockContext) {
      (this as any)._mockContext = createMockContext(this);
    }
    return (this as any)._mockContext;
  }
  return null;
}) as any;

if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    width: number;
    height: number;
    _mockContext: any = null;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(contextId: string) {
      if (contextId === '2d') {
        if (!this._mockContext) {
          this._mockContext = createMockContext(this);
        }
        return this._mockContext;
      }
      return null;
    }
  } as any;
}

const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tagName: string, options?: ElementCreationOptions) => {
  const el = originalCreateElement(tagName, options);
  if (tagName.toLowerCase() === 'canvas') {
    (el as HTMLCanvasElement).getContext = HTMLCanvasElement.prototype.getContext;
  }
  return el;
});

if (!HTMLCanvasElement.prototype.toBlob) {
  HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback, _type?: string, _quality?: any) {
    setTimeout(() => callback(new Blob([])), 0);
  };
}

if (!HTMLCanvasElement.prototype.toDataURL) {
  HTMLCanvasElement.prototype.toDataURL = function () {
    return 'data:image/png;base64,mock';
  };
}

import http from 'node:http';
import https from 'node:https';

const originalHttpRequest = http.request;
const originalHttpGet = http.get;
const originalHttpsRequest = https.request;
const originalHttpsGet = https.get;

function isUrlAllowed(input: any): boolean {
  if (!input) return true;
  let urlStr = '';
  if (typeof input === 'string') {
    urlStr = input;
  } else if (typeof input === 'object' && input !== null) {
    if ('url' in input) {
      urlStr = input.url;
    } else if (typeof input.toString === 'function') {
      urlStr = input.toString();
    }
  }

  if (!urlStr.includes('://') && !urlStr.startsWith('//')) {
    return true;
  }

  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.localhost')
    );
  } catch {
    return true;
  }
}

function verifyNodeUrl(options: any) {
  let host = '';
  if (typeof options === 'string') {
    try {
      const u = new URL(options);
      host = u.hostname;
    } catch {
      host = options;
    }
  } else if (options) {
    host = options.hostname || options.host || '';
    if (host.includes(':')) {
      host = host.split(':')[0];
    }
  }

  if (host) {
    const lowerHost = host.toLowerCase();
    if (
      lowerHost !== 'localhost' &&
      lowerHost !== '127.0.0.1' &&
      lowerHost !== '0.0.0.0' &&
      !lowerHost.endsWith('.localhost') &&
      lowerHost !== ''
    ) {
      throw new Error(`Unmocked external network request to http://${host} is blocked in the sandboxed test environment.`);
    }
  }
}

http.request = function (this: any, options: any, ...args: any[]) {
  verifyNodeUrl(options);
  return (originalHttpRequest as any).apply(this, [options, ...args]);
} as any;

http.get = function (this: any, options: any, ...args: any[]) {
  verifyNodeUrl(options);
  return (originalHttpGet as any).apply(this, [options, ...args]);
} as any;

https.request = function (this: any, options: any, ...args: any[]) {
  verifyNodeUrl(options);
  return (originalHttpsRequest as any).apply(this, [options, ...args]);
} as any;

https.get = function (this: any, options: any, ...args: any[]) {
  verifyNodeUrl(options);
  return (originalHttpsGet as any).apply(this, [options, ...args]);
} as any;

global.fetch = vi.fn().mockImplementation((input: any) => {
  if (!isUrlAllowed(input)) {
    throw new Error(`Unmocked external network request to ${input} is blocked in the sandboxed test environment.`);
  }
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    blob: () => Promise.resolve(new Blob()),
    text: () => Promise.resolve(''),
  });
}) as any;

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
} else {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
}

if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = vi.fn();
} else {
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
}

// ---------------------------------------------------------------------------
// QRCanvas runtime: jsdom has no real Web Workers, so the canvas encodes with the
// real encoder (loaded synchronously from src/wasm/) and builds mazes on the main
// thread. Tests that need a fake encoder inject one locally with setQrCanvasRuntime.
// ---------------------------------------------------------------------------

setQrCanvasRuntime({
  createMatrixWorker: () => null,
  createMazeWorker: () => null,
  loadEncoder: () => qrEncoder,
});

const originalImage = window.Image;

afterEach(async () => {
  // Restore specific global state used across canvas tests
  window.Image = originalImage;
  if (globalThis.mockWorkerControl) {
    globalThis.mockWorkerControl.reset();
  }
  terminateScannerWorker();
  const [{ clearRetainedAppearance }, { clearRetainedInputStates }] = await Promise.all([
    import('./src/context/QRContext'),
    import('./src/components/inputs/useInputLogic'),
  ]);
  clearRetainedAppearance();
  clearRetainedInputStates();
});
