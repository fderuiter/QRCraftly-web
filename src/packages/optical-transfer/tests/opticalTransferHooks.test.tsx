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
import { useOpticalSender, useOpticalReceiver } from '../client';
import { FountainReassembler, PrismStream, TRANSFER_DENSITY_PROFILES, createPrismSession, crc32 } from '../index';
import { receiverOptions, senderOptions } from './fixtures';


describe('Optical Transfer Client Hooks', () => {
  describe('useOpticalSender', () => {
    it('should initialize with default states', () => {
      const { result } = renderHook(() =>
        useOpticalSender(senderOptions())
      );

      expect(result.current.selectedFile).toBeNull();
      expect(result.current.isTransferring).toBe(false);
      expect(result.current.isVerifyingHandshake).toBe(false);
      expect(result.current.progress).toBe(0);
      expect(result.current.density).toBe('balanced');
      expect(result.current.fps).toBe(15);
    });

    it('should simulate 50MB file correctly', () => {
      const { result } = renderHook(() =>
        useOpticalSender(senderOptions())
      );

      act(() => {
        result.current.simulate50MBFile();
      });

      expect(result.current.selectedFile).not.toBeNull();
      expect(result.current.selectedFile?.name).toBe('simulation_50mb_payload.bin');
      expect(result.current.selectedFile?.size).toBe(50 * 1024 * 1024);
    });
    it('starts a broadcast without a handshake frame and never restarts the stream', async () => {
      const { result } = renderHook(() =>
        useOpticalSender(senderOptions())
      );
      act(() => {
        result.current.setSelectedFile(new File(['fountain'], 'f.txt', { type: 'text/plain' }));
        result.current.setDensity('fast');
      });

      const sent: Array<{ type: string; payload?: Record<string, unknown> }> = [];
      globalThis.mockWorkerControl.setInterceptor((message: { type: string; payload?: Record<string, unknown> }, worker: { dispatchMessage: (m: unknown) => void }) => {
        sent.push(message);
        if (message.type === 'START') {
          worker.dispatchMessage({ type: 'PROGRESS', index: 0, total: 2 });
          worker.dispatchMessage({
            type: 'INITIALIZED',
            totalFrames: 2,
            sha256: 'abc',
            fountain: { k: 2, density: 'fast', symbolSize: 40, compression: 'deflate-raw', messageLength: 80, fingerprint: 'AB12-CD34' },
          });
          for (let index = 0; index < 6; index++) {
            worker.dispatchMessage({ type: 'FRAME', index, total: 2, size: 21, data: new Uint8Array(441) });
          }
        }
      });

      await act(async () => {
        result.current.startTransfer();
      });

      await waitFor(() => expect(result.current.isTransferring).toBe(true));
      const start = sent.find(m => m.type === 'START');
      // The density picks the symbol size and ECC in the worker.
      expect(start?.payload).toMatchObject({ density: 'fast' });
      expect(start?.payload).not.toHaveProperty('chunkSize');
      expect(start?.payload).not.toHaveProperty('fountainMode');
      expect(result.current.handshakeVerified).toBe(true);
      expect(result.current.fountainInfo).toEqual({ k: 2, density: 'fast', symbolSize: 40, compression: 'deflate-raw', fingerprint: 'AB12-CD34' });

      // Play past K = 2: every droplet is ACKed and its pool slot recycled; no START restart.
      await waitFor(() => expect(result.current.currentFrameIndex).toBeGreaterThanOrEqual(5), { timeout: 3000 });
      expect(sent.filter(m => m.type === 'START')).toHaveLength(1);
      expect(sent.filter(m => m.type === 'ACK').length).toBeGreaterThanOrEqual(4);
      expect(result.current.progress).toBe(100);
      expect(result.current.framePoolRef.current.slotCapacity).toBe(64);

      act(() => {
        result.current.stopTransfer();
      });
      expect(result.current.isTransferring).toBe(false);
      globalThis.mockWorkerControl.setInterceptor(null);
    });

    it('surfaces worker errors (e.g. density bound) instead of stalling', async () => {
      const { result } = renderHook(() =>
        useOpticalSender(senderOptions())
      );
      act(() => {
        result.current.setSelectedFile(new File(['x'], 'x.bin'));
      });
      globalThis.mockWorkerControl.setInterceptor((message: { type: string }, worker: { dispatchMessage: (m: unknown) => void }) => {
        if (message.type === 'START') worker.dispatchMessage({ type: 'ERROR', message: 'Fountain encoding failed: too large' });
      });
      await act(async () => {
        result.current.startTransfer();
      });
      await waitFor(() => expect(result.current.handshakeError).toMatch(/too large/));
      expect(result.current.isTransferring).toBe(false);
      globalThis.mockWorkerControl.setInterceptor(null);
    });
  });

  describe('useOpticalReceiver', () => {

    beforeEach(() => {
    });

    afterEach(() => {
    });

    it('should initialize with standard defaults', () => {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

      expect(result.current.manifest).toBeNull();
      expect(result.current.fountainStats).toBeNull();
      expect(result.current.isScanning).toBe(false);
      expect(result.current.receiverMode).toBe('camera');
    });

    /** Routes reassembly-worker droplets through a real FountainReassembler. */
    function installFountainWorker() {
      const reassembler = new FountainReassembler();
      globalThis.mockWorkerControl.setInterceptor(async (message: { type: string; droplet?: string }, worker: { url: URL | string; dispatchMessage: (m: unknown) => void }) => {
        if (!String(worker.url).includes('worker-reassembly')) return;
        if (message.type === 'CLEAR') {
          reassembler.reset();
          return;
        }
        if (message.type !== 'FOUNTAIN_DROPLET' || !message.droplet) return;
        const snap = reassembler.ingest(message.droplet);
        const manifest = reassembler.takeManifest();
        if (manifest) worker.dispatchMessage({ type: 'MANIFEST', manifest });
        if (!snap) return;
        worker.dispatchMessage({ type: 'PROGRESS', progress: snap.progress, current: snap.resolved, total: snap.k, rank: snap.rank, dropletsReceived: snap.dropletsReceived, isFountain: true });
        if (!reassembler.isComplete) return;
        try {
          const { data, header } = await reassembler.finalize();
          worker.dispatchMessage({ type: 'COMPLETE', buffer: data.slice().buffer, handshake: { fileName: header.fileName, fileSize: header.fileSize, mimeType: header.mimeType, sha256: header.sha256 }, isFountain: true });
        } catch (err) {
          worker.dispatchMessage({ type: 'ERROR', error: (err as Error).message, isFountain: true });
        }
      });
    }

    it('reassembles a stream joined mid-stream with drops, from the manifest alone', async () => {
      installFountainWorker();
      const text = 'Hook-level fountain reception. '.repeat(30);
      const { stream, manifest } = await createPrismSession(new TextEncoder().encode(text), {
        fileName: 'hook.txt',
        mimeType: 'text/plain',
        errorCorrectionLevel: TRANSFER_DENSITY_PROFILES.balanced.errorCorrectionLevel,
        maxVersion: TRANSFER_DENSITY_PROFILES.balanced.maxVersion,
      });
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: false })));

      for (let index = 4; index < stream.k * 6 + 40 && !result.current.receiverSuccess; index++) {
        if (index % 4 === 1) continue;
        await act(async () => {
          result.current.handleFrame(stream.frameText(index));
          await new Promise(resolve => setTimeout(resolve, 0));
        });
      }

      await waitFor(() => expect(result.current.receiverSuccess).toBe(true));
      expect(result.current.receiverError).toBeNull();
      expect(result.current.manifest).toMatchObject({ files: [{ name: 'hook.txt' }] });
      expect(result.current.handshake).toMatchObject({ fileName: 'hook.txt', sha256: manifest.files[0].sha256 });
      expect(new TextDecoder().decode(result.current.reassembledData!)).toBe(text);
      expect(result.current.fountainStats).toMatchObject({ k: stream.k, rank: stream.k, progress: 100, etaSeconds: 0 });
      expect(result.current.fountainStats!.dropletsReceived).toBeGreaterThanOrEqual(stream.k);
      expect(result.current.fountainStats!.fps).toBeGreaterThanOrEqual(0);
      globalThis.mockWorkerControl.setInterceptor(null);
    });

    it('refuses to deliver a fountain file whose SHA-256 does not verify', async () => {
      installFountainWorker();
      const bytes = new TextEncoder().encode('forged content');
      const stream = new PrismStream(bytes, {
        version: 1,
        files: [{ name: 'x.txt', size: bytes.length, mimeType: 'text/plain', sha256: 'aa'.repeat(32) }],
        compression: 'none',
        transferLength: bytes.length,
        symbolSize: 16,
        transferCrc32: crc32(bytes),
        salt: new Uint8Array(0),
        encryption: 0,
      });
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ autoDownload: true })));
      for (let index = 0; index < stream.k * 3 + 40 && !result.current.receiverError; index++) {
        await act(async () => {
          result.current.handleFrame(stream.frameText(index));
          await new Promise(resolve => setTimeout(resolve, 0));
        });
      }
      await waitFor(() => expect(result.current.receiverError).toMatch(/SHA-256/));
      expect(result.current.receiverSuccess).toBe(false);
      expect(result.current.downloadTriggered).toBe(false);
      globalThis.mockWorkerControl.setInterceptor(null);
    });

    it('should reset receiver state cleanly', () => {
      const { result } = renderHook(() => useOpticalReceiver(receiverOptions()));

      act(() => {
        result.current.handleClear();
      });

      expect(result.current.manifest).toBeNull();
      expect(result.current.handshake).toBeNull();
      expect(result.current.receiverError).toBeNull();
      expect(result.current.fountainStats).toBeNull();
    });
  });
});

