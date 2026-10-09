import { renderHook, act, waitFor } from '@testing-library/react';
import { useImageUpload, UNDRAWABLE_SVG_MESSAGE } from './useImageUpload';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as security from '../utils/security';
import * as imageResizeHelper from '../utils/imageResizeHelper';

describe('useImageUpload', () => {
  beforeEach(() => {
    vi.spyOn(security, 'validateImageUpload').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sets error if validation fails', () => {
    vi.spyOn(security, 'validateImageUpload').mockReturnValue('Validation failed');
    const { result } = renderHook(() => useImageUpload());
    const onSuccess = vi.fn();

    const file = new File(['dummy content'], 'test.png', { type: 'image/png' });
    const event = { target: { files: [file], value: 'test.png' } } as unknown as React.ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleUpload(event, onSuccess);
    });

    expect(event.target.value).toBe('');
    expect(result.current.error).toBe('Validation failed');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('handles SVG upload with sanitization and bypasses resizer', () => {
    const { result } = renderHook(() => useImageUpload());
    const onSuccess = vi.fn();

    const mockReadAsText = vi.fn();
    const mockFileReaderInstance = {
      readAsText: mockReadAsText,
      onload: null as any,
    };

    class MockFileReader {
      onload: any = null;
      readAsText(file: File) {
        mockReadAsText(file);
        mockFileReaderInstance.onload = (e: any) => {
          if (this.onload) this.onload(e);
        };
      }
    }

    const originalFileReader = global.FileReader;
    global.FileReader = MockFileReader as any;

    const spySanitize = vi.spyOn(security, 'sanitizeSvg').mockReturnValue('<svg xmlns="http://www.w3.org/2000/svg" />');
    const spyOffThread = vi.spyOn(imageResizeHelper, 'processImageOffThread');
    const spyOnMainThread = vi.spyOn(imageResizeHelper, 'processImageOnMainThread');

    const file = new File(['<svg><script>alert(1)</script></svg>'], 'test.svg', { type: 'image/svg+xml' });
    const event = { target: { files: [file], value: 'test.svg' } } as unknown as React.ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleUpload(event, onSuccess);
    });

    expect(event.target.value).toBe('');
    expect(security.validateImageUpload).toHaveBeenCalledWith(file);
    expect(mockReadAsText).toHaveBeenCalledWith(file);

    act(() => {
      if (mockFileReaderInstance.onload) {
        mockFileReaderInstance.onload({ target: { result: '<svg><script>alert(1)</script></svg>' } } as any);
      }
    });

    expect(spySanitize).toHaveBeenCalledWith('<svg><script>alert(1)</script></svg>');
    const expectedBase64 = btoa(unescape(encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" />')));
    expect(onSuccess).toHaveBeenCalledWith(`data:image/svg+xml;base64,${expectedBase64}`);
    expect(result.current.error).toBeNull();

    // Verify SVG completely bypassed off-thread and main-thread resizer pipelines
    expect(spyOffThread).not.toHaveBeenCalled();
    expect(spyOnMainThread).not.toHaveBeenCalled();

    global.FileReader = originalFileReader;
  });

  it.each([
    ['malformed markup', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></svg>'],
    ['no xmlns', '<svg><rect width="10" height="10" /></svg>'],
  ])('rejects an SVG upload the browser cannot draw (%s) and keeps the current logo (#1257)', async (_case, svg) => {
    const { result } = renderHook(() => useImageUpload());
    const onSuccess = vi.fn();
    const file = new File([svg], 'logo.svg', { type: 'image/svg+xml' });
    const event = { target: { files: [file], value: 'logo.svg' } } as unknown as React.ChangeEvent<HTMLInputElement>;

    act(() => {
      result.current.handleUpload(event, onSuccess);
    });

    await waitFor(() => expect(result.current.error).toBe(UNDRAWABLE_SVG_MESSAGE));
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('handles valid image upload off-thread on high-tier devices', async () => {
    vi.spyOn(imageResizeHelper, 'isLowTierDevice').mockReturnValue(false);
    vi.spyOn(imageResizeHelper, 'isOffThreadSupported').mockReturnValue(true);
    const spyProcessOffThread = vi.spyOn(imageResizeHelper, 'processImageOffThread').mockResolvedValue('data:image/webp;base64,highTierOptimized');
    const spyProcessMainThread = vi.spyOn(imageResizeHelper, 'processImageOnMainThread');

    const { result } = renderHook(() => useImageUpload());
    const onSuccess = vi.fn();

    const file = new File(['dummy content'], 'test.png', { type: 'image/png' });
    const event = { target: { files: [file], value: 'test.png' } } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      result.current.handleUpload(event, onSuccess);
    });

    expect(event.target.value).toBe('');
    expect(security.validateImageUpload).toHaveBeenCalledWith(file);
    expect(spyProcessOffThread).toHaveBeenCalledWith(file, 1200);
    expect(spyProcessMainThread).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith('data:image/webp;base64,highTierOptimized');
    expect(result.current.error).toBeNull();
  });

  it('handles valid image upload off-thread on low-tier devices with 600px clamp', async () => {
    vi.spyOn(imageResizeHelper, 'isLowTierDevice').mockReturnValue(true);
    vi.spyOn(imageResizeHelper, 'isOffThreadSupported').mockReturnValue(true);
    const spyProcessOffThread = vi.spyOn(imageResizeHelper, 'processImageOffThread').mockResolvedValue('data:image/webp;base64,lowTierOptimized');
    const spyProcessMainThread = vi.spyOn(imageResizeHelper, 'processImageOnMainThread');

    const { result } = renderHook(() => useImageUpload());
    const onSuccess = vi.fn();

    const file = new File(['dummy content'], 'test.png', { type: 'image/png' });
    const event = { target: { files: [file], value: 'test.png' } } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      result.current.handleUpload(event, onSuccess);
    });

    expect(spyProcessOffThread).toHaveBeenCalledWith(file, 600);
    expect(spyProcessMainThread).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith('data:image/webp;base64,lowTierOptimized');
    expect(result.current.error).toBeNull();
  });

  it('falls back to main thread when off-thread fails', async () => {
    vi.spyOn(imageResizeHelper, 'isLowTierDevice').mockReturnValue(false);
    vi.spyOn(imageResizeHelper, 'isOffThreadSupported').mockReturnValue(true);
    vi.spyOn(imageResizeHelper, 'processImageOffThread').mockRejectedValue(new Error('Worker initialization failed'));
    const spyProcessMainThread = vi.spyOn(imageResizeHelper, 'processImageOnMainThread').mockResolvedValue('data:image/webp;base64,fallbackOptimized');

    const { result } = renderHook(() => useImageUpload());
    const onSuccess = vi.fn();

    const file = new File(['dummy content'], 'test.png', { type: 'image/png' });
    const event = { target: { files: [file], value: 'test.png' } } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      result.current.handleUpload(event, onSuccess);
    });

    expect(spyProcessMainThread).toHaveBeenCalledWith(file, 1200);
    expect(onSuccess).toHaveBeenCalledWith('data:image/webp;base64,fallbackOptimized');
    expect(result.current.error).toBeNull();
  });

  it('falls back to main thread when off-thread is not supported', async () => {
    vi.spyOn(imageResizeHelper, 'isLowTierDevice').mockReturnValue(false);
    vi.spyOn(imageResizeHelper, 'isOffThreadSupported').mockReturnValue(false);
    const spyProcessOffThread = vi.spyOn(imageResizeHelper, 'processImageOffThread');
    const spyProcessMainThread = vi.spyOn(imageResizeHelper, 'processImageOnMainThread').mockResolvedValue('data:image/webp;base64,fallbackOptimized');

    const { result } = renderHook(() => useImageUpload());
    const onSuccess = vi.fn();

    const file = new File(['dummy content'], 'test.png', { type: 'image/png' });
    const event = { target: { files: [file], value: 'test.png' } } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      result.current.handleUpload(event, onSuccess);
    });

    expect(spyProcessOffThread).not.toHaveBeenCalled();
    expect(spyProcessMainThread).toHaveBeenCalledWith(file, 1200);
    expect(onSuccess).toHaveBeenCalledWith('data:image/webp;base64,fallbackOptimized');
    expect(result.current.error).toBeNull();
  });

  describe('isLowTierDevice capabilities utility', () => {
    it('detects low tier based on hardwareConcurrency', () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { hardwareConcurrency: 2 },
        writable: true,
        configurable: true
      });

      expect(imageResizeHelper.isLowTierDevice()).toBe(true);

      global.navigator = originalNavigator;
    });

    it('detects low tier based on deviceMemory', () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { hardwareConcurrency: 8, deviceMemory: 2 },
        writable: true,
        configurable: true
      });

      expect(imageResizeHelper.isLowTierDevice()).toBe(true);

      global.navigator = originalNavigator;
    });

    it('detects high tier when both values are sufficient', () => {
      const originalNavigator = global.navigator;
      Object.defineProperty(global, 'navigator', {
        value: { hardwareConcurrency: 8, deviceMemory: 8 },
        writable: true,
        configurable: true
      });

      expect(imageResizeHelper.isLowTierDevice()).toBe(false);

      global.navigator = originalNavigator;
    });
  });
});
