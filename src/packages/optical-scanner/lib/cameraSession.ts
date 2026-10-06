/**
 * Camera Session: the one owner of a live camera for scanning (#1097).
 *
 * A session acquires the camera stream, attaches it to the video element, starts the frame loop
 * (the Camera Scanner Engine) and undoes all of that on `stop()`. Both calls are idempotent and
 * safe in any order, so React effects that run twice (StrictMode, fast remounts) cannot leave the
 * viewfinder black or a camera running:
 *
 * - `start()` while a request is pending or the camera is streaming does nothing;
 * - a `start()` superseded by `stop()` (or by a newer `start()`) releases its stream as soon as
 *   `getUserMedia` resolves;
 * - `stop()` stops every track, detaches the element and stops the loop.
 *
 * The session also releases the camera while the page is hidden and re-acquires it when the page
 * is shown again, so the camera light never stays on in a background tab.
 *
 * Capture quality and controls (#1100): the session asks for 1080p at up to 30 fps from the rear
 * camera, stepping down to 720p and then to any size if the camera cannot do that, turns on
 * continuous focus where the camera offers it, and exposes the torch and zoom only where the
 * camera supports them. Every capability is feature-detected.
 */

/** What the streaming camera is and what it can do. */
export interface CameraInfo {
  /** The camera's device id, when the browser reports it. */
  deviceId: string | null;
  /** Which way it faces, when the browser reports it. */
  facing: 'user' | 'environment' | null;
  /** The size it streams at (0 when unknown). */
  width: number;
  height: number;
  /** The frame rate it streams at (0 when unknown). */
  frameRate: number;
  /** The torch (flashlight): whether the camera has one, and whether it is on. */
  torch: { supported: boolean; on: boolean };
  /** Optical or digital zoom range and current value, or null when the camera has none. */
  zoom: { min: number; max: number; step: number; value: number } | null;
}

/** A camera the user can switch to. */
export interface CameraDevice {
  deviceId: string;
  /** The browser's name for it (may be empty). */
  label: string;
}

/** Camera state as the UI shows it. */
export type CameraSessionState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'streaming'; camera: CameraInfo }
  | { status: 'denied'; error: Error }
  | { status: 'unavailable'; error: Error }
  | { status: 'busy'; error: Error }
  | { status: 'unsupported'; error: Error }
  | { status: 'error'; error: Error };

/** The camera states that carry an error, and so explain themselves in the UI. */
export type CameraProblemStatus = 'denied' | 'unavailable' | 'busy' | 'unsupported' | 'error';

/** The parts of `HTMLVideoElement` the session drives. */
export interface CameraVideoElement {
  srcObject: MediaProvider | null;
  play(): Promise<void> | void;
  pause(): void;
}

/** The parts of `document` the session watches. */
export interface CameraVisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

/** The frame loop the session runs while the camera streams. */
export interface CameraFrameLoop {
  start(): void;
  stop(): void;
}

export interface CameraSessionStartOptions {
  /** A specific camera; defaults to the rear-facing one. */
  deviceId?: string;
  /**
   * Frames per second to ask for at full HD, as an ideal, never exact (default 30, which is also
   * the cap). Prism's multi-code receiver asks for 60 (#1142).
   */
  frameRate?: number;
}

/** The parts of `navigator.mediaDevices` the session uses. */
export interface CameraMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices?(): Promise<MediaDeviceInfo[]>;
}

export interface CameraSessionConfig {
  /** Returns the element to show the camera in, read when the stream arrives. */
  getVideo: () => CameraVideoElement | null | undefined;
  /** The frame loop to run while streaming. */
  loop: CameraFrameLoop;
  /** Defaults to `navigator.mediaDevices`; null when the browser has no camera API. */
  mediaDevices?: CameraMediaDevices | null;
  /** Defaults to `document`; null disables releasing the camera in background tabs. */
  visibility?: CameraVisibilitySource | null;
}

