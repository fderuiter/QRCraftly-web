import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Camera, Copy, FileImage, RefreshCw, Upload } from 'lucide-react';
import {
  useQrScanner,
  type CameraProblemStatus,
  type CameraScanResult,
  type CameraSessionState,
} from '@/packages/optical-scanner/client';
import { Button } from './ui/Button';
import { ScannerCameraControls } from './ScannerCameraControls';
import { EmptyState } from './ui/EmptyState';
import { SegmentedControl } from './ui/SegmentedControl';
import { useViewfinderGeometry, toViewfinder, type Geometry } from './scanner/viewfinderGeometry';
import { ScanResultSheet } from './scanner/ScanResultSheet';
import { describeScan, scanHeadline, type ScanDescription } from './scanner/describeScan';

/**
 * Error-like check that also accepts `DOMException`s, which are not `Error` instances in
 * every runtime (jsdom).
 */
const isErrorLike = (value: unknown): value is Error =>
  typeof value === 'object' && value !== null && 'name' in value && 'message' in value;

/** What each camera problem is called and how to get past it (#1100). */
const CAMERA_PROBLEMS: Record<CameraProblemStatus, { title: string; body: string; retry: boolean }> = {
  denied: { title: 'Camera Access Denied', body: 'You can still scan a QR code from a photo or screenshot.', retry: false },
  unavailable: {
    title: 'No Camera Found',
    body: 'This device has no camera the browser can use. You can still scan a QR code from a photo or screenshot.',
    retry: false,
  },
  busy: {
    title: 'Camera In Use',
    body: 'Another app or browser tab is using the camera. Close it and try again, or scan a photo or screenshot instead.',
    retry: true,
  },
  unsupported: {
    title: 'Camera Not Supported',
    body: 'This camera cannot stream at a size the scanner can use. Try another camera, or scan a photo or screenshot.',
    retry: true,
  },
  error: { title: 'Camera Unavailable', body: 'You can still scan a QR code from a photo or screenshot.', retry: true },
};

type CameraProblem = Extract<CameraSessionState, { error: Error }>;

const isCameraProblem = (state: CameraSessionState): state is CameraProblem => 'error' in state;

/** How long the reticle stays locked on the found code before the result sheet opens. */
const LOCK_MS = 450;
/** Results kept for this tab (#1101). */
const HISTORY_LIMIT = 5;

/**
 * Recent results, newest first, in module memory for this tab only: never stored, so a reload
 * clears them. They survive closing and reopening the scanner.
 */
let sessionHistory: ScanDescription[] = [];

/** Forgets this tab's scan history (tests). */
export function clearScanHistory(): void {
  sessionHistory = [];
}

function rememberScan(scan: ScanDescription): ScanDescription[] {
  sessionHistory = [scan, ...sessionHistory.filter((item) => item.text !== scan.text)].slice(0, HISTORY_LIMIT);
  return sessionHistory;
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Platform-specific instructions for resolving camera permission issues. */
function getPlatformInstructions(): string {
  if (typeof navigator === 'undefined') {
    return 'Please enable camera access in your system settings.';
  }
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  if (isIOS) {
    return 'Open iOS Settings, go to your active Browser (e.g., Safari/Chrome), and ensure Camera access is set to "Allow".';
  }
  if (/Android/.test(ua)) {
    return 'Open Android Settings, go to Apps > [Browser Name] > Permissions, and enable Camera access.';
  }
  if (/Macintosh|Mac OS X/.test(ua)) {
    return 'Open macOS System Settings > Privacy & Security > Camera, and ensure your browser is allowed to access the camera.';
  }
  if (/Windows/.test(ua)) {
    return 'Open Windows Settings > Privacy & Security > Camera, and toggle "Let apps access your camera" and your browser to ON.';
  }
  return "Click the padlock or site control icon next to the URL in your browser's address bar, and allow Camera permissions.";
}

/** Whether the async clipboard can read images here (`navigator.clipboard.read`). */
const canReadClipboardImages = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';

/** Two-finger pinch on the viewfinder sets the zoom (touch screens). */
function usePinchZoom(zoom: { min: number; max: number; value: number } | null, setZoom: (value: number) => void) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ distance: number; zoom: number } | null>(null);
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = (event: React.PointerEvent) => {
    if (!zoom || event.pointerType !== 'touch') return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2) start.current = { distance: distance(), zoom: zoom.value };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!zoom || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const from = start.current;
    if (!from || from.distance === 0 || pointers.current.size !== 2) return;
    setZoom(Math.min(zoom.max, Math.max(zoom.min, from.zoom * (distance() / from.distance))));
  };
  const onPointerEnd = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) start.current = null;
  };
  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd };
}

