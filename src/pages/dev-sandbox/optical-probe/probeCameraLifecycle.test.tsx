// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProbeApp from './ProbeApp';

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** The modem load, when a test holds it back. */
const control = vi.hoisted(() => {
  const state: { modem: Promise<void> | null } = { modem: null };
  return state;
});

vi.mock('@/packages/optical-modem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/optical-modem')>();
  return { ...actual, loadOpticalModem: () => control.modem ?? Promise.resolve() };
});

interface FakeStream {
  stream: MediaStream;
  stop: ReturnType<typeof vi.fn>;
  /** Whether every track was stopped. */
  released: () => boolean;
}

function fakeStream(): FakeStream {
  const stop = vi.fn();
  const track = { kind: 'video', stop, getSettings: () => ({ width: 1920, height: 1080, frameRate: 30 }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  return { stream: stream as unknown as MediaStream, stop, released: () => stop.mock.calls.length > 0 };
}

let requests: ReturnType<typeof deferred<MediaStream>>[];
let play: () => Promise<void>;

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Lets pending promise callbacks run. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const startButton = () => screen.getByRole('button', { name: /start the camera/i });
const stopButton = () => screen.getByRole('button', { name: /stop and make the report/i });

describe('optical probe camera lifecycle (#1712)', () => {
  beforeEach(() => {
    requests = [];
    control.modem = null;
    play = () => Promise.resolve();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => {
          const request = deferred<MediaStream>();
          requests.push(request);
          return request.promise;
        }),
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => play());
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    // No frame is ever delivered: the analysis is not under test here.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    vi.restoreAllMocks();
  });

  /** Starts the camera and grants it. */
  async function startStreaming(user: ReturnType<typeof userEvent.setup>) {
    await user.click(startButton());
    await flush();
    const camera = fakeStream();
    await act(async () => requests.at(-1)?.resolve(camera.stream));
    await flush();
    return camera;
  }

  it('asks for the camera once when Start is pressed twice while it opens', async () => {
    const user = userEvent.setup();
    render(<ProbeApp />);
    await user.click(startButton());
    await user.click(startButton());
    await flush();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('gives back a camera granted after Stop, and does not start running', async () => {
    const user = userEvent.setup();
    render(<ProbeApp />);
    await user.click(startButton());
    await flush();
    await user.click(stopButton());
    const camera = fakeStream();
    await act(async () => requests[0].resolve(camera.stream));
    await flush();
    expect(camera.released()).toBe(true);
    expect(startButton()).toBeEnabled();
    expect(stopButton()).toBeDisabled();
  });

  it('gives back a camera granted after unmount', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ProbeApp />);
    await user.click(startButton());
    await flush();
    unmount();
    const camera = fakeStream();
    await act(async () => requests[0].resolve(camera.stream));
    await flush();
    expect(camera.released()).toBe(true);
  });

  it('never asks for the camera when unmounted while the modem loads', async () => {
    const modem = deferred<void>();
    control.modem = modem.promise;
    const user = userEvent.setup();
    const { unmount } = render(<ProbeApp />);
    await user.click(startButton());
    unmount();
    await act(async () => modem.resolve());
    await flush();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('releases the camera when unmounted while it runs', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ProbeApp />);
    const camera = await startStreaming(user);
    expect(stopButton()).toBeEnabled();
    expect(camera.released()).toBe(false);
    unmount();
    expect(camera.released()).toBe(true);
  });

  it('releases the camera and says why when the preview cannot play', async () => {
    play = () => Promise.reject(new Error('autoplay was blocked'));
    const user = userEvent.setup();
    render(<ProbeApp />);
    const camera = await startStreaming(user);
    expect(camera.released()).toBe(true);
    expect(screen.getByText('autoplay was blocked')).toBeInTheDocument();
    expect(startButton()).toBeEnabled();
  });

  it('releases the camera when unmounted while the preview starts to play', async () => {
    const playing = deferred<void>();
    play = () => playing.promise;
    const user = userEvent.setup();
    const { unmount } = render(<ProbeApp />);
    const camera = await startStreaming(user);
    unmount();
    expect(camera.released()).toBe(true);
    await act(async () => playing.resolve());
    await flush();
    expect(camera.stop).toHaveBeenCalled();
  });

  it('gives the camera back in a hidden tab and asks again on return, but not after Stop', async () => {
    const user = userEvent.setup();
    render(<ProbeApp />);
    const first = await startStreaming(user);

    setHidden(true);
    expect(first.released()).toBe(true);
    setHidden(false);
    await flush();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    const second = fakeStream();
    await act(async () => requests[1].resolve(second.stream));
    await flush();
    expect(second.released()).toBe(false);

    await user.click(stopButton());
    expect(second.released()).toBe(true);
    // The report is made from the run that spanned the hidden tab.
    expect(screen.getByLabelText(/report \(copy it/i)).toBeInTheDocument();
    setHidden(true);
    setHidden(false);
    await flush();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('waits for a hidden tab to be shown before asking for the camera', async () => {
    const user = userEvent.setup();
    render(<ProbeApp />);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    await user.click(startButton());
    await flush();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    setHidden(false);
    await flush();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer camera when an older request settles late', async () => {
    const user = userEvent.setup();
    render(<ProbeApp />);
    await user.click(startButton());
    await flush();
    // The tab is hidden and shown again while the first request is still open.
    setHidden(true);
    setHidden(false);
    await flush();
    expect(requests).toHaveLength(2);
    const newer = fakeStream();
    await act(async () => requests[1].resolve(newer.stream));
    await flush();
    const older = fakeStream();
    await act(async () => requests[0].resolve(older.stream));
    await flush();
    expect(older.released()).toBe(true);
    expect(newer.released()).toBe(false);
    expect(stopButton()).toBeEnabled();
  });
});