export interface CameraSession {
  /** Acquires the camera (if not already) and starts scanning. Resolves once settled. */
  start(options?: CameraSessionStartOptions): Promise<void>;
  /** Releases the camera and stops scanning. An error state is kept so the UI can explain it. */
  stop(): void;
  getState(): CameraSessionState;
  /** The cameras the user can switch to (names appear once permission is granted). */
  listCameras(): Promise<CameraDevice[]>;
  /** Turns the torch on or off; resolves whether the camera did it. */
  setTorch(on: boolean): Promise<boolean>;
  /** Zooms to `value` (clamped to the camera's range); resolves whether the camera did it. */
  setZoom(value: number): Promise<boolean>;
  /** Calls `listener` on every state change; returns a function that removes it. */
  subscribe(listener: (state: CameraSessionState) => void): () => void;
  /** Stops the session for good and drops its listeners. */
  destroy(): void;
}

const IDLE: CameraSessionState = { status: 'idle' };

function toError(caught: unknown): Error {
  if (caught instanceof Error) return caught;
  if (typeof caught === 'object' && caught !== null && 'name' in caught && 'message' in caught) {
    const error = new Error(String(caught.message));
    error.name = String(caught.name);
    return error;
  }
  return new Error(String(caught));
}

/** Maps a `getUserMedia` rejection to the state the UI explains. */
function failureState(caught: unknown): CameraSessionState {
  const error = toError(caught);
  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return { status: 'denied', error };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return { status: 'unavailable', error };
    case 'NotReadableError':
    case 'TrackStartError':
      return { status: 'busy', error };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return { status: 'unsupported', error };
    default:
      return { status: 'error', error };
  }
}

/**
 * Capture sizes, best first (#1100). Chrome otherwise streams at its 640x480 default, which caps
 * how small or dense a code can be read. A camera that cannot meet a step makes `getUserMedia`
 * throw `OverconstrainedError` and the next step is tried; the last asks for no size at all.
 */
const CAPTURE_SIZES: readonly MediaTrackConstraints[] = [
  { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
  { width: { ideal: 1280 }, height: { ideal: 720 } },
  {},
];

/** The constraints for one step of {@link CAPTURE_SIZES}. */
export function cameraConstraints(options: CameraSessionStartOptions, sizeStep: number): MediaStreamConstraints {
  const camera: MediaTrackConstraints = options.deviceId
    ? { deviceId: { exact: options.deviceId } }
    : { facingMode: { ideal: 'environment' } };
  const size = CAPTURE_SIZES[Math.min(sizeStep, CAPTURE_SIZES.length - 1)];
  const fast = sizeStep === 0 && options.frameRate !== undefined && options.frameRate > 30;
  return { video: { ...camera, ...size, ...(fast ? { frameRate: { ideal: options.frameRate } } : {}) }, audio: false };
}

/** Image Capture capabilities (focus, torch, zoom), not yet in TypeScript's DOM lib. */
interface CaptureCapabilities {
  focusMode?: string[];
  torch?: boolean;
  zoom?: { min?: number; max?: number; step?: number };
}
interface CaptureSettings {
  deviceId?: string;
  facingMode?: string;
  width?: number;
  height?: number;
  frameRate?: number;
  zoom?: number;
  torch?: boolean;
}
/** The parts of a `MediaStreamTrack` the controls use. */
interface ControllableTrack {
  getCapabilities?(): CaptureCapabilities;
  getSettings?(): CaptureSettings;
  applyConstraints?(constraints: { advanced: Array<Record<string, unknown>> }): Promise<void>;
}

function videoTrackOf(stream: MediaStream): (MediaStreamTrack & ControllableTrack) | null {
  const tracks = typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : stream.getTracks();
  return tracks[0] ?? null;
}

function capabilitiesOf(track: ControllableTrack | null): CaptureCapabilities {
  try {
    return track?.getCapabilities?.() ?? {};
  } catch {
    return {};
  }
}

/** Reads what a streaming track is and can do. */
function describeTrack(track: ControllableTrack | null, torchOn: boolean): CameraInfo {
  const capabilities = capabilitiesOf(track);
  let settings: CaptureSettings = {};
  try {
    settings = track?.getSettings?.() ?? {};
  } catch {
    // Settings are optional.
  }
  const { zoom } = capabilities;
  const zoomRange =
    zoom && typeof zoom.min === 'number' && typeof zoom.max === 'number' && zoom.max > zoom.min
      ? {
          min: zoom.min,
          max: zoom.max,
          step: zoom.step && zoom.step > 0 ? zoom.step : (zoom.max - zoom.min) / 100,
          value: typeof settings.zoom === 'number' ? settings.zoom : zoom.min,
        }
      : null;
  return {
    deviceId: settings.deviceId || null,
    facing: settings.facingMode === 'user' || settings.facingMode === 'environment' ? settings.facingMode : null,
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    frameRate: settings.frameRate ?? 0,
    torch: { supported: capabilities.torch === true, on: capabilities.torch === true && torchOn },
    zoom: zoomRange,
  };
}

/** Applies one advanced constraint; resolves whether the camera accepted it. */
async function applyAdvanced(track: ControllableTrack | null, constraint: Record<string, unknown>): Promise<boolean> {
  if (!track?.applyConstraints) return false;
  try {
    await track.applyConstraints({ advanced: [constraint] });
    return true;
  } catch {
    return false;
  }
}

function defaultMediaDevices(): CameraMediaDevices | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  return navigator.mediaDevices;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // The track may already be gone.
    }
  }
}