/**
 * The reticle: the centre square the decoder searches first (the camera engine's region of
 * interest), drawn no larger than 70% of the viewfinder.
 */
function reticleFor(g: Geometry) {
  const scale = Math.max(g.cw / g.vw, g.ch / g.vh);
  const side = Math.min(Math.min(g.vw, g.vh) * scale, Math.min(g.cw, g.ch) * 0.7);
  return { x: (g.cw - side) / 2, y: (g.ch - side) / 2, side };
}

/** The dimmed overlay with a clear reticle, which locks onto the code's corners once found. */
function ViewfinderOverlay({ geometry, lock, mirrored }: { geometry: Geometry | null; lock: CameraScanResult['corners']; mirrored: boolean }) {
  if (!geometry) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <div className="aspect-square w-3/5 max-w-72 rounded-xl border-3 border-white/80" />
      </div>
    );
  }
  const { cw, ch } = geometry;
  const r = reticleFor(geometry);
  const square = `M${r.x} ${r.y}H${r.x + r.side}V${r.y + r.side}H${r.x}Z`;
  const quad = lock
    ? `M${lock
        .map((point) => toViewfinder(point, geometry, mirrored))
        .map(({ x, y }) => `${x} ${y}`)
        .join('L')}Z`
    : null;
  const hole = quad ?? square;
  return (
    <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${cw} ${ch}`} aria-hidden="true" data-testid="scanner-reticle">
      <path fillRule="evenodd" fill="black" fillOpacity={0.5} d={`M0 0H${cw}V${ch}H0Z${hole}`} />
      <path
        d={hole}
        fill="none"
        stroke="currentColor"
        strokeWidth={4}
        strokeLinejoin="round"
        className={quad ? 'text-emerald-400' : 'text-white'}
        data-locked={quad ? 'true' : undefined}
      />
    </svg>
  );
}

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
export const QRScanner: React.FC<QRScannerProps> = ({ onEdit, editLabel, onScanSuccess, autoStartCamera = true }) => {
  const [mode, setMode] = useState<'webcam' | 'file'>('webcam');
  const [cameraWanted, setCameraWanted] = useState(autoStartCamera);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileProcessing, setFileProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ScanDescription | null>(null);
  const [lock, setLock] = useState<CameraScanResult['corners']>(null);
  const [history, setHistory] = useState<ScanDescription[]>(() => sessionHistory);
  const [announcement, setAnnouncement] = useState('');

  const ids = useId();
  const fileErrorId = `${ids}-file-error`;
  const imageTitleId = `${ids}-image-title`;
  const imageHelpId = `${ids}-image-help`;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileAbortControllerRef = useRef<AbortController | null>(null);
  const viewfinderRef = useRef<HTMLDivElement | null>(null);
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
      if (!prefersReducedMotion() && typeof navigator.vibrate === 'function') navigator.vibrate(30);
      if (!found?.corners) {
        showResult(data);
        return;
      }
      // Freeze the frame and lock the reticle onto the code before the result opens.
      videoRef.current?.pause();
      setLock(found.corners);
      lockTimerRef.current = window.setTimeout(() => showResult(data), prefersReducedMotion() ? 0 : LOCK_MS);
    },
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

  // Cancel a file scan and a pending lock when the scanner closes.
  useEffect(() => {
    return () => {
      fileAbortControllerRef.current?.abort();
      fileAbortControllerRef.current = null;
      if (lockTimerRef.current !== null) window.clearTimeout(lockTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (camera.status === 'streaming') setAnnouncement('Camera on. Point it at a QR code.');
  }, [camera.status]);

  const cancelFileScan = () => {
    fileAbortControllerRef.current?.abort();
    fileAbortControllerRef.current = null;
  };

  // Client-side QR decoding using the unified deep module scanFile method.
  const processFile = async (file: File) => {
    cancelFileScan();
    const controller = new AbortController();
    fileAbortControllerRef.current = controller;

    setFileError(null);
    setFileProcessing(true);
    setAnnouncement('Reading the image...');

    try {
      const scanned = await scanFile(file, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (scanned.status === 'pass' && scanned.data) {
        showResult(scanned.data);
      } else if (scanned.error) {
        setFileError(scanned.error);
      }
    } catch (err) {
      const isAbort = isErrorLike(err) && err.name === 'AbortError';
      if (!controller.signal.aborted && !isAbort) {
        setFileError((isErrorLike(err) && err.message) || 'Failed to parse file.');
      }
    } finally {
      if (fileAbortControllerRef.current === controller) {
        fileAbortControllerRef.current = null;
        setFileProcessing(false);
      }
    }
  };

  /** Scans an image that arrived by paste or drop, showing image mode so errors are visible. */
  const scanImage = (file: File | undefined) => {
    setMode('file');
    setResult(null);
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
    setMode('file');
    setResult(null);
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

  const switchMode = (next: 'webcam' | 'file') => {
    cancelFileScan();
    setMode(next);
    setResult(null);
    setFileError(null);
    setFileProcessing(false);
    if (next === 'webcam') setCameraWanted(true);
  };

  const scanAnother = () => {
    setResult(null);
    setLock(null);
    setFileError(null);
    setAnnouncement('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processFile(file);
      e.target.value = '';
    }
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
      if (file) scanImage(file);
    },
  };

  const streamingCamera = camera.status === 'streaming' ? camera.camera : null;
  const pinch = usePinchZoom(streamingCamera?.zoom ?? null, (value) => void setZoom(value));
  const geometry = useViewfinderGeometry(viewfinderRef, videoRef, camera.status === 'streaming');
  const mirrored = streamingCamera?.facing === 'user';

  let statusLine = 'Point at a QR code';
  if (lock) statusLine = 'Got it';
  else if (camera.status === 'requesting') statusLine = 'Starting the camera...';
  else if (frameStatus === 'pass') statusLine = 'Hold steady';

  const imageButtons = (
    <>
      <Button variant="primary" onClick={() => fileInputRef.current?.click()} aria-describedby={fileError ? fileErrorId : undefined}>
        <Upload className="size-4" aria-hidden="true" />
        Choose image
      </Button>
      {canReadClipboardImages() && (
        <Button variant="secondary" onClick={() => void pasteFromClipboard()}>
          <Copy className="size-4" aria-hidden="true" />
          Paste image
        </Button>
      )}
    </>
  );

  const renderCameraProblem = () => {
    if (!isCameraProblem(camera)) return null;
    const denied = camera.status === 'denied';
    const problem = CAMERA_PROBLEMS[camera.status];
    // Lead with the ways that work without a camera; permission help is secondary.
    return (
      <div className="absolute inset-0 flex flex-col gap-3 overflow-y-auto bg-surface p-4">
        <p className="sr-only" role="alert">
          {problem.title}. {problem.body}
        </p>
        <EmptyState
          illustration={<FileImage className="size-6" />}
          title={problem.title}
          body={problem.body}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="primary" onClick={() => switchMode('file')}>
                <Upload className="size-4" aria-hidden="true" />
                Scan from an image instead
              </Button>
              {canReadClipboardImages() && (
                <Button variant="secondary" onClick={() => void pasteFromClipboard()}>
                  <Copy className="size-4" aria-hidden="true" />
                  Paste a screenshot
                </Button>
              )}
            </div>
          }
        />
        {denied && (
          <div className="flex flex-col items-center gap-2 text-center text-xs text-fg-muted">
            <p className="max-w-sm">To use the camera: {getPlatformInstructions()}</p>
            <Button variant="ghost" size="sm" onClick={() => void start()}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Retry Permission
            </Button>
          </div>
        )}
        {problem.retry && (
          <div className="flex justify-center">
            <Button variant="ghost" size="sm" onClick={() => void start()}>
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Try the camera again
            </Button>
          </div>
        )}
      </div>
    );
  };

  // The video element stays mounted so the session always has an element to attach the camera
  // to, including after a retried permission request.
  const renderWebcamViewfinder = () => (
    <div ref={viewfinderRef} className={`relative size-full bg-black ${streamingCamera?.zoom ? 'touch-none' : ''}`} {...pinch}>
      {/* Only a user-facing camera is mirrored, and only on screen: the decoder always reads the
          frames as the camera sees them. */}
      <video
        ref={videoRef}
        className={`size-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
        autoPlay
        playsInline
        muted
        aria-label="Webcam feed"
        aria-describedby={`${ids}-status-line`}
      />
      {camera.status === 'streaming' && <ViewfinderOverlay geometry={geometry} lock={lock} mirrored={mirrored} />}
      {!cameraWanted && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface p-6 text-center">
          <Camera className="size-8 text-accent" aria-hidden="true" />
          <p className="max-w-sm text-sm text-fg-muted">
            The browser asks to use your camera. The video stays on this device and the camera turns off when you leave.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => setCameraWanted(true)}>
              <Camera className="size-4" aria-hidden="true" />
              Start camera
            </Button>
            <Button variant="secondary" onClick={() => switchMode('file')}>
              <Upload className="size-4" aria-hidden="true" />
              Scan an image
            </Button>
          </div>
        </div>
      )}
      {cameraWanted && (camera.status === 'requesting' || camera.status === 'streaming') && (
        <p
          id={`${ids}-status-line`}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-sm font-medium whitespace-nowrap text-white"
        >
          {statusLine}
        </p>
      )}
      {renderCameraProblem()}
    </div>
  );

  const renderFileInput = () => (
    <section
      aria-labelledby={imageTitleId}
      aria-describedby={imageHelpId}
      className={`flex size-full flex-col items-center justify-center gap-3 border-2 border-dashed p-6 text-center ${
        dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface-sunken'
      }`}
    >
      <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} aria-label="Upload QR code image file" />
      <FileImage className="size-10 text-fg-muted" aria-hidden="true" />
      <h3 id={imageTitleId} className="text-base font-semibold text-fg">
        Scan from an image
      </h3>
      <p id={imageHelpId} className="max-w-sm text-sm text-fg-muted">
        Choose a photo or screenshot, paste one with Ctrl+V or ⌘V, or drop it anywhere on the scanner. It never leaves this device.
      </p>
      <div className="flex flex-wrap justify-center gap-2">{imageButtons}</div>
      {fileProcessing && (
        <p className="flex items-center gap-2 text-sm font-medium text-fg-soft">
          <RefreshCw className="size-4 text-accent motion-safe:animate-spin" aria-hidden="true" />
          Processing file...
        </p>
      )}
      {fileError && (
        <p id={fileErrorId} role="alert" className="max-w-sm rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {fileError}
        </p>
      )}
    </section>
  );

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
          </div>
          <div className="relative h-[60vh] max-h-160 min-h-72 w-full">
            {mode === 'webcam' ? renderWebcamViewfinder() : renderFileInput()}
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
      {history.length > 0 && (
        <details className="border-t border-line-subtle px-4 py-3 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-fg-soft">
            Recent scans in this tab ({history.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {history.map((item) => (
              <li key={item.text}>
                <Button variant="ghost" size="sm" className="max-w-full" onClick={() => setResult(item)}>
                  <span className="truncate">{scanHeadline(item)}</span>
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-fg-muted">Kept in memory only. Reloading the page clears them.</p>
        </details>
      )}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-soft/90 text-base font-semibold text-accent">
          Drop the image to scan it
        </div>
      )}
    </div>
  );
};
