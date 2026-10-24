import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Upload, Volume2, VolumeX } from 'lucide-react';
import { useQrScanner, type CameraScanResult } from '@/packages/optical-scanner/client';
import { Button } from './ui/Button';
import { ScannerCameraControls } from './ScannerCameraControls';
import { SegmentedControl } from './ui/SegmentedControl';
import { ScanResultSheet } from './scanner/ScanResultSheet';
import { describeScan, scanHeadline, type ScanDescription } from './scanner/describeScan';
import { currentScanHistory, rememberScan } from './scanner/scanHistory';
import { useCameraPermission } from './scanner/useCameraPermission';
import { prefersReducedMotion, useScanFeedback } from './scanner/useScanFeedback';
import { canReadClipboardImages, useImageScan } from './scanner/useImageScan';
import { ImageScanPanel } from './scanner/ImageScanPanel';
import { ScanHistoryList } from './scanner/ScanHistoryList';
import { WebcamViewfinder } from './scanner/WebcamViewfinder';

export { clearScanHistory, escapeCsvField, formatScanHistoryCsv } from './scanner/scanHistory';

/** How long the reticle stays locked on the found code before the result sheet opens. */
const LOCK_MS = 450;

/**
 * QRScannerProps definition.
 */
export interface QRScannerProps {
  /** Opens a result in the generator. Without it the result sheet offers no edit action. */
  onEdit?: (scan: ScanDescription) => void;
  /** Label of the edit action on the result sheet. */
  editLabel?: string;
  /** Called with the text of every code found, from the camera or an image. */
  onScanSuccess?: (data: string) => void;
  /**
   * Opens the camera as soon as the scanner shows (default true, for a scanner opened by a
   * click). The standalone page passes false and waits for "Start camera".
   */
  autoStartCamera?: boolean;
}

/**
 * The scanner surface (#1101, #1102): a camera viewfinder whose reticle locks onto the code,
 * image input by file, paste and drop, a result sheet with the safety check and actions, and
 * this tab's recent results. Everything is decoded in the browser.
 * @param props - Component properties.
 * @param props.onEdit - Opens a result in the generator.
 * @param props.editLabel - Label of the edit action.
 * @param props.onScanSuccess - Called with every decoded text.
 * @param props.autoStartCamera - Open the camera on mount.
 * @returns The scanner.
 */
