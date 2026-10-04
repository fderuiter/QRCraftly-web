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

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { useOpticalReceiver } from '../client';
import {
  PrismStream,
  TRANSFER_DENSITY_PROFILES,
  createFountainSession,
  createPrismSession,
  crc32,
  crc32c,
  decodeBase45,
  encodeBase45,
  encodeDataFrame,
} from '../index';
import { receiverOptions } from './fixtures';

const balanced = TRANSFER_DENSITY_PROFILES.balanced;
const text = (value: string) => new TextEncoder().encode(value);

async function streamFor(content: string, fileName = 'note.txt', mimeType = 'text/plain') {
  const { stream } = await createPrismSession(text(content), {
    fileName,
    mimeType,
    errorCorrectionLevel: balanced.errorCorrectionLevel,
    maxVersion: balanced.maxVersion,
  });
  return stream;
}

describe('useOpticalReceiver', () => {

  beforeEach(() => {
    vi.clearAllMocks();
    global.URL.createObjectURL = vi.fn(() => 'mock-download-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with standard defaults', () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    expect(result.current.manifest).toBeNull();
    expect(result.current.fountainStats).toBeNull();
    expect(result.current.receiverError).toBeNull();
    expect(result.current.isScanning).toBe(false);
  });

  it('ignores every code that is not part of a transfer without waking the worker', async () => {
    const posted: string[] = [];
    globalThis.mockWorkerControl.setInterceptor((message: { type: string }) => posted.push(message.type));
    try {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));
      for (const other of ['https://example.com', 'javascript:alert(1)', 'H|test.txt|6|text/plain|abc', 'F|0|2|Zm9v', 'lowercase text']) {
        await act(async () => {
          result.current.handleFrame(other);
        });
      }
      expect(posted).not.toContain('FOUNTAIN_DROPLET');
      expect(result.current.fountainStats).toBeNull();
      expect(result.current.receiverError).toBeNull();
    } finally {
      globalThis.mockWorkerControl.setInterceptor(null);
    }
  });

  it('shows the file name, size and type from the first manifest frame', async () => {
    const stream = await streamFor('hello prism '.repeat(40), 'hello.txt');
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    await act(async () => {
      result.current.handleFrame(stream.frameText(0));
    });

    await waitFor(() => expect(result.current.manifest).not.toBeNull());
    expect(result.current.manifest).toMatchObject({ files: [{ name: 'hello.txt', mimeType: 'text/plain', size: 480 }], totalSize: 480 });
    expect(result.current.manifest?.fingerprint).toBe(stream.fingerprint);
    expect(result.current.receiverSuccess).toBe(false);
  });

  it('should compile, verify SHA-256, and reassemble files via background worker', async () => {
    const addToast = vi.fn();
    const options = receiverOptions({ addToast });
    const stream = await streamFor('Prism frames carry bytes. '.repeat(30));
    const { result } = renderHook(() => useOpticalReceiver(options));

    for (let i = 5; i < stream.k * 4 + 40 && !result.current.receiverSuccess; i++) {
      await act(async () => {
        result.current.handleFrame(stream.frameText(i));
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }
    await waitFor(() => expect(result.current.receiverSuccess).toBe(true));

    expect(options.saveFile).toHaveBeenCalledWith(expect.any(Uint8Array), 'note.txt', 'text/plain');
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('should abort download and emit toast error when the file SHA-256 does not match the manifest', async () => {
    const addToast = vi.fn();
    const options = receiverOptions({ addToast });
    const message = text('forged content');
    const stream = new PrismStream(message, {
      version: 1,
      files: [{ name: 'f.txt', size: message.length, mimeType: 'text/plain', sha256: '00'.repeat(32) }],
      compression: 'none',
      transferLength: message.length,
      symbolSize: 16,
      transferCrc32: crc32(message),
      salt: new Uint8Array(0),
      encryption: 0,
    });
    const { result } = renderHook(() => useOpticalReceiver(options));

    for (let i = 0; i < stream.k * 3 + 40 && !result.current.receiverError; i++) {
      await act(async () => {
        result.current.handleFrame(stream.frameText(i));
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }
    await waitFor(() => expect(result.current.receiverError).toContain('Integrity validation failed'));

    expect(result.current.receiverSuccess).toBe(false);
    expect(options.saveFile).not.toHaveBeenCalled();
  });

  it('keeps accepting frames after an error and clears it once decoding progresses', async () => {
    const stream = await streamFor('recover '.repeat(20));
    const posted: string[] = [];
    let first = true;
    globalThis.mockWorkerControl.setInterceptor((message: { type: string }, worker: { dispatchMessage: (m: unknown) => void }) => {
      posted.push(message.type);
      if (message.type !== 'FOUNTAIN_DROPLET') return;
      worker.dispatchMessage(
        first
          ? { type: 'ERROR', error: 'Something went wrong', isFountain: true }
          : { type: 'PROGRESS', progress: 10, current: 1, total: 10, rank: 1, dropletsReceived: 1, isFountain: true }
      );
      first = false;
    });
    try {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

      await act(async () => {
        result.current.handleFrame(stream.frameText(1));
      });
      await waitFor(() => expect(result.current.receiverError).toBe('Something went wrong'));

      await act(async () => {
        result.current.handleFrame(stream.frameText(2));
      });
      await waitFor(() => expect(result.current.receiverError).toBeNull());
      expect(posted.filter(type => type === 'FOUNTAIN_DROPLET')).toHaveLength(2);
    } finally {
      globalThis.mockWorkerControl.setInterceptor(null);
    }
  });

  it('tells the person when a stream uses a newer format version', async () => {
    const bytes = decodeBase45(encodeDataFrame({ sessionId: Uint8Array.from([1, 2, 3, 4, 5, 6]), firstSymbol: 1, symbols: [Uint8Array.from([9])] })) ?? new Uint8Array();
    bytes[0] = (bytes[0] & 0xf0) | 9;
    new DataView(bytes.buffer).setUint32(bytes.length - 4, crc32c(bytes.subarray(0, bytes.length - 4)));
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    await act(async () => {
      result.current.handleFrame(encodeBase45(bytes));
    });

    await waitFor(() => expect(result.current.receiverError).toMatch(/newer version/));
  });

  it('still receives a legacy ur:bytes stream', async () => {
    const options = receiverOptions();
    const { encoder } = await createFountainSession(text('legacy stream '.repeat(20)), { fileName: 'old.txt', mimeType: 'text/plain' });
    const { result } = renderHook(() => useOpticalReceiver(options));

    for (let i = 3; i < encoder.k * 4 + 20 && !result.current.receiverSuccess; i++) {
      await act(async () => {
        result.current.handleFrame(encoder.dropletStringForIndex(i));
        await new Promise(resolve => setTimeout(resolve, 0));
      });
    }
    await waitFor(() => expect(result.current.receiverSuccess).toBe(true));
    expect(options.saveFile).toHaveBeenCalledWith(expect.any(Uint8Array), 'old.txt', 'text/plain');
  });

  describe('Dual-Mode Receiver & Object URL Management', () => {
    it('should initialize in camera mode by default and allow mode toggling', () => {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

      expect(result.current.receiverMode).toBe('camera');
      expect(result.current.videoFile).toBeNull();
      expect(result.current.videoObjectUrl).toBeNull();

      act(() => {
        result.current.setReceiverMode('file');
      });

      expect(result.current.receiverMode).toBe('file');

      act(() => {
        result.current.setReceiverMode('camera');
      });

      expect(result.current.receiverMode).toBe('camera');
    });

    it('should load a valid video file, generate Object URL, and set scanning to true', () => {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ initialMode: 'file' })));
      const file = new File(['dummy video content'], 'test.mp4', { type: 'video/mp4' });

      act(() => {
        const success = result.current.handleFileUpload(file);
        expect(success).toBe(true);
      });

      expect(result.current.videoFile).toBe(file);
      expect(result.current.videoObjectUrl).toBe('mock-download-url');
      expect(result.current.fileValidationError).toBeNull();
      expect(result.current.isScanning).toBe(true);
      expect(global.URL.createObjectURL).toHaveBeenCalledWith(file);
    });

    it('rejects a video over the upload limit (#1154)', () => {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ initialMode: 'file' })));
      const file = new File(['x'], 'huge.mp4', { type: 'video/mp4' });
      Object.defineProperty(file, 'size', { value: 501 * 1024 * 1024 });

      act(() => {
        expect(result.current.handleFileUpload(file)).toBe(false);
      });

      expect(result.current.fileValidationError).toBe('This video is too large to scan. The limit is 500 MB.');
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should reject invalid file types, set fileValidationError, and block Object URL creation', () => {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ initialMode: 'file' })));
      const file = new File(['plain text'], 'document.txt', { type: 'text/plain' });

      act(() => {
        const success = result.current.handleFileUpload(file);
        expect(success).toBe(false);
      });

      expect(result.current.videoFile).toBeNull();
      expect(result.current.videoObjectUrl).toBeNull();
      expect(result.current.fileValidationError).toBe('Invalid file type. Please upload a supported video file (e.g. MP4, WebM).');
      expect(result.current.isScanning).toBe(false);
      expect(global.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should revoke Object URL when replacing an uploaded video file', () => {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ initialMode: 'file' })));
      const file1 = new File(['vid1'], 'video1.mp4', { type: 'video/mp4' });
      const file2 = new File(['vid2'], 'video2.webm', { type: 'video/webm' });

      act(() => {
        result.current.handleFileUpload(file1);
      });

      expect(result.current.videoObjectUrl).toBe('mock-download-url');

      act(() => {
        result.current.handleFileUpload(file2);
      });

      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-download-url');
      expect(result.current.videoFile).toBe(file2);
    });

    it('should revoke Object URL when toggling mode from file to camera', () => {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ initialMode: 'file' })));
      const file = new File(['vid'], 'video.mp4', { type: 'video/mp4' });

      act(() => {
        result.current.handleFileUpload(file);
      });

      expect(result.current.videoObjectUrl).toBe('mock-download-url');

      act(() => {
        result.current.setReceiverMode('camera');
      });

      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-download-url');
      expect(result.current.videoFile).toBeNull();
      expect(result.current.videoObjectUrl).toBeNull();
    });

    it('should revoke Object URL when hook unmounts', () => {
      const { result, unmount } = renderHook(() => useOpticalReceiver(receiverOptions({ initialMode: 'file' })));
      const file = new File(['vid'], 'video.mp4', { type: 'video/mp4' });

      act(() => {
        result.current.handleFileUpload(file);
      });

      unmount();

      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-download-url');
    });

    it('should revoke Object URL when handleClear is called', () => {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ initialMode: 'file' })));
      const file = new File(['vid'], 'video.mp4', { type: 'video/mp4' });

      act(() => {
        result.current.handleFileUpload(file);
      });

      act(() => {
        result.current.handleClear();
      });

      expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('mock-download-url');
      expect(result.current.videoFile).toBeNull();
      expect(result.current.videoObjectUrl).toBeNull();
      expect(result.current.fileValidationError).toBeNull();
    });
  });

  describe('camera session', () => {
    let originalMediaDevices: MediaDevices | undefined;
    let track: { stop: ReturnType<typeof vi.fn> };
    let getUserMedia: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      originalMediaDevices = navigator.mediaDevices;
      track = { stop: vi.fn() };
      getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true, writable: true });
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true, writable: true });
    });

    /** Renders the receiver with a video element to show the camera in. */
    function renderReceiver(addToast = vi.fn()) {
      const rendered = renderHook(() => useOpticalReceiver(receiverOptions({ addToast })));
      const video = document.createElement('video');
      video.play = vi.fn(async () => {});
      rendered.result.current.videoRef.current = video;
      return { ...rendered, video, addToast };
    }

    it('opens the camera when a camera session starts and releases it when it stops', async () => {
      const { result, video, addToast } = renderReceiver();

      await act(async () => {
        await result.current.startCameraSession();
      });
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(result.current.isScanning).toBe(true);
      expect(video.srcObject).not.toBeNull();
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ message: 'Camera scanner activated.' }));

      act(() => {
        result.current.stopCameraSession();
      });
      expect(track.stop).toHaveBeenCalled();
      expect(video.srcObject).toBeNull();
      expect(result.current.isScanning).toBe(false);
    });

    it('does not start scanning when the camera is refused, and reports why', async () => {
      getUserMedia.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
      const { result, addToast } = renderReceiver();

      await act(async () => {
        await result.current.startCameraSession();
      });
      expect(result.current.isScanning).toBe(false);
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(result.current.cameraError?.name).toBe('NotAllowedError');
      expect(addToast).not.toHaveBeenCalledWith(expect.objectContaining({ message: 'Camera scanner activated.' }));
    });

    it('releases the camera on unmount', async () => {
      const { result, unmount } = renderReceiver();
      await act(async () => {
        await result.current.startCameraSession();
      });
      unmount();
      expect(track.stop).toHaveBeenCalled();
    });
  });
});
