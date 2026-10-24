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

  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  };

  // Cancel a file scan when the scanner closes.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    []
  );

  // Client-side QR decoding using the unified deep module scanFile method.
  const processFile = async (file: File) => {
    onStart();
    cancel();
    const controller = new AbortController();
    controllerRef.current = controller;

    setFileError(null);
    setFileProcessing(true);
    onReading();

    try {
      const scanned = await scanFile(file, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (scanned.status === 'pass' && scanned.data) {
        onFound(scanned.data);
      } else if (scanned.error) {
        setFileError(scanned.error);
      }
    } catch (err) {
      const isAbort = isErrorLike(err) && err.name === 'AbortError';
      if (!controller.signal.aborted && !isAbort) {
        setFileError((isErrorLike(err) && err.message) || 'Failed to parse file.');
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setFileProcessing(false);
      }
    }
  };

  /** Retires any running scan and shows image mode for an image that arrived by paste or drop. */
  const beginIncoming = () => {
    onStart();
    cancel();
    setFileProcessing(false);
    onShowImageMode();
  };

  /** Scans an image that arrived by paste or drop. */
  const scanImage = (file: File | undefined) => {
    beginIncoming();
    if (!file || !file.type.startsWith('image/')) {
      setFileError('Please drop an image file.');
      return;
    }
    void processFile(file);
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
    beginIncoming();
    setFileError(null);
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((candidate) => candidate.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          void processFile(new File([blob], 'pasted-image', { type }));
          return;
        }
      }
      setFileError('The clipboard has no image. Copy a screenshot of a QR code, then try again.');
    } catch {
      setFileError('The browser did not allow reading the clipboard. Press Ctrl+V or ⌘V to paste instead.');
    }
  };

  /** Stops any image scan and clears its message (switching input, scanning another). */
  const reset = () => {
    cancel();
    setFileError(null);
    setFileProcessing(false);
  };

  return { fileError, setFileError, fileProcessing, processFile, scanImage, pasteFromClipboard, reset };
}

/** Whether the async clipboard can read images here (`navigator.clipboard.read`). */
export const canReadClipboardImages = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';