export const QRScanner: React.FC<QRScannerProps> = ({
  onEdit,
  editLabel,
  onScanSuccess,
  autoStartCamera = true,
}) => {
  const [mode, setMode] = useState<'webcam' | 'file'>('webcam');
  const [cameraWanted, setCameraWanted] = useState(autoStartCamera);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ScanDescription | null>(null);
  const [lock, setLock] = useState<CameraScanResult['corners']>(null);
  const [history, setHistory] = useState<ScanDescription[]>(currentScanHistory);
  const [announcement, setAnnouncement] = useState('');
  const permission = useCameraPermission();
  const { soundOn, toggleSound, announceFound, downloadHistory } = useScanFeedback();

  const lockTimerRef = useRef<number | null>(null);
  const foundRef = useRef(false);
  const onScanSuccessRef = useRef(onScanSuccess);
  useEffect(() => {
    onScanSuccessRef.current = onScanSuccess;
  });

  const showResult = useCallback((text: string) => {
    const scan = describeScan(text);
    setLock(null);
    setResult(scan);
    setHistory(rememberScan(scan));
    setAnnouncement(`QR code found: ${scanHeadline(scan)}`);
    onScanSuccessRef.current?.(text);
  }, []);

  // The scan session owns the camera stream, the video element's source and the frame loop.
  const {
    state: camera,
    start,
    stop,
    videoRef,
    scanFile,
    cameras,
    switchCamera,
    setTorch,
    setZoom,
    status: frameStatus,
  } = useQrScanner({
    onScanSuccess: (data, found) => {
      if (foundRef.current) return;
      foundRef.current = true;
      announceFound();
      if (!found?.corners) {
        showResult(data);
        return;
      }
      // Freeze the frame and lock the reticle onto the code before the result opens.
      videoRef.current?.pause();
      setLock(found.corners);
      lockTimerRef.current = window.setTimeout(() => {
        lockTimerRef.current = null;
        showResult(data);
      }, prefersReducedMotion() ? 0 : LOCK_MS);
    },
  });

  /** Drops a camera result that is still waiting to open, so it cannot cover image mode (#1296). */
  const cancelPendingLock = () => {
    if (lockTimerRef.current === null) return;
    window.clearTimeout(lockTimerRef.current);
    lockTimerRef.current = null;
    setLock(null);
  };

  const image = useImageScan({
    scanFile,
    onFound: showResult,
    onStart: cancelPendingLock,
    onShowImageMode: () => {
      setMode('file');
      setResult(null);
    },
    onReading: () => setAnnouncement('Reading the image…'),
  });

  const cameraRunning = mode === 'webcam' && cameraWanted && result === null;

  // Run the camera while it is wanted and no result is showing. start() and stop() are
  // idempotent, so this is safe when React runs the effect twice (StrictMode).
  useEffect(() => {
    if (!cameraRunning) {
      stop();
      return undefined;
    }
    foundRef.current = false;
    void start();
    return () => stop();
  }, [cameraRunning, start, stop]);

  // Cancel a pending lock when the scanner closes.
  useEffect(() => {
    return () => {
      if (lockTimerRef.current !== null) window.clearTimeout(lockTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (camera.status === 'streaming') setAnnouncement('Camera on. Point it at a QR code.');
  }, [camera.status]);

  const switchMode = (next: 'webcam' | 'file') => {
    cancelPendingLock();
    image.reset();
    setMode(next);
    setResult(null);
    if (next === 'webcam') setCameraWanted(true);
  };

  const scanAnother = () => {
    setResult(null);
    setLock(null);
    image.setFileError(null);
    setAnnouncement('');
  };

  // Drop an image anywhere on the scanner.
  const dropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer?.types?.includes?.('Files') && !e.dataTransfer?.files?.length) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDragging(false);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) image.scanImage(file);
    },
  };

  const streamingCamera = camera.status === 'streaming' ? camera.camera : null;
  const canPaste = canReadClipboardImages();
  const pasteImage = () => void image.pasteFromClipboard();

  let statusLine = 'Point at a QR code';
  if (lock) statusLine = 'Got it';
  else if (camera.status === 'requesting') statusLine = 'Starting the camera…';
  else if (frameStatus === 'pass') statusLine = 'Hold steady';

  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface" {...dropHandlers} data-testid="qr-scanner">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {result ? (
        <ScanResultSheet scan={result} onEdit={onEdit} editLabel={editLabel} onScanAnother={scanAnother} />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 border-b border-line-subtle bg-surface-sunken p-3">
            <SegmentedControl<'webcam' | 'file'>
              label="Scanner input"
              value={mode}
              onChange={switchMode}
              options={[
                {
                  value: 'webcam',
                  label: (
                    <>
                      <Camera className="size-4" aria-hidden="true" />
                      Camera
                    </>
                  ),
                },
                {
                  value: 'file',
                  label: (
                    <>
                      <Upload className="size-4" aria-hidden="true" />
                      Image
                    </>
                  ),
                },
              ]}
            />
            {mode === 'webcam' && (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                pressed={soundOn}
                onClick={toggleSound}
                aria-label="Scan sound"
                title={soundOn ? 'Mute scan sound' : 'Unmute scan sound'}
              >
                {soundOn ? (
                  <Volume2 className="size-4" aria-hidden="true" />
                ) : (
                  <VolumeX className="size-4" aria-hidden="true" />
                )}
              </Button>
            )}
          </div>
          <div className="relative h-[60vh] max-h-160 min-h-72 w-full">
            {mode === 'webcam' ? (
              <WebcamViewfinder
                camera={camera}
                videoRef={videoRef}
                cameraWanted={cameraWanted}
                lock={lock}
                statusLine={statusLine}
                permission={permission}
                canPaste={canPaste}
                onStartCamera={() => setCameraWanted(true)}
                onScanImage={() => switchMode('file')}
                onPaste={pasteImage}
                onRetry={() => void start()}
                onZoom={(value) => void setZoom(value)}
              />
            ) : (
              <ImageScanPanel
                dragging={dragging}
                fileError={image.fileError}
                fileProcessing={image.fileProcessing}
                canPaste={canPaste}
                onFile={(file) => void image.processFile(file)}
                onPaste={pasteImage}
              />
            )}
          </div>
          {mode === 'webcam' && streamingCamera && (
            <ScannerCameraControls
              camera={streamingCamera}
              cameras={cameras}
              onSwitchCamera={(deviceId) => void switchCamera(deviceId)}
              onTorch={(on) => void setTorch(on)}
              onZoom={(value) => void setZoom(value)}
            />
          )}
        </>
      )}
      <ScanHistoryList history={history} onOpen={setResult} onExport={() => downloadHistory(history)} />
      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-soft/90 text-base font-semibold text-accent">
          Drop the image to scan it
        </div>
      )}
    </div>
  );
};
