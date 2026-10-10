/**
 * Camera Session (#1097): one owner for the camera stream, safe under repeated start/stop.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  cameraConstraints,
  createCameraSession,
  type CameraSessionState,
  type CameraVideoElement,
  type CameraVisibilitySource,
} from '../index';

interface FakeTrack {
  live: boolean;
  /** Every advanced constraint the session applied, in order. */
  applied: Array<Record<string, unknown>>;
  /** The camera ends on its own (unplugged, revoked): the track fires `ended`. */
  end: () => void;
  /** The stream fires `inactive`. */
  deactivate: () => void;
}

/** What a granted fake camera reports through the Image Capture API. */
interface FakeTrackSpec {
  capabilities?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

/** A controllable `getUserMedia`: each request waits until granted or refused. */
function createFakeCamera() {
  const tracks: FakeTrack[] = [];
  const requests: Array<{
    constraints: MediaStreamConstraints;
    grant: (spec?: FakeTrackSpec) => void;
    refuse: (name: string) => void;
  }> = [];
  const getUserMedia = (constraints?: MediaStreamConstraints) =>
    new Promise<MediaStream>((resolve, reject) => {
      requests.push({
        constraints: constraints ?? {},
        grant: (spec = {}) => {
          const trackEvents = new EventTarget();
          const streamEvents = new EventTarget();
          const track: FakeTrack = {
            live: true,
            applied: [],
            end: () => {
              track.live = false;
              trackEvents.dispatchEvent(new Event('ended'));
            },
            deactivate: () => streamEvents.dispatchEvent(new Event('inactive')),
          };
          tracks.push(track);
          const settings: Record<string, unknown> = { ...spec.settings };
          const mediaTrack = {
            addEventListener: trackEvents.addEventListener.bind(trackEvents),
            removeEventListener: trackEvents.removeEventListener.bind(trackEvents),
            stop: () => {
              track.live = false;
            },
            getCapabilities: () => spec.capabilities ?? {},
            getSettings: () => settings,
            applyConstraints: async ({ advanced }: { advanced: Array<Record<string, unknown>> }) => {
              track.applied.push(...advanced);
              Object.assign(settings, ...advanced);
            },
          };
          const stream: Pick<MediaStream, 'getTracks' | 'addEventListener' | 'removeEventListener'> = {
            getTracks: () => [mediaTrack as unknown as MediaStreamTrack],
            addEventListener: streamEvents.addEventListener.bind(streamEvents),
            removeEventListener: streamEvents.removeEventListener.bind(streamEvents),
          };
          resolve(stream as MediaStream);
        },
        refuse: (name) => reject(new DOMException('Camera refused', name)),
      });
    });
  const enumerateDevices = async () =>
    [
      { kind: 'videoinput', deviceId: 'back', label: 'Back Camera' },
      { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
      { kind: 'videoinput', deviceId: 'front', label: 'Front Camera' },
    ] as MediaDeviceInfo[];
  return {
    mediaDevices: { getUserMedia, enumerateDevices },
    requests,
    tracks,
    live: () => tracks.filter((track) => track.live).length,
  };
}

function createFakeVideo() {
  const srcObject: MediaProvider | null = null;
  return { srcObject, play: vi.fn(async () => {}), pause: vi.fn(() => {}) } satisfies CameraVideoElement;
}

function createFakeVisibility() {
  const listeners = new Set<() => void>();
  const source: CameraVisibilitySource & { hidden: boolean; set(hidden: boolean): void; count(): number } = {
    hidden: false,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    set(hidden) {
      this.hidden = hidden;
      for (const listener of [...listeners]) listener();
    },
    count: () => listeners.size,
  };
  return source;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createCameraSession', () => {
  let camera: ReturnType<typeof createFakeCamera>;
  let video: ReturnType<typeof createFakeVideo>;
  let visibility: ReturnType<typeof createFakeVisibility>;
  let loop: { start: Mock<() => void>; stop: Mock<() => void> };
  let states: CameraSessionState['status'][];

  const create = (overrides: Partial<Parameters<typeof createCameraSession>[0]> = {}) => {
    const session = createCameraSession({
      getVideo: () => video,
      loop,
      mediaDevices: camera.mediaDevices,
      visibility,
      ...overrides,
    });
    session.subscribe((state) => states.push(state.status));
    return session;
  };

  beforeEach(() => {
    camera = createFakeCamera();
    video = createFakeVideo();
    visibility = createFakeVisibility();
    loop = { start: vi.fn<() => void>(), stop: vi.fn<() => void>() };
    states = [];
  });

  it('acquires the rear camera, attaches it, plays it and starts the frame loop', async () => {
    const session = create();
    const started = session.start();
    expect(session.getState()).toEqual({ status: 'requesting' });
    expect(camera.requests[0].constraints).toEqual({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });

    camera.requests[0].grant();
    await started;
    expect(session.getState().status).toBe('streaming');
    expect(video.srcObject).not.toBeNull();
    expect(video.play).toHaveBeenCalled();
    expect(loop.start).toHaveBeenCalledTimes(1);
    expect(camera.live()).toBe(1);
    expect(states).toEqual(['requesting', 'streaming']);
  });

  it('asks for a specific camera by device id', () => {
    create().start({ deviceId: 'front' });
    expect(camera.requests[0].constraints).toEqual(cameraConstraints({ deviceId: 'front' }, 0));
    expect(camera.requests[0].constraints.video).toMatchObject({ deviceId: { exact: 'front' }, width: { ideal: 1920 } });
  });

  it('asks for a higher frame rate as an ideal at full HD only, and re-acquires when it changes (#1142)', async () => {
    expect(cameraConstraints({ frameRate: 60 }, 0).video).toMatchObject({ width: { ideal: 1920 }, frameRate: { ideal: 60 } });
    expect(cameraConstraints({ frameRate: 60 }, 1).video).not.toHaveProperty('frameRate');
    expect(cameraConstraints({ frameRate: 24 }, 0).video).toMatchObject({ frameRate: { ideal: 30, max: 30 } });

    const session = create();
    const first = session.start();
    camera.requests[0].grant();
    await first;
    const faster = session.start({ frameRate: 60 });
    expect(camera.requests).toHaveLength(2);
    camera.requests[1].grant();
    await faster;
    expect(camera.live()).toBe(1);
    expect(session.getState().status).toBe('streaming');
  });

  it('is idempotent: start while requesting or streaming asks only once', async () => {
    const session = create();
    const first = session.start();
    const second = session.start();
    expect(second).toBe(first);
    camera.requests[0].grant();
    await first;
    await session.start();
    expect(camera.requests).toHaveLength(1);
    expect(loop.start).toHaveBeenCalledTimes(1);
  });

  it('releases a stream that arrives after stop (StrictMode start, stop, start)', async () => {
    const session = create();
    void session.start();
    session.stop();
    void session.start();
    expect(camera.requests).toHaveLength(2);

    // The browser answers the superseded request last.
    camera.requests[1].grant();
    camera.requests[0].grant();
    await flush();
    expect(camera.live()).toBe(1);
    expect(session.getState().status).toBe('streaming');
    expect(loop.start).toHaveBeenCalledTimes(1);
  });

  it('stops every track, detaches the element and stops the loop', async () => {
    const session = create();
    const started = session.start();
    camera.requests[0].grant();
    await started;

    session.stop();
    expect(camera.live()).toBe(0);
    expect(video.srcObject).toBeNull();
    expect(video.pause).toHaveBeenCalled();
    expect(loop.stop).toHaveBeenCalled();
    expect(session.getState()).toEqual({ status: 'idle' });
    session.stop();
    expect(session.getState()).toEqual({ status: 'idle' });
  });

  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'unavailable'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['AbortError', 'error'],
  ])('maps a %s refusal to %s and keeps it after stop', async (name, status) => {
    const session = create();
    const started = session.start();
    camera.requests[0].refuse(name);
    await started;
    const state = session.getState();
    expect(state.status).toBe(status);
    expect('error' in state && state.error.name).toBe(name);
    expect(loop.start).not.toHaveBeenCalled();

    session.stop();
    expect(session.getState().status).toBe(status);
  });

