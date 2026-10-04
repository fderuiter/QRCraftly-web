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

import QRCode, { type QRCodeErrorCorrectionLevel } from 'qrcode';
import { TRANSFER_DENSITY_PROFILES, resolveTransferDensity, sha256Hex } from './lib/fountain/session';
import { createPrismSession, type PrismStream } from './lib/prism/session';
import type {
  FountainInitInfo,
  SliceStartPayload,
  SliceWorkerIncomingMessage,
  SliceWorkerOutgoingMessage,
} from './lib/contracts';

let file: Blob | null = null;
let totalFrames = 0; // K: the first pass; the stream is rateless and runs past it
let nextIndexToGenerate = 0;
let lastAckedIndex = -1;
let errorCorrectionLevel: QRCodeErrorCorrectionLevel = 'Q';
let currentSessionId = 0;
let activeGeneratingSessionId = 0;
let fileSHA256 = '';
let lookaheadLimit = 3;
let stream: PrismStream | null = null;

// Keyed by the Blob/File instance so a cached hash can never be reused for different content.
const hashCache = new WeakMap<Blob, string>();

function post(message: SliceWorkerOutgoingMessage, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fileNameOf(blob: Blob): string {
  return blob instanceof File && blob.name ? blob.name : 'file';
}

/**
 * Generates the QR module matrix for one frame and posts it (zero-copy).
 */
function generateFrame(index: number, sessionId: number): void {
  const active = stream;
  if (sessionId !== currentSessionId || !active) return;

  try {
    const qr = QRCode.create(active.frameText(index), { errorCorrectionLevel });
    const { size, data } = qr.modules;
    if (sessionId !== currentSessionId) return;

    const transferableData = new Uint8Array(data);
    post({ type: 'FRAME', index, total: totalFrames, size, data: transferableData }, [transferableData.buffer]);
  } catch (err: unknown) {
    if (sessionId !== currentSessionId) return;
    post({ type: 'ERROR', message: `Failed to generate frame ${index}: ${errorMessage(err)}` });
  }
}

/**
 * Generates frames up to lastAckedIndex + lookaheadLimit. The stream is rateless, so it never ends
 * on its own; it runs until STOP.
 */
async function processPipeline(sessionId: number): Promise<void> {
  if (sessionId !== currentSessionId || !stream) return;
  if (activeGeneratingSessionId === sessionId) return;

  activeGeneratingSessionId = sessionId;
  try {
    while (sessionId === currentSessionId && nextIndexToGenerate <= lastAckedIndex + lookaheadLimit) {
      const currentIndex = nextIndexToGenerate;
      nextIndexToGenerate++;
      generateFrame(currentIndex, sessionId);
      // Give ACK and STOP messages a turn between frames.
      await Promise.resolve();
    }
  } finally {
    if (activeGeneratingSessionId === sessionId) {
      activeGeneratingSessionId = 0;
    }
  }
}

async function handleStart(payload: SliceStartPayload | undefined): Promise<void> {
  currentSessionId++;
  const sessionId = currentSessionId;

  const source = payload?.file ?? null;
  file = source;
  stream = null;

  const fps = payload?.fps || 15;
  lookaheadLimit = Math.min(16, Math.max(3, Math.ceil(fps * 0.2)));

  if (!source) {
    post({ type: 'ERROR', message: 'No file provided' });
    return;
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await source.arrayBuffer());
    if (sessionId !== currentSessionId) return;
    const cachedHash = hashCache.get(source);
    if (cachedHash !== undefined) {
      fileSHA256 = cachedHash;
    } else {
      fileSHA256 = await sha256Hex(bytes);
      if (sessionId !== currentSessionId) return;
      hashCache.set(source, fileSHA256);
    }
  } catch (err: unknown) {
    if (sessionId !== currentSessionId) return;
    post({ type: 'ERROR', message: `Hashing failed: ${errorMessage(err)}` });
    return;
  }

  let info: FountainInitInfo;
  try {
    const density = resolveTransferDensity(payload?.density);
    const profile = TRANSFER_DENSITY_PROFILES[density];
    // Frames use the density's ECC, not the page's appearance ECC.
    errorCorrectionLevel = profile.errorCorrectionLevel;
    const session = await createPrismSession(bytes, {
      fileName: fileNameOf(source),
      mimeType: source.type,
      errorCorrectionLevel,
      maxVersion: profile.maxVersion,
      sha256: fileSHA256,
    });
    if (sessionId !== currentSessionId) return;
    stream = session.stream;
    totalFrames = session.stream.k;
    info = {
      k: session.stream.k,
      density,
      symbolSize: session.symbolSize,
      compression: session.manifest.compression,
      messageLength: session.manifest.transferLength,
      fingerprint: session.stream.fingerprint,
    };
  } catch (err: unknown) {
    if (sessionId !== currentSessionId) return;
    post({ type: 'ERROR', message: `Encoding failed: ${errorMessage(err)}` });
    return;
  }

  nextIndexToGenerate = 0;
  lastAckedIndex = -1;

  post({ type: 'PROGRESS', index: 0, total: totalFrames, fileName: fileNameOf(source), fileSize: source.size });
  post({ type: 'INITIALIZED', totalFrames, sha256: fileSHA256, fountain: info });

  await processPipeline(sessionId);
}

async function handleAck(index: number | undefined): Promise<void> {
  if (!file) return;
  if (typeof index !== 'number' || index <= lastAckedIndex || index >= nextIndexToGenerate) return;
  lastAckedIndex = index;
  post({ type: 'PROGRESS', index: lastAckedIndex + 1, total: totalFrames });
  await processPipeline(currentSessionId);
}

function handleStop(): void {
  currentSessionId++;
  file = null;
  stream = null;
  nextIndexToGenerate = 0;
  lastAckedIndex = -1;
  totalFrames = 0;
  fileSHA256 = '';
  activeGeneratingSessionId = 0;
  lookaheadLimit = 3;
}

self.onmessage = async (e: MessageEvent<SliceWorkerIncomingMessage | null>) => {
  const message = e.data;
  if (!message) return;

  switch (message.type) {
    case 'START':
      await handleStart(message.payload);
      break;
    case 'ACK':
      await handleAck(message.payload?.index);
      break;
    case 'HEAL': {
      if (!file) break;
      const requested = message.payload?.lastAckedIndex;
      if (typeof requested === 'number') {
        const boundedAck = Math.min(requested, nextIndexToGenerate - 1);
        if (boundedAck >= -1) {
          lastAckedIndex = Math.max(lastAckedIndex, boundedAck);
        }
      }
      await processPipeline(currentSessionId);
      break;
    }
    case 'STOP':
      handleStop();
      break;
    default:
      break;
  }
};
