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

import { FountainReassembler } from './lib/fountain/reassembler';
import { MAX_RECEIVE_BYTES, formatLimit } from './lib/limits';

export interface HandshakeMetadata {
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  sha256?: string;
}

export interface InitWorkerMessage extends HandshakeMetadata {
  type: 'INIT' | 'ALLOCATE';
  fileSize: number;
  totalChunks?: number;
  chunkSize?: number;
}

export interface ChunkWorkerMessage {
  type: 'CHUNK' | 'PROCESS_CHUNK';
  index: number;
  total?: number;
  totalChunks?: number;
  base64: string;
  chunkSize?: number;
}

export interface FountainWorkerMessage {
  type: 'FOUNTAIN_DROPLET' | 'DROPLET';
  droplet: string;
}

export interface LegacyReassemblyMessage {
  type: 'START_REASSEMBLY';
  chunks: Array<{ index: number; base64: string }>;
  totalChunks: number;
}

export interface ClearWorkerMessage {
  type: 'CLEAR' | 'RESET';
}

/** Ignore a fountain session that already finished (from `COMPLETE.session`), e.g. after "Receive another". */
export interface IgnoreSessionMessage {
  type: 'IGNORE_SESSION';
  session: string;
}

export type FileReassemblyIncomingMessage =
  | InitWorkerMessage
  | ChunkWorkerMessage
  | FountainWorkerMessage
  | LegacyReassemblyMessage
  | ClearWorkerMessage
  | IgnoreSessionMessage;

let allocatedBuffer: Uint8Array | null = null;
let totalChunksCount: number | null = null;
let targetFileSize: number | null = null;
let knownChunkSize: number | null = null;
let receivedIndices: Set<number> = new Set();
let handshakeMetadata: HandshakeMetadata | null = null;
let fountainReassembler: FountainReassembler | null = null;
let fountainFinalizing = false;

function post(message: Record<string, unknown>, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

function resetWorkerState(): void {
  allocatedBuffer = null;
  totalChunksCount = null;
  targetFileSize = null;
  knownChunkSize = null;
  receivedIndices = new Set();
  handshakeMetadata = null;
  // Reset rather than drop the reassembler: it remembers the finished session and ignores its droplets.
  fountainReassembler?.reset();
  fountainFinalizing = false;
}

/**
 * Feeds one droplet to the stateless reassembler; on completion decompresses,
 * verifies the SHA-256 from the session header and posts the file.
 */
async function handleFountainDroplet(droplet: string): Promise<void> {
  if (fountainFinalizing) return;
  if (!fountainReassembler) fountainReassembler = new FountainReassembler();
  const reassembler = fountainReassembler;

  const snapshot = reassembler.ingest(droplet);
  if (!snapshot) return;
  post({
    type: 'PROGRESS',
    progress: snapshot.progress,
    current: snapshot.resolved,
    total: snapshot.k,
    rank: snapshot.rank,
    dropletsReceived: snapshot.dropletsReceived,
    isFountain: true,
  });

  if (!reassembler.isComplete) return;
  fountainFinalizing = true;
  try {
    const { data, header } = await reassembler.finalize();
    const bufCopy = new Uint8Array(data);
    post(
      {
        type: 'COMPLETE',
        buffer: bufCopy.buffer,
        handshake: {
          fileName: header.fileName || `received_file_${Date.now()}.bin`,
          fileSize: header.fileSize,
          mimeType: header.mimeType || 'application/octet-stream',
          sha256: header.sha256,
        },
        compression: header.compression,
        isFountain: true,
        session: reassembler.finishedSessionKey,
      },
      [bufCopy.buffer]
    );
  } catch (err: unknown) {
    post({ type: 'ERROR', error: err instanceof Error ? err.message : 'Fountain reassembly failed', isFountain: true });
  } finally {
    resetWorkerState();
  }
}

/** Throws before any allocation when a size claimed by the stream passes the receive limit. */
function assertWithinReceiveLimit(size: number): void {
  if (!Number.isFinite(size) || size < 0 || size > MAX_RECEIVE_BYTES) {
    throw new Error(`File transfer rejected: the sender claims a size beyond the ${formatLimit(MAX_RECEIVE_BYTES)} limit.`);
  }
}

function decodeBase64ToBytes(base64Str: string): Uint8Array {
  const binaryString = atob(base64Str);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let j = 0; j < len; j++) {
    bytes[j] = binaryString.charCodeAt(j);
  }
  return bytes;
}

