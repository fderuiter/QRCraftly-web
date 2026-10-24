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

import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import { sha256Hex } from '@/packages/core/encoding';
import { analyseReceivedFile } from '@/packages/core/files';
import type { HandshakeInfo } from '../contracts';
import type { ReceivedBundleFile, ReceiverEvent } from './machine';
import type { ReassemblyWorkerMessage, ReceivedFileSaver, ReceiverToast } from './receiverTypes';

const FILE_RECEIVED_MESSAGE = 'File completely received & offline binary reconstruction triggered!';

export interface DeliveryOptions {
  dispatch: Dispatch<ReceiverEvent>;
  saveFile: ReceivedFileSaver;
  addToast?: (toast: ReceiverToast) => void;
  autoDownload: boolean;
  setReceiverError: (message: string | null) => void;
  /** The worker's current run: a completion checked under an older one was cleared meanwhile. */
  currentRun: () => number;
  /** The stream is done: stop the camera and mark the decode finished. */
  onStreamDone: () => void;
}

/**
 * Handing the received file over (#1514): the integrity check, auto-delivery or a manual save,
 * and the bundle path. Moved from `useOpticalReceiver`. The options are read through a ref.
 * @param options - Where to save, how to tell the person, and the receiver's shared setters.
 */
export function useDelivery(options: DeliveryOptions) {
  const [handshake, setHandshake] = useState<HandshakeInfo | null>(null);
  const [receiverSuccess, setReceiverSuccess] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [downloadTriggered, setDownloadTriggered] = useState<boolean>(false);
  const [reassembledData, setReassembledData] = useState<Uint8Array | null>(null);
  const [compilationStatus, setCompilationStatus] = useState<string | null>(null);
  /** The files of a finished multi-file transfer. */
  const [bundle, setBundle] = useState<ReceivedBundleFile[] | null>(null);
  const handshakeRef = useRef<HandshakeInfo | null>(null);
  const reassembledDataRef = useRef<Uint8Array | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  /** Saves a verified file under its announced name and tells the user. */
  const deliverFile = useCallback((data: Uint8Array, hs: HandshakeInfo | null) => {
    setDownloadTriggered(true);
    // The name and type are chosen by whoever is showing the stream: save the sanitised name and a
    // MIME type that agrees with it.
    const analysis = analyseReceivedFile(
      hs?.fileName || `received_file_${Date.now()}.bin`,
      hs?.mimeType || 'application/octet-stream'
    );
    optionsRef.current.saveFile(data, analysis.safeName, analysis.mimeType);
    optionsRef.current.addToast?.({ type: 'success', message: FILE_RECEIVED_MESSAGE, duration: 5000 });
  }, []);

  /** Records a failed reassembly or verification and tells the user. */
  const failReassembly = useCallback((err: unknown) => {
    const errMsg = (err instanceof Error && err.message) || 'Verification or reassembly failed.';
    optionsRef.current.dispatch({ type: 'fail', error: { source: 'receiver', message: errMsg } });
    optionsRef.current.setReceiverError(errMsg);
    setReceiverSuccess(false);
    setReassembledData(null);
    reassembledDataRef.current = null;
    optionsRef.current.addToast?.({ type: 'error', message: errMsg, duration: 5000 });
  }, []);

  /** Clears state after a worker-side failure. */
  const resetAfterWorkerError = useCallback((message: string) => {
    optionsRef.current.dispatch({ type: 'fail', error: { source: 'receiver', message } });
    optionsRef.current.setReceiverError(message);
    setReceiverSuccess(false);
    setReassembledData(null);
    reassembledDataRef.current = null;
    setDownloadTriggered(false);
    setCompilationStatus(null);
    setIsVerifying(false);
  }, []);

  /** Checks bytes against the SHA-256 the transfer announced. */
  const assertIntegrity = useCallback(async (data: Uint8Array, expected: string) => {
    const actual = await sha256Hex(data);
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Integrity validation failed! SHA-256 hash does not match.\nExpected: ${expected}\nActual: ${actual}`);
    }
  }, []);

  const handleWorkerComplete = useCallback(async (message: ReassemblyWorkerMessage) => {
    const { buffer, handshake: workerHandshake, files } = message;
    const { dispatch, setReceiverError, currentRun, onStreamDone } = optionsRef.current;
    const run = currentRun();
    if (files) {
      // Several files: each was verified against its own hash in the worker. They are saved one by
      // one or as an archive, never automatically.
      const received = files.map(({ buffer: data, handshake: hs }) => ({ name: hs.fileName, mimeType: hs.mimeType, size: hs.fileSize, sha256: hs.sha256, data: new Uint8Array(data) }));
      setBundle(received);
      dispatch({ type: 'complete', result: { kind: 'bundle', files: received } });
      onStreamDone();
      setReceiverSuccess(true);
      setReceiverError(null);
      return;
    }
    if (workerHandshake) {
      handshakeRef.current = workerHandshake;
      setHandshake(workerHandshake);
      onStreamDone();
    }
    dispatch({ type: 'verify' });
    try {
      setCompilationStatus('Finalizing download...');
      const reassembled = new Uint8Array(buffer ?? new ArrayBuffer(0));
      reassembledDataRef.current = reassembled;
      setReassembledData(reassembled);

      const activeHandshake = workerHandshake || handshakeRef.current;
      if (activeHandshake?.sha256) {
        await assertIntegrity(reassembled, activeHandshake.sha256);
      }
      // Clear was pressed while the file was checked: the receiver is already waiting for the next one.
      if (run !== currentRun()) return;

      dispatch({ type: 'complete', result: { kind: 'file', handshake: activeHandshake, data: reassembled } });
      setReceiverSuccess(true);
      setReceiverError(null);
      // Risky types (executables, scripts, active documents) are never saved without the person
      // confirming on the completion panel, so auto-download skips them.
      const risky = analyseReceivedFile(activeHandshake?.fileName ?? '', activeHandshake?.mimeType ?? '').risky;
      if (optionsRef.current.autoDownload && !risky) {
        deliverFile(reassembled, activeHandshake);
      }
    } catch (err) {
      if (run === currentRun()) failReassembly(err);
    } finally {
      if (run === currentRun()) {
        setCompilationStatus(null);
        setIsVerifying(false);
      }
    }
  }, [deliverFile, failReassembly, assertIntegrity]);

  /** Saves the received file, after checking it once more against the announced SHA-256. */
  const saveReceivedFile = useCallback(async () => {
    try {
      setIsVerifying(true);
      optionsRef.current.setReceiverError(null);
      const data = reassembledDataRef.current;
      const hs = handshakeRef.current;
      if (!data || !hs) return;
      await assertIntegrity(data, hs.sha256);
      setReceiverSuccess(true);
      deliverFile(data, hs);
    } catch (err) {
      failReassembly(err);
    } finally {
      setIsVerifying(false);
      setCompilationStatus(null);
    }
  }, [assertIntegrity, deliverFile, failReassembly]);

  /** Forgets the received file, as Clear does. */
  const reset = useCallback(() => {
    setBundle(null);
    setHandshake(null);
    handshakeRef.current = null;
    setReceiverSuccess(false);
    setIsVerifying(false);
    setDownloadTriggered(false);
    setReassembledData(null);
    reassembledDataRef.current = null;
    setCompilationStatus(null);
  }, []);

  return {
    handshake,
    receiverSuccess,
    isVerifying,
    downloadTriggered,
    reassembledData,
    compilationStatus,
    bundle,
    handleWorkerComplete,
    resetAfterWorkerError,
    saveReceivedFile,
    reset,
  };
}
