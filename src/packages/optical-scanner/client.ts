import { useState, useEffect, useRef, useCallback } from 'react';
import type { ScanResult, ScanOptions, ScannerStatus } from './lib/contracts';
import { scanSource } from './lib/sourceExtractor';
import {
  createCameraScannerEngine,
  type CameraScannerEngine,
  type CameraScannerEngineMetrics,
  type CameraScanResult,
} from './lib/cameraEngine';
import {
  createCameraSession,
  type CameraDevice,
  type CameraFrameLoop,
  type CameraSession,
  type CameraSessionStartOptions,
  type CameraSessionState,
} from './lib/cameraSession';

export type {
  CameraDevice,
  CameraFrameLoop,
  CameraInfo,
  CameraProblemStatus,
  CameraSessionState,
  CameraSessionStartOptions,
} from './lib/cameraSession';
export type { CameraScanResult } from './lib/cameraEngine';
export type { ScanCorners } from './lib/contracts';

const IDLE_CAMERA: CameraSessionState = { status: 'idle' };

/**
 * The camera the user last switched to, remembered in memory for this page only (#1100). It is
 * never written to storage, so it is forgotten on reload.
 */
let chosenCameraId: string | undefined;

/** Interval at which high-frequency engine diagnostics are flushed into React state. */
const STATE_FLUSH_INTERVAL_MS = 250;
const INITIAL_SAMPLING_DELAY = 33;

/**
 * Configuration options for the useQrScanner hook.
 */
export interface UseQrScannerOptions {
  /**
   * React ref pointing to the HTMLVideoElement of the active camera stream.
   */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /**
   * Callback invoked when a QR code is decoded from the stream and confirmed: its text and the full
   * result (payload bytes, corners, which decoder read it).
   */
  onScanSuccess?: (data: string, result: CameraScanResult) => void;
  /**
   * Callback invoked when a stream frame fails to decode or has an error.
   */
  onScanFail?: (error?: string) => void;
  /**
   * Minimum sleep delay between frame capture executions in milliseconds.
   */
  minSamplingDelay?: number;
  /**
   * Maximum sleep delay between frame capture executions in milliseconds.
   */
  maxSamplingDelay?: number;
  /**
   * Agreeing decodes needed before a camera result is reported (default 2, within 500 ms; the
   * platform detector needs one). Read once, when scanning first starts.
   */
  confirmations?: 1 | 2;
  /**
   * How long the same payload is not reported again, in milliseconds (default 3000; 0 reports every
   * decode). Read once, when scanning first starts.
   */
  repeatHoldMs?: number;
  /**
   * Runs this loop instead of the scanner's own while the camera streams, for a caller that reads
   * the frames itself (Prism's multi-code receiver, #1142). Read each time the camera starts.
   */
  frameLoop?: CameraFrameLoop | null;
}

/**
 * Result object returned by the useQrScanner hook.
 */
export interface UseQrScannerResult {
  /**
   * The camera: `idle`, `requesting`, `streaming`, or `denied` / `unavailable` / `error` with the
   * error that caused it.
   */
  state: CameraSessionState;
  /**
   * Opens the camera in `videoRef`'s element and starts scanning. Idempotent: calling it while the
   * camera is requested or streaming does nothing, so it is safe in effects that run twice.
   */
  start: (options?: CameraSessionStartOptions) => Promise<void>;
  /** Releases the camera (every track), detaches the element and stops scanning. Idempotent. */
  stop: () => void;
  /** The element the camera is shown in: the one passed in, or one the hook owns. */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** The cameras the user can switch to, listed once the camera streams. */
  cameras: CameraDevice[];
  /** Switches to another camera (the old one is released first) and remembers it for this page. */
  switchCamera: (deviceId: string) => Promise<void>;
  /** Turns the torch on or off where the camera has one; resolves whether it worked. */
  setTorch: (on: boolean) => Promise<boolean>;
  /** Zooms where the camera supports it; resolves whether it worked. */
  setZoom: (value: number) => Promise<boolean>;
  /**
   * Whether the background frame-sampling loop is currently active.
   */
  isScanning: boolean;
  /**
   * The current status of the scannability check.
   */
  status: 'idle' | 'checking' | 'pass' | 'fail';
  /**
   * The current dynamic sampling sleep delay in milliseconds.
   */
  samplingDelay: number;
  /**
   * An array containing the last three round-trip execution durations of the worker check cycles.
   */
  latencyHistory: number[];
  /**
   * Starts the frame loop on a source the caller attached itself (for example a video file).
   * Camera scanning uses `start` instead, which owns the stream.
   */
  startScanning: () => void;
  /**
   * Stops the frame loop started by `startScanning`.
   */
  stopScanning: () => void;
  /**
   * Scans an image file (photo or screenshot), off the main thread where the browser allows.
   */
  scanFile: (file: File, options?: ScanOptions) => Promise<ScanResult>;
}

/**
 * Thin React adapter over the Camera Session and the Camera Scanner Engine: creates them lazily,
 * keeps the sampling bounds in sync, bridges their events into (batched) React state and destroys
 * them on unmount. The camera stream and the background worker are private to the package.
 */
