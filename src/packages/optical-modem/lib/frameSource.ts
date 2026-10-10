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

/** What the camera granted, as `getSettings()` reports it. Zero means the browser did not say. */
export interface StreamGrant {
  width: number;
  height: number;
  frameRate: number;
}

/**
 * Reads the granted resolution and frame rate from a camera track.
 * @param track - A video track.
 * @returns The grant; a field the browser leaves out is zero.
 */
export function grantedSettings(track: Pick<MediaStreamTrack, 'getSettings'>): StreamGrant {
  const settings = track.getSettings();
  return { width: settings.width ?? 0, height: settings.height ?? 0, frameRate: settings.frameRate ?? 0 };
}

/** One camera frame as the callback reports it. */
export interface FrameTick {
  /** Time the frame was presented, in milliseconds (the callback's `now`). */
  now: number;
  /** Frames the browser has presented so far, where it says; a jump of more than one is a dropped frame. */
  presentedFrames: number | null;
}

/** A running frame watcher. */
export interface FrameWatcher {
  stop(): void;
}

type VideoFrameCallbackSource = Pick<HTMLVideoElement, 'requestVideoFrameCallback' | 'cancelVideoFrameCallback'>;

/**
 * Calls back once per camera frame. It uses `requestVideoFrameCallback`, which fires when a new
 * frame is presented rather than on every screen refresh, and falls back to `requestAnimationFrame`
 * (which cannot tell a new frame from a repeat) where the video element has none.
 * @param video - The video element showing the camera stream.
 * @param onFrame - Called for each frame; the next frame is not scheduled until it returns.
 * @returns A handle that stops the watching.
 */
export function watchFrames(video: Partial<VideoFrameCallbackSource>, onFrame: (tick: FrameTick) => void): FrameWatcher {
  let stopped = false;
  let handle = 0;
  const schedule = (): void => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      handle = video.requestVideoFrameCallback.call(video, (now, metadata) => {
        if (stopped) return;
        onFrame({ now, presentedFrames: metadata.presentedFrames });
        schedule();
      });
    } else {
      handle = requestAnimationFrame((now) => {
        if (stopped) return;
        onFrame({ now, presentedFrames: null });
        schedule();
      });
    }
  };
  schedule();
  return {
    stop() {
      stopped = true;
      if (typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback.call(video, handle);
      else cancelAnimationFrame(handle);
    },
  };
}

/** Counts delivered and dropped camera frames over a sliding window. */
export class FrameRateMeter {
  private readonly times: number[] = [];
  private lastPresented: number | null = null;
  private dropped = 0;

  /**
   * @param windowMs - How far back the rate looks, in milliseconds.
   */
  private readonly windowMs: number;

  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
  }

  /**
   * Records a frame.
   * @param tick - The frame's tick.
   */
  record(tick: FrameTick): void {
    this.times.push(tick.now);
    while (this.times.length > 1 && tick.now - this.times[0] > this.windowMs) this.times.shift();
    if (tick.presentedFrames !== null && this.lastPresented !== null && tick.presentedFrames > this.lastPresented + 1) this.dropped += tick.presentedFrames - this.lastPresented - 1;
    if (tick.presentedFrames !== null) this.lastPresented = tick.presentedFrames;
  }

  /** Frames per second over the window, or 0 before two frames have arrived. */
  get fps(): number {
    if (this.times.length < 2) return 0;
    return ((this.times.length - 1) * 1000) / (this.times[this.times.length - 1] - this.times[0]);
  }

  /** Frames the browser presented that the page was too slow to take, over the meter's life. */
  get droppedFrames(): number {
    return this.dropped;
  }
}