self.onmessage = async (e: MessageEvent<FileReassemblyIncomingMessage>) => {
  const data = e.data;
  if (!data || typeof data !== 'object') return;


  try {
    if (data.type === 'CLEAR' || data.type === 'RESET') {
      resetWorkerState();
      return;
    }

    if (data.type === 'IGNORE_SESSION') {
      if (!fountainReassembler) fountainReassembler = new FountainReassembler();
      fountainReassembler.ignoreSession(data.session);
      return;
    }

    // --- Fountain Droplet Ingestion (stateless entry, no handshake) ---
    if (data.type === 'FOUNTAIN_DROPLET' || data.type === 'DROPLET') {
      await handleFountainDroplet(data.droplet);
      return;
    }

    // --- Legacy Chunking Ingestion ---
    if (data.type === 'INIT' || data.type === 'ALLOCATE') {
      resetWorkerState();
      const msg = data;
      if (typeof msg.fileSize === 'number' && msg.fileSize > 0) {
        assertWithinReceiveLimit(msg.fileSize);
        targetFileSize = msg.fileSize;
        allocatedBuffer = new Uint8Array(msg.fileSize);
      }
      if (typeof msg.totalChunks === 'number' && msg.totalChunks > 0) {
        totalChunksCount = msg.totalChunks;
      }
      if (typeof msg.chunkSize === 'number' && msg.chunkSize > 0) {
        knownChunkSize = msg.chunkSize;
      }
      handshakeMetadata = {
        fileName: msg.fileName,
        fileSize: msg.fileSize,
        mimeType: msg.mimeType,
        sha256: msg.sha256,
      };
      return;
    }

    if (data.type === 'CHUNK' || data.type === 'PROCESS_CHUNK') {
      const msg = data;
      const index = msg.index;
      const base64 = msg.base64;
      const tot = msg.totalChunks ?? msg.total;

      if (typeof tot === 'number' && tot > 0) {
        totalChunksCount = tot;
      }

      if (receivedIndices.has(index)) {
        return;
      }

      const decodedBytes = decodeBase64ToBytes(base64);

      if (typeof msg.chunkSize === 'number' && msg.chunkSize > 0) {
        knownChunkSize = msg.chunkSize;
      } else if (!knownChunkSize && totalChunksCount) {
        if (index < totalChunksCount - 1 || totalChunksCount === 1) {
          knownChunkSize = decodedBytes.length;
        }
      }

      if (!allocatedBuffer) {
        if (typeof knownChunkSize === 'number' && typeof totalChunksCount === 'number') {
          assertWithinReceiveLimit(knownChunkSize * totalChunksCount);
        }
        if (targetFileSize && targetFileSize > 0) {
          allocatedBuffer = new Uint8Array(targetFileSize);
        } else if (knownChunkSize && totalChunksCount) {
          if (index === totalChunksCount - 1) {
            targetFileSize = (totalChunksCount - 1) * knownChunkSize + decodedBytes.length;
          } else {
            targetFileSize = totalChunksCount * knownChunkSize;
          }
          allocatedBuffer = new Uint8Array(targetFileSize);
        } else if (totalChunksCount === 1) {
          targetFileSize = decodedBytes.length;
          allocatedBuffer = new Uint8Array(targetFileSize);
        }
      }

      let offset = 0;
      if (knownChunkSize) {
        offset = index * knownChunkSize;
      } else if (totalChunksCount && index === totalChunksCount - 1 && targetFileSize) {
        offset = targetFileSize - decodedBytes.length;
      }

      if (allocatedBuffer) {
        if (allocatedBuffer.length < offset + decodedBytes.length) {
          const newLen = Math.max(allocatedBuffer.length, offset + decodedBytes.length);
          assertWithinReceiveLimit(newLen);
          const expanded = new Uint8Array(newLen);
          expanded.set(allocatedBuffer, 0);
          allocatedBuffer = expanded;
          targetFileSize = newLen;
        }
        allocatedBuffer.set(decodedBytes, offset);

        const currentEnd = offset + decodedBytes.length;
        if (handshakeMetadata?.fileSize && currentEnd > handshakeMetadata.fileSize) {
          handshakeMetadata.fileSize = currentEnd;
        }

        if (!handshakeMetadata?.fileSize && totalChunksCount && index === totalChunksCount - 1) {
          targetFileSize = currentEnd;
        }
      }

      receivedIndices.add(index);

      const total = totalChunksCount || 1;
      const current = receivedIndices.size;
      const progress = Math.round((current / total) * 100);

      post({
        type: 'PROGRESS',
        progress,
        current,
        total,
        index,
      });

      if (totalChunksCount && receivedIndices.size >= totalChunksCount) {
        if (!allocatedBuffer) {
          throw new Error('Reassembly failed: No buffer allocated.');
        }

        const exactLength = handshakeMetadata?.fileSize || targetFileSize || allocatedBuffer.length;
        const finalBuffer = allocatedBuffer.subarray(0, exactLength);
        const transferableData = new Uint8Array(finalBuffer);
        const bufferToTransfer = transferableData.buffer;

        post(
          {
            type: 'COMPLETE',
            buffer: bufferToTransfer,
            handshake: handshakeMetadata,
          },
          [bufferToTransfer]
        );

        resetWorkerState();
      }
      return;
    }

    if (data.type === 'START_REASSEMBLY') {
      const msg = data;
      const { chunks, totalChunks } = msg;

      if (!chunks || chunks.length !== totalChunks) {
        post({
          type: 'ERROR',
          error: `Incomplete chunk set: received ${chunks?.length || 0} of ${totalChunks}`,
        });
        return;
      }

      chunks.sort((a, b) => a.index - b.index);

      const byteChunks: Uint8Array[] = [];
      let totalBytes = 0;

      for (let i = 0; i < chunks.length; i++) {
        const bytes = decodeBase64ToBytes(chunks[i].base64);
        byteChunks.push(bytes);
        totalBytes += bytes.length;

        const progress = Math.round(((i + 1) / totalChunks) * 100);
        post({
          type: 'PROGRESS',
          progress,
          current: i + 1,
          total: totalChunks,
        });
      }

      const combined = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of byteChunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      post(
        {
          type: 'COMPLETE',
          buffer: combined.buffer,
        },
        [combined.buffer]
      );

      resetWorkerState();
    }
  } catch (err: unknown) {
    post({
      type: 'ERROR',
      error: err instanceof Error && err.message ? err.message : 'Unknown reassembly error',
    });
  }
};

