import { useEffect, useRef, useState } from 'react';
import type { useQrScanner } from '@/packages/optical-scanner/client';

/**
 * Error-like check that also accepts `DOMException`s, which are not `Error` instances in
 * every runtime (jsdom).
 */
const isErrorLike = (value: unknown): value is Error =>
  typeof value === 'object' && value !== null && 'name' in value && 'message' in value;

interface UseImageScanOptions {
  /** The scan session's image decoder. */
  scanFile: ReturnType<typeof useQrScanner>['scanFile'];
  /** Called with the text of a code found in an image. */
  onFound: (text: string) => void;
  /** Called as any image scan starts, so a camera result still waiting cannot cover it (#1296). */
  onStart: () => void;
  /** Called when an image arrives by paste or drop, so image mode shows its errors. */
  onShowImageMode: () => void;
  /** Called when decoding an image begins (for the live announcement). */
  onReading: () => void;
}

/**
 * Image input for the scanner (#1603): chosen files, pasted and dropped images, and the clipboard
 * button. Each new image retires the scan still running, so it cannot overwrite this one (#1588).
 * @returns The image scan state and its entry points.
 */
export function useImageScan({ scanFile, onFound, onStart, onShowImageMode, onReading }: UseImageScanOptions) {
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileProcessing, setFileProcessing] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Each image input (file pick, drop, paste, clipboard button) is one operation. It owns the
  // clipboard read, the item lookup and the decode. Starting another input, reset or unmount
  // retires it (#1704): clipboard promises cannot be cancelled, so every later step checks it.
  const operationRef = useRef(0);

  /**
   * Retires the current input operation and aborts its decode.
   * @returns The new operation's id.
   */
  const retire = () => {
    operationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    return operationRef.current;
  };
  const isCurrent = (operation: number) => operationRef.current === operation;

  // Retire the image operation when the scanner closes.
  useEffect(
    () => () => {
      operationRef.current += 1;
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    []
  );

  /** Decodes an image for an operation that is still current. */
  const decode = async (file: File, operation: number) => {
    const controller = new AbortController();
    controllerRef.current = controller;

    setFileError(null);
    setFileProcessing(true);
    onReading();

    try {
      const scanned = await scanFile(file, { signal: controller.signal });
      if (controller.signal.aborted || !isCurrent(operation)) return;
      if (scanned.status === 'pass' && scanned.data) {
        onFound(scanned.data);
      } else if (scanned.error) {
        setFileError(scanned.error);
      }
    } catch (err) {
      const isAbort = isErrorLike(err) && err.name === 'AbortError';
      if (!controller.signal.aborted && !isAbort && isCurrent(operation)) {
        setFileError((isErrorLike(err) && err.message) || 'Failed to parse file.');
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setFileProcessing(false);
      }
    }
  };

  // Client-side QR decoding using the unified deep module scanFile method.
  const processFile = async (file: File) => {
    onStart();
    await decode(file, retire());
  };

  /** Retires any running scan and shows image mode for an image that arrived by paste or drop. */
  const beginIncoming = () => {
    onStart();
    const operation = retire();
    setFileProcessing(false);
    onShowImageMode();
    return operation;
  };

  /** Scans an image that arrived by paste or drop. */
  const scanImage = (file: File | undefined) => {
    const operation = beginIncoming();
    if (!file || !file.type.startsWith('image/')) {
      setFileError('Please drop an image file.');
      return;
    }
    void decode(file, operation);
  };
  const scanImageRef = useRef(scanImage);
  useEffect(() => {
    scanImageRef.current = scanImage;
  });

  // Ctrl/Cmd+V anywhere on the page pastes a screenshot while the scanner is open.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith('image/'));
      if (!image) return;
      event.preventDefault();
      scanImageRef.current(image);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const pasteFromClipboard = async () => {
    const operation = beginIncoming();
    setFileError(null);
    try {
      const items = await navigator.clipboard.read();
      if (!isCurrent(operation)) return;
      for (const item of items) {
        const type = item.types.find((candidate) => candidate.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          if (!isCurrent(operation)) return;
          onStart();
          void decode(new File([blob], 'pasted-image', { type }), operation);
          return;
        }
      }
      setFileError('The clipboard has no image. Copy a screenshot of a QR code, then try again.');
    } catch {
      if (!isCurrent(operation)) return;
      setFileError('The browser did not allow reading the clipboard. Press Ctrl+V or ⌘V to paste instead.');
    }
  };

  /** Stops any image scan and clears its message (switching input, scanning another). */
  const reset = () => {
    retire();
    setFileError(null);
    setFileProcessing(false);
  };

  return { fileError, setFileError, fileProcessing, processFile, scanImage, pasteFromClipboard, reset };
}

/** Whether the async clipboard can read images here (`navigator.clipboard.read`). */
export const canReadClipboardImages = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';