/**
 * Creates an idle camera session. Nothing touches the camera until `start()`.
 * @param config The video element, frame loop and (for tests) camera and visibility sources.
 */
export function createCameraSession(config: CameraSessionConfig): CameraSession {
  const listeners = new Set<(state: CameraSessionState) => void>();
  const visibility =
    config.visibility === undefined ? (typeof document === 'undefined' ? null : document) : config.visibility;

  let state: CameraSessionState = IDLE;
  /** Bumped by every acquire and release; a request whose generation changed has been superseded. */
  let generation = 0;
  let stream: MediaStream | null = null;
  let attachedTo: CameraVideoElement | null = null;
  let pending: Promise<void> | null = null;
  /** The user wants the camera (start called and not stopped since). */
  let wanted = false;
  let lastOptions: CameraSessionStartOptions = {};
  let destroyed = false;
  let track: (MediaStreamTrack & ControllableTrack) | null = null;
  let torchOn = false;

  const setState = (next: CameraSessionState) => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener(next);
  };

  function release(): void {
    generation += 1;
    pending = null;
    config.loop.stop();
    if (torchOn) void applyAdvanced(track, { torch: false });
    torchOn = false;
    track = null;
    const current = stream;
    stream = null;
    if (current) stopTracks(current);
    const video = attachedTo;
    attachedTo = null;
    if (video && (!current || video.srcObject === current)) {
      try {
        video.pause();
        video.srcObject = null;
      } catch {
        // A detached element needs no cleanup.
      }
    }
  }

  async function acquire(options: CameraSessionStartOptions): Promise<void> {
    const ticket = ++generation;
    const mediaDevices = config.mediaDevices === undefined ? defaultMediaDevices() : config.mediaDevices;
    if (!mediaDevices) {
      setState({ status: 'unavailable', error: new Error('Camera API not available on this device or browser.') });
      return;
    }
    setState({ status: 'requesting' });
    let acquired: MediaStream | null = null;
    for (let step = 0; !acquired; step++) {
      try {
        acquired = await mediaDevices.getUserMedia(cameraConstraints(options, step));
      } catch (caught) {
        const overconstrained = toError(caught).name === 'OverconstrainedError';
        if (overconstrained && step < CAPTURE_SIZES.length - 1 && ticket === generation) continue;
        if (ticket === generation) setState(failureState(caught));
        return;
      }
    }
    if (ticket !== generation || destroyed) {
      // Superseded by stop() or a newer start() while the browser was asking: release at once.
      stopTracks(acquired);
      return;
    }
    const video = config.getVideo();
    if (!video) {
      stopTracks(acquired);
      setState({ status: 'error', error: new Error('No video element to show the camera in.') });
      return;
    }
    stream = acquired;
    attachedTo = video;
    track = videoTrackOf(acquired);
    // Phones that stay focused at infinity cannot read a code held close.
    if (capabilitiesOf(track).focusMode?.includes('continuous')) {
      void applyAdvanced(track, { focusMode: 'continuous' });
    }
    video.srcObject = acquired;
    try {
      const playing = video.play();
      if (playing && typeof playing.catch === 'function') playing.catch(() => {});
    } catch {
      // Autoplay is muted and inline; an interrupted play() is retried by the browser.
    }
    setState({ status: 'streaming', camera: describeTrack(track, torchOn) });
    // The engine skips frames until the element has data (readyState >= HAVE_CURRENT_DATA).
    config.loop.start();
  }

  /** Re-reads the camera after a control changed it. */
  function refreshCamera(): void {
    if (state.status === 'streaming') setState({ status: 'streaming', camera: describeTrack(track, torchOn) });
  }

  const onVisibilityChange = () => {
    if (!visibility || destroyed || !wanted) return;
    if (visibility.hidden) {
      if (state.status === 'streaming' || state.status === 'requesting') {
        release();
        setState(IDLE);
      }
    } else if (state.status === 'idle') {
      pending = acquire(lastOptions);
    }
  };
  visibility?.addEventListener('visibilitychange', onVisibilityChange);

  return {
    start(options = {}) {
      if (destroyed) return Promise.resolve();
      wanted = true;
      const sameCamera = options.deviceId === lastOptions.deviceId && options.frameRate === lastOptions.frameRate;
      lastOptions = options;
      if (sameCamera && pending && (state.status === 'requesting' || state.status === 'streaming')) return pending;
      if (state.status === 'streaming' || state.status === 'requesting') release();
      if (visibility?.hidden) {
        // Acquired when the page is shown.
        setState(IDLE);
        return Promise.resolve();
      }
      pending = acquire(options);
      return pending;
    },
    stop() {
      wanted = false;
      release();
      if (state.status === 'requesting' || state.status === 'streaming') setState(IDLE);
    },
    getState: () => state,
    async listCameras() {
      const mediaDevices = config.mediaDevices === undefined ? defaultMediaDevices() : config.mediaDevices;
      if (!mediaDevices?.enumerateDevices) return [];
      try {
        const devices = await mediaDevices.enumerateDevices();
        return devices
          .filter((device) => device.kind === 'videoinput' && device.deviceId)
          .map((device) => ({ deviceId: device.deviceId, label: device.label }));
      } catch {
        return [];
      }
    },
    async setTorch(on) {
      if (state.status !== 'streaming' || !state.camera.torch.supported) return false;
      const target = track;
      const applied = await applyAdvanced(target, { torch: on });
      if (applied && target === track) {
        torchOn = on;
        refreshCamera();
      }
      return applied;
    },
    async setZoom(value) {
      if (state.status !== 'streaming' || !state.camera.zoom) return false;
      const { min, max } = state.camera.zoom;
      const target = track;
      const applied = await applyAdvanced(target, { zoom: Math.min(max, Math.max(min, value)) });
      if (applied && target === track) refreshCamera();
      return applied;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      wanted = false;
      release();
      destroyed = true;
      visibility?.removeEventListener('visibilitychange', onVisibilityChange);
      listeners.clear();
    },
  };
}
