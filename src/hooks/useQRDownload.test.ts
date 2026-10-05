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

import { renderHook, waitFor } from '@testing-library/react';
import { ToastProvider } from '../components/ui/Toast';
import { useQRDownload, BLOCKED_EXPORT_MESSAGE } from './useQRDownload';
import { DEFAULT_CONFIG } from '../constants';
import { QRConfig, QRType, TemplateStyle, SocialFormat } from '../types';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fakeQrRead } from '../../tests/utils/fakeQrRead';

const qrRead = vi.hoisted(() => vi.fn());
vi.mock('@/packages/qr-decode', () => ({ loadQrReader: () => Promise.resolve({ read: qrRead }) }));

describe('useQRDownload', () => {
  let mockCanvas: HTMLCanvasElement;
  let mockQrRef: any;
  let originalShowSaveFilePicker: any;

  beforeEach(() => {
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com')]);

    // Setup mock canvas
    mockCanvas = document.createElement('canvas');
    mockCanvas.width = 100;
    mockCanvas.height = 100;
    mockCanvas.toDataURL = vi.fn(() => 'data:image/png;base64,mock');
    mockCanvas.toBlob = vi.fn((callback) => callback(new Blob(['mock']), 'image/png'));
    const mockCtx = {
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(40000),
        width: 100,
        height: 100,
      })),
    };
    mockCanvas.getContext = vi.fn(() => mockCtx as any);

    // Setup mock ref
    mockQrRef = {
      current: {
        querySelector: vi.fn(() => mockCanvas),
      },
    };

    // Mock URL methods
    global.URL.createObjectURL = vi.fn(() => 'mock-url');
    global.URL.revokeObjectURL = vi.fn();

    HTMLCanvasElement.prototype.getContext = function (this: any, contextId: string) {
      if (contextId === '2d') {
        return {
          canvas: this,
          drawImage: vi.fn(),
          getImageData: vi.fn().mockImplementation((x: number, y: number, w: number, h: number) => {
            const width = w || this.width || 100;
            const height = h || this.height || 100;
            return { data: new Uint8ClampedArray(width * height * 4), width, height };
          }),
        };
      }
      return null;
    } as any;

    // Store original globals
    originalShowSaveFilePicker = (global as any).showSaveFilePicker;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalShowSaveFilePicker) {
      (global as any).showSaveFilePicker = originalShowSaveFilePicker;
    } else {
      delete (global as any).showSaveFilePicker;
    }
  });

  it('downloadToDevice creates a download link and clicks it', async () => {
    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    await result.current.downloadToDevice('png');

    expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/png');
    expect(appendSpy).toHaveBeenCalled();
    const link = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.download).toMatch(/url-qr-code-qrcraftly-.*\.png/);
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith(link);
  });

  it('handleSaveAs uses File System Access API if available', async () => {
    const mockHandle = {
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    };
    const showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);
    (global as any).showSaveFilePicker = showSaveFilePicker;

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

    await result.current.handleSaveAs('png');

    expect(showSaveFilePicker).toHaveBeenCalled();
    expect(mockHandle.createWritable).toHaveBeenCalled();
  });

  it('handleSaveAs falls back to downloadToDevice if File System Access API fails', async () => {
    (global as any).showSaveFilePicker = vi.fn().mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Spy on internal downloadToDevice call indirectly via document append
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    await result.current.handleSaveAs('png');

    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalled();
  });

  it('handleSaveAs returns early if canvas is not found', async () => {
    const emptyRef = { current: { querySelector: vi.fn(() => null) } } as any;
    const { result } = renderHook(() => useQRDownload(emptyRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    await result.current.handleSaveAs('png');

    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('downloadToDevice returns failure when canvas is not found', async () => {
    const emptyRef = { current: null } as any;
    const { result } = renderHook(() => useQRDownload(emptyRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
    const res = await result.current.downloadToDevice('png');
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
  });

  it('downloadToDevice catches toDataURL error', async () => {
    const errorCanvas = {
      getContext: vi.fn(() => ({
        getImageData: vi.fn(() => ({
          data: new Uint8ClampedArray(40000),
          width: 100,
          height: 100,
        })),
      })),
      width: 100,
      height: 100,
      toDataURL: vi.fn().mockImplementation(() => {
        throw new Error('toDataURL throw');
      }),
    };
    const errRef = { current: { querySelector: () => errorCanvas } } as any;
    const { result } = renderHook(() => useQRDownload(errRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
    const res = await result.current.downloadToDevice('png');
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    expect(res.error?.message).toBe('toDataURL throw');
  });

  it('handleSaveAs falls back to downloadToDevice if File System Access API is not available', async () => {
    const tempOriginal = (global as any).showSaveFilePicker;
    delete (global as any).showSaveFilePicker;

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

    const appendSpy = vi.spyOn(document.body, 'appendChild');

    await result.current.handleSaveAs('png');

    expect(appendSpy).toHaveBeenCalled();

    (global as any).showSaveFilePicker = tempOriginal;
  });

  it('handleSaveAs throws error when toBlob fails', async () => {
    mockCanvas.toBlob = vi.fn((callback) => callback(null));
    const showSaveFilePicker = vi.fn();
    (global as any).showSaveFilePicker = showSaveFilePicker;

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await result.current.handleSaveAs('png');

    expect(consoleWarnSpy).toHaveBeenCalledWith('File System Access API failed, falling back to standard download:', expect.any(Error));
  });

  it('handleSaveAs aborts silently if AbortError is thrown', async () => {
    const abortError = new Error('Abort');
    abortError.name = 'AbortError';
    (global as any).showSaveFilePicker = vi.fn().mockRejectedValue(abortError);

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    await result.current.handleSaveAs('png');

    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('handleShare uses Web Share API', async () => {
    const mockShare = vi.fn().mockResolvedValue(undefined);
    const mockCanShare = vi.fn().mockReturnValue(true);

    Object.defineProperty(global.navigator, 'share', {
      value: mockShare,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global.navigator, 'canShare', {
      value: mockCanShare,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

    await result.current.handleShare();

    await waitFor(() => {
        expect(mockShare).toHaveBeenCalled();
    });
  });

  it('handleShare catches and logs errors when sharing fails', async () => {
    const mockError = new Error('Sharing failed');
    const mockShare = vi.fn().mockRejectedValue(mockError);
    const mockCanShare = vi.fn().mockReturnValue(true);

    Object.defineProperty(global.navigator, 'share', {
      value: mockShare,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global.navigator, 'canShare', {
      value: mockCanShare,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await result.current.handleShare();

    await waitFor(() => {
        expect(mockShare).toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith('Error sharing:', mockError);
    });
  });

  it('handleShare aborts silently if toBlob returns null', async () => {
    mockCanvas.toBlob = vi.fn((callback) => callback(null));

    const mockShare = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, 'share', {
      value: mockShare,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(global.navigator, 'canShare', {
      value: vi.fn().mockReturnValue(true),
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

    await result.current.handleShare();

    expect(mockShare).not.toHaveBeenCalled();
  });

  it('handleShare falls back if sharing not supported', async () => {
    Object.defineProperty(global.navigator, 'share', {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    await result.current.handleShare();

    expect(appendSpy).toHaveBeenCalled();
  });

  it('handleSaveSvg triggers a download with an .svg file', async () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click');

    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

    await result.current.handleSaveSvg();

    expect(global.URL.createObjectURL).toHaveBeenCalled();

    // Find the <a> element among all appended children
    const appendedElements = appendSpy.mock.calls.map(call => call[0] as Element);
    const link = appendedElements.find(el => el.tagName === 'A') as HTMLAnchorElement;
    expect(link).toBeDefined();
    expect((link as HTMLAnchorElement).download).toMatch(/url-qr-code-qrcraftly-.*\.svg/);
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith(link);
    expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  });

  it('names the SVG after the chosen file name and copies the SVG markup as text (#1052)', async () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, 'clipboard', { value: { writeText }, writable: true, configurable: true });
    const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

    await result.current.exportAsset('svg', { filename: 'menu card' });
    const link = appendSpy.mock.calls.map((call) => call[0] as Element).find((el) => el.tagName === 'A') as HTMLAnchorElement;
    expect(link.download).toBe('menu-card.svg');

    const copied = await result.current.exportAsset('svg-copy');
    expect(copied).toMatchObject({ success: true, format: 'svg-copy' });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('<svg'));
  });

  it('handleSaveSvg catches and logs errors when Blob generation fails', async () => {
    // We mock the Blob constructor to throw an error to test the catch block.
    const originalBlob = global.Blob;
    global.Blob = vi.fn().mockImplementation(function() {
      throw new Error('Blob Error');
    });

    try {
      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const status = await result.current.handleSaveSvg();
      expect(status).toEqual({ success: false, format: 'svg', error: expect.any(Error) });

      expect(consoleWarnSpy).toHaveBeenCalledWith('SVG export failed:', expect.any(Error));
    } finally {
      global.Blob = originalBlob;
    }
  });

  it('handleSaveSvg returns logoOmitted: true if remote logo fetch fails', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    } as any);

    try {
      const configWithLogo: QRConfig = {
        ...(DEFAULT_CONFIG as QRConfig),
        logoUrl: 'https://example.com/error-logo.png',
      };

      const { result } = renderHook(() => useQRDownload(mockQrRef, configWithLogo), { wrapper: ToastProvider });
      const status = await result.current.handleSaveSvg();

      expect(status.success).toBe(true);
      expect(status.logoOmitted).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  describe('handleCopy', () => {
    let originalClipboardItem: any;
    let originalClipboard: any;

    beforeEach(() => {
      originalClipboardItem = (global as any).ClipboardItem;
      originalClipboard = global.navigator.clipboard;
    });

    afterEach(() => {
      (global as any).ClipboardItem = originalClipboardItem;
      Object.defineProperty(global.navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
        configurable: true,
      });
    });

    it('copies to clipboard when supported', async () => {
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(global.navigator, 'clipboard', {
        value: { write: mockWrite },
        writable: true,
        configurable: true,
      });

      const MockClipboardItem = vi.fn().mockImplementation(function(this: any, data) { this.data = data; });
      (global as any).ClipboardItem = MockClipboardItem;

      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

      const status = await result.current.handleCopy();

      expect(status).toEqual({ success: true, format: 'clipboard' });
      expect(mockCanvas.toBlob).toHaveBeenCalled();
      expect(MockClipboardItem).toHaveBeenCalledWith(expect.objectContaining({ 'image/png': expect.any(Blob) }));
      expect(mockWrite).toHaveBeenCalled();
    });

    it('returns unsuccessful status if canvas is not found', async () => {
      const emptyRef = { current: { querySelector: vi.fn(() => null) } } as any;
      const { result } = renderHook(() => useQRDownload(emptyRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

      const status = await result.current.handleCopy();
      expect(status.success).toBe(false);
      expect(status.format).toBe('clipboard');
    });

    it('returns unsuccessful status if ClipboardItem is not supported', async () => {
      (global as any).ClipboardItem = undefined;
      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

      const status = await result.current.handleCopy();
      expect(status.success).toBe(false);
      expect(status.format).toBe('clipboard');
    });

    it('returns unsuccessful status and logs warning if write fails', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockWrite = vi.fn().mockRejectedValue(new Error('Clipboard error'));
      Object.defineProperty(global.navigator, 'clipboard', {
        value: { write: mockWrite },
        writable: true,
        configurable: true,
      });

      const MockClipboardItem = vi.fn().mockImplementation(function(this: any, data) { this.data = data; });
      (global as any).ClipboardItem = MockClipboardItem;

      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

      const status = await result.current.handleCopy();

      expect(status.success).toBe(false);
      expect(status.format).toBe('clipboard');
      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to copy to clipboard:', expect.any(Error));
    });
  });

  describe('scannability validation before asset export', () => {
    it('blocks downloadToDevice if scannability validation fails', async () => {
      qrRead.mockReturnValue([]);

      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

      const status = await result.current.downloadToDevice('png');
      expect(status.success).toBe(false);
      expect(status.error?.message).toBe('SCAN_VALIDATION_FAILED');
    });

    it('blocks handleSaveAs if scannability validation fails', async () => {
      qrRead.mockReturnValue([]);

      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

      const status = await result.current.handleSaveAs('png');
      expect(status.success).toBe(false);
      expect(status.error?.message).toBe('SCAN_VALIDATION_FAILED');
    });

    it('blocks handleCopy if scannability validation fails', async () => {
      qrRead.mockReturnValue([]);

      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

      const status = await result.current.handleCopy();
      expect(status.success).toBe(false);
      expect(status.error?.message).toBe('SCAN_VALIDATION_FAILED');
    });

    it('blocks handleShare if scannability validation fails', async () => {
      qrRead.mockReturnValue([]);

      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

      const status = await result.current.handleShare();
      expect(status.success).toBe(false);
      expect(status.error?.message).toBe('SCAN_VALIDATION_FAILED');
    });

    it('blocks handleSaveSvg if scannability validation fails', async () => {
      qrRead.mockReturnValue([]);

      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

      const status = await result.current.handleSaveSvg();
      expect(status.success).toBe(false);
      expect(status.error?.message).toBe('SCAN_VALIDATION_FAILED');
    });

    it.each(['png', 'jpeg', 'webp', 'svg', 'clipboard', 'share'] as const)(
      'blocks exportAsset(%s) if scannability validation fails and allowUnsafe is not set',
      async (format) => {
        qrRead.mockReturnValue([]);
        const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

        const status = await result.current.exportAsset(format);
        expect(status.success).toBe(false);
        expect(status.error?.message).toBe('SCAN_VALIDATION_FAILED');
      }
    );

    it.each(['png', 'jpeg', 'webp', 'svg', 'clipboard', 'share'] as const)(
      'blocks exportAsset(%s) if allowUnsafe is explicitly false and validation fails',
      async (format) => {
        qrRead.mockReturnValue([]);
        const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });

        const status = await result.current.exportAsset(format, { allowUnsafe: false });
        expect(status.success).toBe(false);
        expect(status.error?.message).toBe('SCAN_VALIDATION_FAILED');
      }
    );
  });

  describe('gated scannability bypass ({ allowUnsafe: true })', () => {
    let originalClipboardItem: any;
    let originalClipboard: any;
    let originalShare: any;
    let originalCanShare: any;

    beforeEach(() => {
      qrRead.mockReturnValue([]); // Scan verification always fails

      originalClipboardItem = (global as any).ClipboardItem;
      originalClipboard = global.navigator.clipboard;
      originalShare = global.navigator.share;
      originalCanShare = global.navigator.canShare;

      // Mock Clipboard
      const mockWrite = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(global.navigator, 'clipboard', {
        value: { write: mockWrite },
        writable: true,
        configurable: true,
      });
      const MockClipboardItem = vi.fn().mockImplementation(function(this: any, data) { this.data = data; });
      (global as any).ClipboardItem = MockClipboardItem;

      // Mock Web Share
      const mockShare = vi.fn().mockResolvedValue(undefined);
      const mockCanShare = vi.fn().mockReturnValue(true);
      Object.defineProperty(global.navigator, 'share', {
        value: mockShare,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(global.navigator, 'canShare', {
        value: mockCanShare,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      (global as any).ClipboardItem = originalClipboardItem;
      Object.defineProperty(global.navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(global.navigator, 'share', {
        value: originalShare,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(global.navigator, 'canShare', {
        value: originalCanShare,
        writable: true,
        configurable: true,
      });
    });

    it.each(['png', 'jpeg', 'webp'] as const)(
      'downloadToDevice(%s) succeeds when allowUnsafe: true even if scannability fails',
      async (format) => {
        const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
        const status = await result.current.downloadToDevice(format, { allowUnsafe: true });
        expect(status.success).toBe(true);
        expect(status.format).toBe(format);
      }
    );

    it.each(['png', 'jpeg', 'webp'] as const)(
      'handleSaveAs(%s) succeeds when allowUnsafe: true even if scannability fails',
      async (format) => {
        const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
        const status = await result.current.handleSaveAs(format, { allowUnsafe: true });
        expect(status.success).toBe(true);
        expect(status.format).toBe(format);
      }
    );

    it('handleSaveSvg succeeds when allowUnsafe: true even if scannability fails', async () => {
      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
      const status = await result.current.handleSaveSvg({ allowUnsafe: true });
      expect(status.success).toBe(true);
      expect(status.format).toBe('svg');
    });

    it('handleCopy succeeds when allowUnsafe: true even if scannability fails', async () => {
      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
      const status = await result.current.handleCopy({ allowUnsafe: true });
      expect(status.success).toBe(true);
      expect(status.format).toBe('clipboard');
    });

    it('handleShare succeeds when allowUnsafe: true even if scannability fails', async () => {
      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
      const status = await result.current.handleShare({ allowUnsafe: true });
      expect(status.success).toBe(true);
      expect(status.format).toBe('share');
    });

    it.each(['png', 'jpeg', 'webp', 'svg', 'clipboard', 'share'] as const)(
      'exportAsset(%s) succeeds when allowUnsafe: true even if scannability fails',
      async (format) => {
        const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
        const status = await result.current.exportAsset(format, { allowUnsafe: true });
        expect(status.success).toBe(true);
        expect(status.format).toBe(format);
      }
    );

    it.each(['png', 'jpeg', 'webp'] as const)(
      'exportAsset(%s) triggers direct download when directDownload: true',
      async (format) => {
        const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
        const appendSpy = vi.spyOn(document.body, 'appendChild');
        const status = await result.current.exportAsset(format, { allowUnsafe: true, directDownload: true });
        expect(status.success).toBe(true);
        expect(status.format).toBe(format);
        expect(appendSpy).toHaveBeenCalled();
      }
    );
  });

  describe('dangerous content (hard export block)', () => {
    const dangerous = { ...DEFAULT_CONFIG, type: QRType.TEXT, value: 'javascript:alert(1)' } as QRConfig;

    it.each(['png', 'svg', 'clipboard', 'share'] as const)('refuses %s even with allowUnsafe', async (format) => {
      const { result } = renderHook(() => useQRDownload(mockQrRef, dangerous), { wrapper: ToastProvider });
      const status = await result.current.exportAsset(format, { allowUnsafe: true });
      expect(status.success).toBe(false);
      expect(status.error?.message).toBe(BLOCKED_EXPORT_MESSAGE);
      expect(mockCanvas.toDataURL).not.toHaveBeenCalled();
    });

    it('refuses template and social-format exports, which skip the scannability check', async () => {
      const templated = { ...dangerous, templateStyle: TemplateStyle.SOLID_FRAME, socialFormat: SocialFormat.STORY_9_16 } as QRConfig;
      const { result } = renderHook(() => useQRDownload(mockQrRef, templated), { wrapper: ToastProvider });
      const status = await result.current.exportAsset('png', { allowUnsafe: true, directDownload: true });
      expect(status.success).toBe(false);
      expect(status.error?.message).toBe(BLOCKED_EXPORT_MESSAGE);
    });

    it('still exports ordinary content', async () => {
      const { result } = renderHook(() => useQRDownload(mockQrRef, DEFAULT_CONFIG as QRConfig), { wrapper: ToastProvider });
      const status = await result.current.exportAsset('png', { directDownload: true });
      expect(status.success).toBe(true);
    });
  });
});
