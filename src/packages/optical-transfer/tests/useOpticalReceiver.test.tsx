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
import { createFountainSession } from '../index';
import { receiverOptions } from './fixtures';

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

    expect(result.current.chunks.size).toBe(0);
    expect(result.current.totalChunks).toBeNull();
    expect(result.current.securityAlert).toBeNull();
    expect(result.current.isScanning).toBe(false);
  });

  it('should process simulated normal data frames when handshake is present', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    await act(async () => {
      await result.current.handleFrame('H|test.txt|6|text/plain|c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2');
    });

    await act(async () => {
      await result.current.handleFrame('F|0|2|Zm9v');
    });

    expect(result.current.totalChunks).toBe(2);
    expect(result.current.chunks.has(0)).toBe(true);
  });

  it('rejects a legacy handshake claiming 2 GB before anything is allocated (#1154)', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    await act(async () => {
      await result.current.handleFrame('H|x.bin|2000000000|application/octet-stream|' + 'a'.repeat(64));
    });

    expect(result.current.receiverError).toMatch(/File transfer rejected: the sender claims 2000000000 bytes/);
    expect(result.current.handshake).toBeNull();
  });

  it('rejects a legacy handshake without a valid SHA-256 (#1154)', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    for (const bad of ['', 'abc', 'g'.repeat(64)]) {
      await act(async () => {
        await result.current.handleFrame(`H|x.bin|10|text/plain|${bad}`);
      });
      expect(result.current.receiverError).toMatch(/no valid SHA-256 hash/);
      expect(result.current.handshake).toBeNull();
    }
  });

  it('should ignore data frames when no handshake frame has been scanned', async () => {
    const addToast = vi.fn();
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ addToast })));

    await act(async () => {
      await result.current.handleFrame('F|0|2|Zm9v');
    });

    expect(result.current.chunks.size).toBe(0);
    expect(result.current.receiverError).toContain('Handshake metadata required');
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('missing handshake metadata'),
    }));
  });

  it('keeps accepting fountain droplets after an error and clears it once decoding progresses', async () => {
    const posted: string[] = [];
    globalThis.mockWorkerControl.setInterceptor((message: { type: string }, worker: { dispatchMessage: (m: unknown) => void }) => {
      posted.push(message.type);
      if (message.type === 'FOUNTAIN_DROPLET') {
        worker.dispatchMessage({ type: 'PROGRESS', progress: 10, current: 1, total: 10, rank: 1, dropletsReceived: 1, isFountain: true });
      }
    });
    try {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

      await act(async () => {
        await result.current.handleFrame('F|0|2|Zm9v');
      });
      expect(result.current.receiverError).toContain('Handshake metadata required');

      const { encoder } = await createFountainSession(new TextEncoder().encode('recover'), { fileName: 'r.txt', mimeType: 'text/plain' });
      await act(async () => {
        await result.current.handleFrame(encoder.dropletStringForIndex(0));
      });

      await waitFor(() => expect(posted).toContain('FOUNTAIN_DROPLET'));
      await waitFor(() => expect(result.current.receiverError).toBeNull());
    } finally {
      globalThis.mockWorkerControl.setInterceptor(null);
    }
  });

  it('should intercept dangerous schemes immediately', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    await act(async () => {
      await result.current.handleFrame('javascript:alert(1)');
    });

    expect(result.current.securityAlert).toContain('Dangerous protocol detected and blocked');
  });

  it('should compile, verify SHA-256, and reassemble files via background worker', async () => {
    const addToast = vi.fn();
    const options = receiverOptions({ addToast });
    const { result } = renderHook(() => useOpticalReceiver(options));

    await act(async () => {
      await result.current.handleFrame('H|test.txt|6|text/plain|c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2');
    });

    await act(async () => {
      await result.current.handleFrame('F|0|2|Zm9v');
    });

    await act(async () => {
      await result.current.handleFrame('F|1|2|YmFy');
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    expect(result.current.receiverSuccess).toBe(true);
    expect(options.saveFile).toHaveBeenCalledWith(expect.any(Uint8Array), 'test.txt', 'text/plain');
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
    }));
  });

  it('should abort download and emit toast error when computed SHA-256 hash does not match handshake hash', async () => {
    const addToast = vi.fn();
    const options = receiverOptions({ addToast });
    const { result } = renderHook(() => useOpticalReceiver(options));

    await act(async () => {
      await result.current.handleFrame('H|test.txt|6|text/plain|0000000000000000000000000000000000000000000000000000000000000000');
    });

    await act(async () => {
      await result.current.handleFrame('F|0|2|Zm9v');
    });

    await act(async () => {
      await result.current.handleFrame('F|1|2|YmFy');
    });

    await waitFor(() => {
      expect(result.current.receiverError).toContain('Integrity validation failed');
    });

    expect(result.current.receiverSuccess).toBe(false);
    expect(options.saveFile).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      message: expect.stringContaining('Integrity validation failed'),
    }));
  });

  it('should synchronously and atomically reset state and frame-tracking memory when a new file handshake with a different SHA-256 is detected', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    // 1. Process first file's handshake and first frame
    await act(async () => {
      await result.current.handleFrame('H|file1.txt|10|text/plain|1111111111111111111111111111111111111111111111111111111111111111');
    });
    await act(async () => {
      await result.current.handleFrame('F|0|2|Zm9v');
    });

    expect(result.current.handshake?.sha256).toBe('1111111111111111111111111111111111111111111111111111111111111111');
    expect(result.current.chunks.has(0)).toBe(true);
    expect(result.current.totalChunks).toBe(2);

    // 2. Process a different file handshake (different SHA-256)
    await act(async () => {
      await result.current.handleFrame('H|file2.txt|20|text/plain|2222222222222222222222222222222222222222222222222222222222222222');
    });

    // Verify all states are atomically cleared/updated
    expect(result.current.handshake?.sha256).toBe('2222222222222222222222222222222222222222222222222222222222222222');
    expect(result.current.handshake?.fileName).toBe('file2.txt');
    expect(result.current.chunks.size).toBe(0);
    expect(result.current.totalChunks).toBeNull();
    expect(result.current.receiverSuccess).toBe(false);

    // 3. Process first frame of new file (which has same index '0')
    // If memory wasn't reset, this would be discarded as a duplicate of the previous file's frame 0!
    await act(async () => {
      await result.current.handleFrame('F|0|2|YmFy');
    });

    expect(result.current.chunks.has(0)).toBe(true);
    expect(result.current.totalChunks).toBe(2);
  });

  it('should reset the lookahead validation security engine concurrently with the frame cache for new file handshakes', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ streamMode: 'text' })));

    // Send first handshake
    await act(async () => {
      await result.current.handleFrame('H|file1.txt|10|text/plain|1111111111111111111111111111111111111111111111111111111111111111');
    });

    // Send a frame containing a partial protocol fragment (e.g., 'java')
    await act(async () => {
      await result.current.handleFrame('java');
    });

    expect(result.current.securityAlert).toBeNull();

    // Now, send a different file handshake (this resets/clears the lookahead buffer for the new file)
    await act(async () => {
      await result.current.handleFrame('H|file2.txt|20|text/plain|2222222222222222222222222222222222222222222222222222222222222222');
    });

    // Send 'java' then 'script:' in file2 to complete 'java' + 'script:' reassembly and verify detection triggers
    await act(async () => {
      await result.current.handleFrame('java');
    });
    await act(async () => {
      await result.current.handleFrame('script:');
    });

    expect(result.current.securityAlert).not.toBeNull();
  });

  it('should block split-payload attacks (e.g., java and script:) across frames immediately', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    await act(async () => {
      await result.current.handleFrame('H|test.txt|10|text/plain|3333333333333333333333333333333333333333333333333333333333333333');
    });

    // 'java' in base64 is 'amF2YQ=='
    await act(async () => {
      await result.current.handleFrame('F|0|2|amF2YQ==');
    });

    // 'script:alert(1)' in base64 is 'c2NyaXB0OmFsZXJ0KDEp'
    await act(async () => {
      await result.current.handleFrame('F|1|2|c2NyaXB0OmFsZXJ0KDEp');
    });

    expect(result.current.securityAlert).toContain('MaliciousStreamError: Detected dangerous protocol prefix "javascript:" split across frames.');
    expect(result.current.isScanning).toBe(false);
  });

  it('should not block legitimate QR codes containing standard data', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    await act(async () => {
      await result.current.handleFrame('H|test.txt|10|text/plain|3333333333333333333333333333333333333333333333333333333333333333');
    });

    // 'hello' in base64 is 'aGVsbG8='
    await act(async () => {
      await result.current.handleFrame('F|0|2|aGVsbG8=');
    });

    // ' world' in base64 is 'IHdvcmxk'
    await act(async () => {
      await result.current.handleFrame('F|1|2|IHdvcmxk');
    });

    expect(result.current.securityAlert).toBeNull();
  });

  it('should reject transfers exceeding 5,000 chunks', async () => {
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

    await act(async () => {
      await result.current.handleFrame('F|0|5001|Zm9v');
    });

    expect(result.current.receiverError).toBe('File transfer rejected: exceeds the maximum limit of 5000 chunks.');
    expect(result.current.isScanning).toBe(false);
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
