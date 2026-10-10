// @vitest-environment jsdom
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

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOpticalReceiver } from '../client';
import {
  PrismStream,
  TRANSFER_DENSITY_PROFILES,
  KEY_SECRET_BYTES,
  cborEncode,
  createPrismSession,
  createPrng,
  deriveKeys,
  encodeBytewordsMinimal,
  keyQrText,
  parseKeyCode,
  sha256Hex,
} from '../index';
import { receiverOptions } from './fixtures';

const balanced = TRANSFER_DENSITY_PROFILES.balanced;

type Receiver = { current: ReturnType<typeof useOpticalReceiver> };

function randomBytes(length: number, seed: number): Uint8Array {
  const prng = createPrng(seed);
  return Uint8Array.from({ length }, () => Math.floor(prng() * 256));
}

async function session(bytes: Uint8Array, isPrivate: boolean) {
  return createPrismSession(bytes, {
    fileName: 'data.bin',
    mimeType: 'application/octet-stream',
    errorCorrectionLevel: balanced.errorCorrectionLevel,
    maxVersion: balanced.maxVersion,
    private: isPrivate,
  });
}

/** Shows the receiver one code and lets the worker answer. */
async function show(result: Receiver, text: string) {
  await act(async () => {
    result.current.handleFrame(text);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Shows frames `from` onwards until the file arrives or the stream has gone round a few times. */
async function feed(result: Receiver, stream: PrismStream, from = 0, until = stream.k * 4 + 40) {
  for (let i = from; i < until && !result.current.receiverSuccess; i++) await show(result, stream.frameText(i));
}

/** A one-part wallet code that a BC-UR decoder finishes on its own. */
const WALLET_CODE = `UR:BYTES/${encodeBytewordsMinimal(cborEncode(new Uint8Array([1, 2, 3]))).toUpperCase()}`;

/** One part of a multipart wallet stream: `ur:bytes/<seq>-<n>/` and the CBOR part, as BCR-2024-001 lays it out. */
function walletPart(seqNum: number, seqLen: number, messageLen: number, data: Uint8Array): string {
  const body = encodeBytewordsMinimal(cborEncode([seqNum, seqLen, messageLen, 1, data]));
  return `UR:BYTES/${seqNum}-${seqLen}/${body.toUpperCase()}`;
}

describe('the receiver keeps a transfer in progress', () => {
  beforeAll(async () => {
    // The receiver loads the BC-UR codec on the first UR code; load it up front.
    await import('../bcur');
  }, 30_000);

  beforeEach(() => {
    global.URL.createObjectURL = vi.fn(() => 'mock-download-url');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.mockWorkerControl.reset();
  });

  it.each([false, true])('is not ended by a wallet code in view (private: %s) (#1300)', async (isPrivate) => {
    const file = randomBytes(3000, isPrivate ? 7 : 3);
    const { stream, keyCode } = await session(file, isPrivate);
    const options = receiverOptions({ autoDownload: true });
    const { result } = renderHook(() => useOpticalReceiver(options));

    const third = Math.ceil(stream.k / 3);
    await feed(result, stream, 0, 2);
    if (isPrivate) {
      await waitFor(() => expect(result.current.needsKey).toBe(true));
      await act(async () => result.current.submitKeyCode(keyCode ?? ''));
      await waitFor(() => expect(result.current.keyAccepted).toBe(true));
    }
    await feed(result, stream, 2, third);
    await show(result, WALLET_CODE);
    await waitFor(() => expect(result.current.bcurProgress).toBeNull());
    expect(result.current.bcur).toBeNull();

    await feed(result, stream, third);
    await waitFor(() => expect(result.current.receiverSuccess).toBe(true));
    expect(result.current.bcur).toBeNull();
    const [saved] = vi.mocked(options.saveFile).mock.calls[0];
    expect(await sha256Hex(saved)).toBe(await sha256Hex(file));
  }, 30_000);

  it('says once why it ignores a wallet stream over its limits (#1302)', async () => {
    const part = walletPart(1, 65_537, 655_370, new Uint8Array(10));
    const addToast = vi.fn();
    const { result } = renderHook(() => useOpticalReceiver(receiverOptions({ addToast })));
    await show(result, part);
    await waitFor(() => expect(result.current.receiverError).toMatch(/wallet-style stream.*too large/));
    expect(result.current.bcurProgress).toBeNull();
  }, 20_000);

  it('ignores a key QR for another transfer and keeps the opened one (#1303)', async () => {
    const file = randomBytes(3000, 11);
    const { stream, keyCode } = await session(file, true);
    const options = receiverOptions({ autoDownload: true });
    const { result } = renderHook(() => useOpticalReceiver(options));

    await feed(result, stream, 0, 2);
    await waitFor(() => expect(result.current.needsKey).toBe(true));
    await show(result, keyQrText(parseKeyCode(keyCode ?? '') ?? new Uint8Array()));
    await waitFor(() => expect(result.current.needsKey).toBe(false));
    const half = Math.ceil(stream.k / 2);
    await feed(result, stream, 2, half);

    await show(result, keyQrText(randomBytes(KEY_SECRET_BYTES, 99)));
    await waitFor(() => expect(result.current.receiverError).toMatch(/another transfer/));
    expect(result.current.needsKey).toBe(false);

    await feed(result, stream, half);
    await waitFor(() => expect(result.current.receiverSuccess).toBe(true));
    const [saved] = vi.mocked(options.saveFile).mock.calls[0];
    expect(await sha256Hex(saved)).toBe(await sha256Hex(file));
  }, 30_000);

  it('keeps the key after a failed private finalize, so the honest stream still opens (#1303)', async () => {
    const file = randomBytes(2000, 13);
    const { stream, manifest, keyCode } = await session(file, true);
    const secret = parseKeyCode(keyCode ?? '') ?? new Uint8Array();
    // Frames of the same session that carry the wrong bytes: they decode, then fail to open.
    const forged = new PrismStream(randomBytes(manifest.transferLength, 14), manifest, { keys: deriveKeys(secret, manifest.salt) });
    const options = receiverOptions({ autoDownload: true });
    const { result } = renderHook(() => useOpticalReceiver(options));

    await show(result, stream.frameText(0));
    await waitFor(() => expect(result.current.needsKey).toBe(true));
    await act(async () => result.current.submitKeyCode(keyCode ?? ''));
    await waitFor(() => expect(result.current.keyAccepted).toBe(true));

    for (let i = 1; i < forged.k * 4 + 40 && !result.current.receiverError; i++) await show(result, forged.frameText(i));
    await waitFor(() => expect(result.current.receiverError).not.toBeNull());
    expect(result.current.receiverSuccess).toBe(false);

    await feed(result, stream);
    await waitFor(() => expect(result.current.receiverSuccess).toBe(true));
    const [saved] = vi.mocked(options.saveFile).mock.calls[0];
    expect(await sha256Hex(saved)).toBe(await sha256Hex(file));
  }, 30_000);

  it('drops a completion still being checked when Clear is pressed, and takes the next transfer (#1304)', async () => {
    const first = new TextEncoder().encode('the first file');
    const firstHash = await sha256Hex(first);
    const second = randomBytes(1500, 17);
    const secondHash = await sha256Hex(second);
    const { stream } = await session(second, false);
    // A worker that finishes at once, so the only hash is the receiver's own check.
    globalThis.mockWorkerControl.setInterceptor((message: { type?: string }, worker: { dispatchMessage(data: unknown): void }) => {
      if (message.type !== 'FOUNTAIN_DROPLET') return;
      worker.dispatchMessage({
        type: 'COMPLETE',
        buffer: first.slice().buffer,
        handshake: { fileName: 'first.txt', fileSize: first.length, mimeType: 'text/plain', sha256: firstHash },
        session: 'aa'.repeat(16),
        isFountain: true,
      });
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args: Parameters<SubtleCrypto['digest']>) => {
      await held;
      return digest(...args);
    });

    const options = receiverOptions({ autoDownload: true });
    const { result } = renderHook(() => useOpticalReceiver(options));
    await show(result, stream.frameText(0));
    await waitFor(() => expect(result.current.compilationStatus).toBe('Finalizing download...'));

    act(() => result.current.handleClear());
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.receiverSuccess).toBe(false);
    expect(result.current.compilationStatus).toBeNull();
    expect(options.saveFile).not.toHaveBeenCalled();

    spy.mockRestore();
    globalThis.mockWorkerControl.setInterceptor(null);
    await feed(result, stream);
    await waitFor(() => expect(result.current.receiverSuccess).toBe(true));
    const [saved] = vi.mocked(options.saveFile).mock.calls[0];
    expect(await sha256Hex(saved)).toBe(secondHash);
  }, 30_000);
});