export function useQrScanner({
  videoRef,
  onScanSuccess,
  onScanFail,
  minSamplingDelay = 16,
  maxSamplingDelay = 1000,
  confirmations,
  repeatHoldMs,
  frameLoop,
}: UseQrScannerOptions = {}): UseQrScannerResult {
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [samplingDelay, setSamplingDelay] = useState<number>(INITIAL_SAMPLING_DELAY);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [cameraState, setCameraState] = useState<CameraSessionState>(IDLE_CAMERA);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const ownVideoRef = useRef<HTMLVideoElement | null>(null);
  const resolvedVideoRef = videoRef ?? ownVideoRef;

  const latest = useRef({ videoRef: resolvedVideoRef, onScanSuccess, onScanFail, frameLoop });
  useEffect(() => {
    latest.current = { videoRef: resolvedVideoRef, onScanSuccess, onScanFail, frameLoop };
  }, [resolvedVideoRef, onScanSuccess, onScanFail, frameLoop]);
  /** The caller's loop while it runs in place of the scanner's own. */
  const runningLoopRef = useRef<CameraFrameLoop | null>(null);

  const pending = useRef<{ status: ScannerStatus; metrics: CameraScannerEngineMetrics; dirty: boolean }>({
    status: 'idle',
    metrics: { samplingDelay: INITIAL_SAMPLING_DELAY, latencyHistory: [] },
    dirty: false,
  });
  const boundsRef = useRef({ minSamplingDelay, maxSamplingDelay });
  const acceptanceRef = useRef({ confirmations, repeatHoldMs });
  const engineRef = useRef<CameraScannerEngine | null>(null);
  const sessionRef = useRef<CameraSession | null>(null);

  const getEngine = useCallback((): CameraScannerEngine => {
    if (engineRef.current) return engineRef.current;
    const engine = createCameraScannerEngine({
      ...boundsRef.current,
      ...acceptanceRef.current,
      getSource: () => latest.current.videoRef?.current ?? null,
    });
    engine.subscribe({
      onScanSuccess: (data, result) => latest.current.onScanSuccess?.(data, result),
      onScanFail: (error) => latest.current.onScanFail?.(error),
      onStatusChange: (next) => {
        pending.current.status = next;
        pending.current.dirty = true;
      },
      onMetricsChange: (metrics) => {
        pending.current.metrics = metrics;
        pending.current.dirty = true;
      },
    });
    engineRef.current = engine;
    return engine;
  }, []);

  useEffect(() => {
    boundsRef.current = { minSamplingDelay, maxSamplingDelay };
    engineRef.current?.setOptions({ minSamplingDelay, maxSamplingDelay });
  }, [minSamplingDelay, maxSamplingDelay]);

  // Batch high-frequency diagnostics so a 60 FPS loop does not re-render the tree every frame.
  useEffect(() => {
    if (!isScanning) return;
    const intervalId = setInterval(() => {
      const snapshot = pending.current;
      if (!snapshot.dirty) return;
      snapshot.dirty = false;
      setStatus(snapshot.status);
      setSamplingDelay(snapshot.metrics.samplingDelay);
      setLatencyHistory(snapshot.metrics.latencyHistory);
    }, STATE_FLUSH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [isScanning]);

  useEffect(() => {
    return () => {
      sessionRef.current?.destroy();
      sessionRef.current = null;
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, []);

  const startScanning = useCallback(() => {
    setIsScanning(true);
    getEngine().start();
  }, [getEngine]);

  const stopScanning = useCallback(() => {
    setIsScanning(false);
    engineRef.current?.stop();
    pending.current.status = 'idle';
    pending.current.dirty = false;
    setStatus('idle');
  }, []);

  const getSession = useCallback((): CameraSession => {
    if (sessionRef.current) return sessionRef.current;
    const session = createCameraSession({
      getVideo: () => latest.current.videoRef.current,
      loop: {
        start: () => {
          const custom = latest.current.frameLoop ?? null;
          runningLoopRef.current = custom;
          if (custom) custom.start();
          else startScanning();
        },
        stop: () => {
          runningLoopRef.current?.stop();
          runningLoopRef.current = null;
          stopScanning();
        },
      },
    });
    session.subscribe(setCameraState);
    sessionRef.current = session;
    return session;
  }, [startScanning, stopScanning]);

  const start = useCallback(
    async (options?: CameraSessionStartOptions) => {
      const session = getSession();
      const remembered = options?.deviceId === undefined ? chosenCameraId : undefined;
      await session.start({ ...options, deviceId: options?.deviceId ?? remembered });
      // The remembered camera is gone (unplugged): forget it and open the default one.
      if (remembered && session.getState().status === 'unsupported') {
        chosenCameraId = undefined;
        await session.start({ ...options, deviceId: undefined });
      }
    },
    [getSession]
  );

  const switchCamera = useCallback(
    (deviceId: string) => {
      chosenCameraId = deviceId;
      return getSession().start({ deviceId });
    },
    [getSession]
  );

  const setTorch = useCallback((on: boolean) => sessionRef.current?.setTorch(on) ?? Promise.resolve(false), []);
  const setZoom = useCallback((value: number) => sessionRef.current?.setZoom(value) ?? Promise.resolve(false), []);

  // Device names are only readable once permission is granted, so list the cameras when streaming.
  const streaming = cameraState.status === 'streaming';
  useEffect(() => {
    if (!streaming) return undefined;
    let cancelled = false;
    void sessionRef.current?.listCameras().then((list) => {
      if (!cancelled) setCameras(list);
    });
    return () => {
      cancelled = true;
    };
  }, [streaming]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

  const scanFile = useCallback(async (file: File, options?: ScanOptions): Promise<ScanResult> => {
    return scanSource(file, options);
  }, []);

  return {
    state: cameraState,
    start,
    stop,
    videoRef: resolvedVideoRef,
    cameras,
    switchCamera,
    setTorch,
    setZoom,
    isScanning,
    status,
    samplingDelay,
    latencyHistory,
    startScanning,
    stopScanning,
    scanFile,
  };
}
