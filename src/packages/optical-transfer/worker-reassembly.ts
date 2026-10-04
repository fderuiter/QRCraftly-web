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

export interface FountainWorkerMessage {
  type: 'FOUNTAIN_DROPLET' | 'DROPLET';
  /** Decoded QR text: a Prism frame, or a legacy `ur:bytes/` droplet. */
  droplet: string;
}

export interface ClearWorkerMessage {
  type: 'CLEAR' | 'RESET';
}

/** Ignore a session that already finished (from `COMPLETE.session`), e.g. after "Receive another". */
export interface IgnoreSessionMessage {
  type: 'IGNORE_SESSION';
  session: string;
}

export type FileReassemblyIncomingMessage = FountainWorkerMessage | ClearWorkerMessage | IgnoreSessionMessage;

let reassembler: FountainReassembler | null = null;
let finalizing = false;

function post(message: Record<string, unknown>, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

function resetWorkerState(): void {
  // Reset rather than drop the reassembler: it remembers the finished session and ignores its frames.
  reassembler?.reset();
  finalizing = false;
}

/**
 * Feeds one frame to the stateless reassembler. A manifest is announced as soon as it is accepted;
 * on completion the file is decompressed, verified against the manifest and posted.
 */
async function handleFrame(text: string): Promise<void> {
  if (finalizing) return;
  if (!reassembler) reassembler = new FountainReassembler();
  const active = reassembler;

  const snapshot = active.ingest(text);

  const rejection = active.takeRejection();
  if (rejection) post({ type: 'ERROR', error: rejection, isFountain: true });
  const manifest = active.takeManifest();
  if (manifest) post({ type: 'MANIFEST', manifest });
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

  if (!active.isComplete) return;
  finalizing = true;
  try {
    const { data, header } = await active.finalize();
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
        session: active.finishedSessionKey,
      },
      [bufCopy.buffer]
    );
  } catch (err: unknown) {
    post({ type: 'ERROR', error: err instanceof Error ? err.message : 'Reassembly failed', isFountain: true });
  } finally {
    resetWorkerState();
  }
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
      if (!reassembler) reassembler = new FountainReassembler();
      reassembler.ignoreSession(data.session);
      return;
    }
    if (data.type === 'FOUNTAIN_DROPLET' || data.type === 'DROPLET') {
      await handleFrame(data.droplet);
    }
  } catch (err: unknown) {
    post({ type: 'ERROR', error: err instanceof Error && err.message ? err.message : 'Unknown reassembly error' });
  }
};
