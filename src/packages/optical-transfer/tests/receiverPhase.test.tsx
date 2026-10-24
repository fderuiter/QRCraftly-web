/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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
// The phase `useOpticalReceiver` reports (#1513) on each path a receive can take.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOpticalReceiver, type UseOpticalReceiverOptions } from '../client';
import { PrismStream, TRANSFER_DENSITY_PROFILES, createPrismBundleSession, createPrismSession, crc32, type ReceiverPhase } from '../index';
import { receiverOptions } from './fixtures';
import reference from './fixtures/bcur/reference-streams.json';

const balanced = TRANSFER_DENSITY_PROFILES.balanced;
const text = (value: string) => new TextEncoder().encode(value);

/** Renders the receiver and records every phase it passes through, without repeats. */
function renderReceiver(options: Partial<UseOpticalReceiverOptions> = {}) {
  const phases: ReceiverPhase[] = [];
  const rendered = renderHook(() => {
    const receiver = useOpticalReceiver(receiverOptions(options));
    if (phases[phases.length - 1] !== receiver.phase) phases.push(receiver.phase);
    return receiver;
  });
  return { ...rendered, phases };
}

type Receiver = ReturnType<typeof useOpticalReceiver>;

/** Feeds a stream's frames until the receive finishes or fails. */
async function feed(result: { current: Receiver }, stream: { frameText(i: number): string; k: number }) {
  for (let i = 0; i < stream.k * 4 + 40 && result.current.phase !== 'complete' && result.current.phase !== 'failed'; i++) {
    await act(async () => {
      result.current.handleFrame(stream.frameText(i));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  global.URL.createObjectURL = vi.fn(() => 'mock-url');
  global.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.mockWorkerControl.reset();
});

describe('useOpticalReceiver phase', () => {
  it('receives a file: receiving, then verifying, then complete with the file', async () => {
    const { stream } = await createPrismSession(text('phase words '.repeat(40)), {
      fileName: 'note.txt',
      mimeType: 'text/plain',
      errorCorrectionLevel: balanced.errorCorrectionLevel,
      maxVersion: balanced.maxVersion,
    });
    const { result, phases } = renderReceiver({ autoDownload: false });
    await feed(result, stream);
    await waitFor(() => expect(result.current.phase).toBe('complete'));
    // A fast check can finish before a render shows 'verifying', so it is optional here.
    expect(phases.filter((p) => p !== 'verifying')).toEqual(['idle', 'receiving', 'complete']);
    if (phases.includes('verifying')) expect(phases.indexOf('verifying')).toBe(2);
    expect(result.current.result).toMatchObject({ kind: 'file', handshake: { fileName: 'note.txt' } });
    expect(result.current.result?.kind === 'file' && new TextDecoder().decode(result.current.result.data)).toBe('phase words '.repeat(40));
    expect(result.current.failure).toBeNull();

    act(() => result.current.handleClear());
    expect(result.current.phase).toBe('idle');
    expect(result.current.result).toBeNull();
  });

  it('fails as the receiver when the file does not match its SHA-256', async () => {
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
      layout: 0,
      unpackedLength: 0,
      unpackedSha256: new Uint8Array(0),
      entryCount: 0,
    });
    const { result, phases } = renderReceiver();
    await feed(result, stream);
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    // The check can finish before a render shows 'verifying'; it never shows the file as received.
    expect(phases).not.toContain('complete');
    expect(result.current.failure).toMatchObject({ source: 'receiver', message: expect.stringContaining('Integrity validation failed') });
  });

  it('completes a bundle with its files', async () => {
    const { stream } = await createPrismBundleSession(
      [
        { path: 'one.txt', mimeType: 'text/plain', data: text('one '.repeat(50)) },
        { path: 'two.bin', mimeType: 'application/octet-stream', data: new Uint8Array([1, 2, 3]) },
      ],
      { fileName: '', mimeType: '', errorCorrectionLevel: balanced.errorCorrectionLevel, maxVersion: balanced.maxVersion }
    );
    const { result } = renderReceiver();
    await feed(result, stream);
    await waitFor(() => expect(result.current.phase).toBe('complete'));
    const finished = result.current.result;
    expect(finished?.kind).toBe('bundle');
    expect(finished?.kind === 'bundle' && finished.files.map((file) => file.name)).toEqual(['one.txt', 'two.bin']);
  });

  describe('a wallet-style stream', () => {
    beforeAll(async () => {
      await import('../bcur');
    }, 30_000);

    it('completes with the BC-UR result', async () => {
      const vector = reference.vectors.find((entry) => entry.name === 'seven-fragments');
      const { result } = renderReceiver({ autoDownload: false });
      for (const part of vector?.parts ?? []) {
        if (result.current.phase === 'complete') break;
        await act(async () => {
          result.current.handleFrame(part);
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
      await waitFor(() => expect(result.current.phase).toBe('complete'));
      expect(result.current.result).toMatchObject({ kind: 'bcur', result: { type: 'bytes' } });
    }, 20_000);
  });

  describe('video mode', () => {
    it('waits for a video, scans once one loads, and fails as the file when it is not a video', () => {
      const { result, phases } = renderReceiver({ initialMode: 'file' });
      expect(result.current.phase).toBe('awaitingVideo');
      act(() => {
        result.current.handleFileUpload(new File(['not a video'], 'notes.txt', { type: 'text/plain' }));
      });
      expect(result.current.failure).toMatchObject({ source: 'file' });
      act(() => {
        result.current.handleFileUpload(new File(['video'], 'stream.mp4', { type: 'video/mp4' }));
      });
      expect(phases).toEqual(['awaitingVideo', 'failed', 'scanning']);

      act(() => result.current.setReceiverMode('camera'));
      expect(result.current.phase).toBe('idle');
    });
  });

  describe('camera mode', () => {
    let originalMediaDevices: MediaDevices | undefined;
    let getUserMedia: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      originalMediaDevices = navigator.mediaDevices;
      getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true, writable: true });
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'mediaDevices', { value: originalMediaDevices, configurable: true, writable: true });
    });

    /** Gives the receiver a video element to show the camera in. */
    function withVideo(result: { current: Receiver }) {
      const video = document.createElement('video');
      video.play = vi.fn(async () => {});
      result.current.videoRef.current = video;
    }

    it('scans while the camera runs and goes back to idle when it stops', async () => {
      const { result, phases } = renderReceiver();
      withVideo(result);
      await act(async () => {
        await result.current.startCameraSession();
      });
      expect(result.current.phase).toBe('scanning');
      act(() => result.current.stopCameraSession());
      expect(phases).toEqual(['idle', 'scanning', 'idle']);
    });

    it('fails as the camera when access is refused, with the same words the page shows', async () => {
      getUserMedia.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
      const { result } = renderReceiver();
      withVideo(result);
      await act(async () => {
        await result.current.startCameraSession();
      });
      await waitFor(() => expect(result.current.phase).toBe('failed'));
      expect(result.current.failure).toEqual({ source: 'camera', message: expect.stringContaining('Camera access was blocked') });
    });
  });
});
