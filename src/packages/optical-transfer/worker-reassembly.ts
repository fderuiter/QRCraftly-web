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
import { parseKeyCode, parseKeyQr } from './lib/prism/words';

export interface FountainWorkerMessage {
  type: 'FOUNTAIN_DROPLET' | 'DROPLET';
  /** Decoded QR text: a Prism frame, a key QR, or a legacy `ur:bytes/` droplet. */
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

/** The key code of a private transfer, as the person typed it. */
export interface SetKeyMessage {
  type: 'SET_KEY';
  code: string;
}

/** The person's answer to an offer to switch to another stream. */
export interface SwitchDecisionMessage {
  type: 'SWITCH_DECISION';
  session: string;
  accept: boolean;
}

export type FileReassemblyIncomingMessage =
  | FountainWorkerMessage
  | ClearWorkerMessage
  | IgnoreSessionMessage
  | SetKeyMessage
  | SwitchDecisionMessage;

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

function postProgress(snapshot: NonNullable<ReturnType<FountainReassembler['snapshot']>>): void {
  post({
    type: 'PROGRESS',
    progress: snapshot.progress,
    current: snapshot.resolved,
    total: snapshot.k,
    rank: snapshot.rank,
    dropletsReceived: snapshot.dropletsReceived,
    isFountain: true,
  });
}

/** Posts what the reassembler wants the person to see: a message, a manifest, an offer. */
function postNotices(active: FountainReassembler): void {
  const rejection = active.takeRejection();
  if (rejection) post({ type: 'ERROR', error: rejection, isFountain: true });
  const manifest = active.takeManifest();
  if (manifest) post({ type: 'MANIFEST', manifest, needsKey: active.needsKey });
  const offer = active.takeSwitchOffer();
  if (offer) post({ type: 'SWITCH_OFFER', offer });
}

/** On completion, opens the files, verifies them and posts them. */
async function finishIfComplete(active: FountainReassembler): Promise<void> {
  if (finalizing || !active.isComplete) return;
  finalizing = true;
  try {
    const { files } = await active.finalize();
    const copies = files.map(({ data, header }) => ({
      buffer: new Uint8Array(data).buffer,
      handshake: {
        fileName: header.fileName || `received_file_${Date.now()}.bin`,
        fileSize: header.fileSize,
        mimeType: header.mimeType || 'application/octet-stream',
        sha256: header.sha256,
      },
      compression: header.compression,
    }));
    const transfer = copies.map((copy) => copy.buffer);
    const [first] = copies;
    post(
      files.length === 1
        ? { type: 'COMPLETE', ...first, isFountain: true, session: active.finishedSessionKey }
        : { type: 'COMPLETE', files: copies, isFountain: true, session: active.finishedSessionKey },
      transfer
    );
  } catch (err: unknown) {
    post({ type: 'ERROR', error: err instanceof Error ? err.message : 'Reassembly failed', isFountain: true });
  } finally {
    resetWorkerState();
  }
}

/** Applies a key code: from the key box or from a key QR the camera read. */
async function handleKey(active: FountainReassembler, secret: Uint8Array | null): Promise<void> {
  if (!secret) {
    post({ type: 'KEY_STATUS', accepted: false });
    return;
  }
  active.setKey(secret);
  post({ type: 'KEY_STATUS', accepted: true });
  postNotices(active);
  // The transfer may have finished while it waited for its key.
  await finishIfComplete(active);
}

/**
 * Feeds one frame to the stateless reassembler. A manifest is announced as soon as it is accepted;
 * on completion the files are decrypted, decompressed, verified against the manifest and posted.
 */
async function handleFrame(text: string): Promise<void> {
  if (finalizing) return;
  if (!reassembler) reassembler = new FountainReassembler();
  const active = reassembler;

  const keySecret = parseKeyQr(text);
  if (keySecret) {
    await handleKey(active, keySecret);
    return;
  }

  const snapshot = active.ingest(text);
  postNotices(active);
  if (!snapshot) return;
  postProgress(snapshot);
  await finishIfComplete(active);
}

self.onmessage = async (e: MessageEvent<FileReassemblyIncomingMessage>) => {
  const data = e.data;
  if (!data || typeof data !== 'object') return;

  try {
    if (data.type === 'CLEAR' || data.type === 'RESET') {
      resetWorkerState();
      return;
    }
    if (!reassembler) reassembler = new FountainReassembler();
    if (data.type === 'IGNORE_SESSION') {
      reassembler.ignoreSession(data.session);
      return;
    }
    if (data.type === 'SET_KEY') {
      await handleKey(reassembler, parseKeyCode(data.code));
      return;
    }
    if (data.type === 'SWITCH_DECISION') {
      if (data.accept) reassembler.acceptSwitch(data.session);
      else reassembler.declineSwitch(data.session);
      postNotices(reassembler);
      return;
    }
    if (data.type === 'FOUNTAIN_DROPLET' || data.type === 'DROPLET') {
      await handleFrame(data.droplet);
    }
  } catch (err: unknown) {
    post({ type: 'ERROR', error: err instanceof Error && err.message ? err.message : 'Unknown reassembly error' });
  }
};