  it.each([
    ['the track ends', (track: FakeTrack) => track.end()],
    ['the stream goes inactive', (track: FakeTrack) => track.deactivate()],
  ])('reports a camera that stops on its own when %s, and can start again (#1297)', async (_case, stopCamera) => {
    const session = create();
    const started = session.start();
    camera.requests[0].grant();
    await started;

    stopCamera(camera.tracks[0]);
    const state = session.getState();
    expect(state.status).toBe('stopped');
    expect('error' in state && state.error.message).toMatch(/camera stopped/i);
    expect(loop.stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(camera.live()).toBe(0);

    const restarted = session.start();
    camera.requests[1].grant();
    await restarted;
    expect(session.getState().status).toBe('streaming');
  });

  it('ignores the end of a camera it has already released', async () => {
    const session = create();
    const started = session.start();
    camera.requests[0].grant();
    await started;
    session.stop();
    camera.tracks[0].end();
    camera.tracks[0].deactivate();
    expect(session.getState()).toEqual({ status: 'idle' });
  });

  it('retries after a refusal', async () => {
    const session = create();
    const refused = session.start();
    camera.requests[0].refuse('NotAllowedError');
    await refused;
    const retried = session.start();
    camera.requests[1].grant();
    await retried;
    expect(session.getState().status).toBe('streaming');
  });

  it('reports a browser without a camera API as unavailable', async () => {
    const session = create({ mediaDevices: null });
    await session.start();
    expect(session.getState().status).toBe('unavailable');
  });

  it('releases a stream when there is no element to show it in', async () => {
    const session = create({ getVideo: () => null });
    const started = session.start();
    camera.requests[0].grant();
    await started;
    expect(camera.live()).toBe(0);
    expect(session.getState().status).toBe('error');
  });

  it('releases the camera while the page is hidden and reacquires it when shown', async () => {
    const session = create();
    const started = session.start();
    camera.requests[0].grant();
    await started;

    visibility.set(true);
    expect(camera.live()).toBe(0);
    expect(loop.stop).toHaveBeenCalled();
    expect(session.getState()).toEqual({ status: 'idle' });

    visibility.set(false);
    expect(session.getState()).toEqual({ status: 'requesting' });
    camera.requests[1].grant();
    await flush();
    expect(camera.live()).toBe(1);
    expect(session.getState().status).toBe('streaming');
  });

  it('does not reopen a camera the user stopped when the page is shown', () => {
    const session = create();
    void session.start();
    session.stop();
    visibility.set(true);
    visibility.set(false);
    expect(camera.requests).toHaveLength(1);
  });

  it('waits for the page to be shown before asking for the camera', () => {
    visibility.hidden = true;
    const session = create();
    void session.start();
    expect(camera.requests).toHaveLength(0);
    visibility.set(false);
    expect(camera.requests).toHaveLength(1);
  });

  it('destroy releases the camera, drops listeners and ignores later calls', async () => {
    const session = create();
    const started = session.start();
    camera.requests[0].grant();
    await started;

    session.destroy();
    expect(camera.live()).toBe(0);
    expect(visibility.count()).toBe(0);
    await session.start();
    expect(camera.requests).toHaveLength(1);
  });

  describe('capture quality and controls (#1100)', () => {
    const stream = async (spec?: FakeTrackSpec) => {
      const session = create();
      const started = session.start();
      camera.requests[0].grant(spec);
      await started;
      return session;
    };
    const cameraInfo = (session: ReturnType<typeof create>) => {
      const state = session.getState();
      if (state.status !== 'streaming') throw new Error(`not streaming: ${state.status}`);
      return state.camera;
    };

    it('steps down from 1080p to 720p to any size when the camera is overconstrained', async () => {
      const session = create();
      const started = session.start();
      camera.requests[0].refuse('OverconstrainedError');
      await flush();
      expect(camera.requests[1].constraints.video).toMatchObject({ width: { ideal: 1280 }, height: { ideal: 720 } });
      camera.requests[1].refuse('OverconstrainedError');
      await flush();
      expect(camera.requests[2].constraints).toEqual({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      camera.requests[2].grant();
      await started;
      expect(session.getState().status).toBe('streaming');
    });

    it('reports a camera that matches no constraints as unsupported', async () => {
      const session = create();
      const started = session.start({ deviceId: 'unplugged' });
      for (let step = 0; step < 3; step++) {
        await flush();
        camera.requests[step].refuse('OverconstrainedError');
      }
      await started;
      expect(session.getState().status).toBe('unsupported');
      expect(camera.requests).toHaveLength(3);
    });

    it('turns on continuous focus only where the camera offers it', async () => {
      await stream({ capabilities: { focusMode: ['manual', 'continuous'] } });
      expect(camera.tracks[0].applied).toEqual([{ focusMode: 'continuous' }]);

      camera = createFakeCamera();
      await stream({ capabilities: { focusMode: ['manual'] } });
      expect(camera.tracks[0].applied).toEqual([]);
    });

    it('offers no torch or zoom when the camera has neither', async () => {
      const session = await stream({ settings: { facingMode: 'user', width: 1280, height: 720 } });
      expect(cameraInfo(session)).toEqual({
        deviceId: null,
        facing: 'user',
        width: 1280,
        height: 720,
        frameRate: 0,
        torch: { supported: false, on: false },
        zoom: null,
      });
      expect(await session.setTorch(true)).toBe(false);
      expect(await session.setZoom(2)).toBe(false);
      expect(camera.tracks[0].applied).toEqual([]);
    });

    it('switches the torch on and turns it off when the camera stops', async () => {
      const session = await stream({ capabilities: { torch: true } });
      expect(cameraInfo(session).torch).toEqual({ supported: true, on: false });

      expect(await session.setTorch(true)).toBe(true);
      expect(cameraInfo(session).torch.on).toBe(true);

      session.stop();
      expect(camera.tracks[0].applied).toEqual([{ torch: true }, { torch: false }]);
      expect(camera.live()).toBe(0);
    });

    it('zooms within the camera range', async () => {
      const session = await stream({ capabilities: { zoom: { min: 1, max: 5, step: 0.1 } }, settings: { zoom: 1 } });
      expect(cameraInfo(session).zoom).toEqual({ min: 1, max: 5, step: 0.1, value: 1 });

      expect(await session.setZoom(9)).toBe(true);
      expect(camera.tracks[0].applied).toEqual([{ zoom: 5 }]);
      expect(cameraInfo(session).zoom?.value).toBe(5);
    });

    it('lists only video inputs', async () => {
      const session = create();
      expect(await session.listCameras()).toEqual([
        { deviceId: 'back', label: 'Back Camera' },
        { deviceId: 'front', label: 'Front Camera' },
      ]);
    });

    it('leaves no track running after switching cameras', async () => {
      const session = await stream();
      const switched = session.start({ deviceId: 'front' });
      expect(camera.live()).toBe(0);
      camera.requests[1].grant();
      await switched;
      expect(camera.live()).toBe(1);
      expect(camera.tracks).toHaveLength(2);
      expect(camera.tracks[0].live).toBe(false);
    });
  });
});
