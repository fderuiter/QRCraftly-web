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

/**
 * The opt-in and fallback logic of the webcam back channel (#1146), as a small state machine with
 * no browser API in it. The camera is requested by an injected function, and only after the caller
 * has called `enable()`; the app never calls `getUserMedia` from here.
 *
 * States: "off" (the default), "requesting" (waiting on the permission), "listening" (the camera
 * is on and the receiver's feedback steers the sender) and "one-way" (the camera was denied, is
 * missing or went away: the sender goes on with the normal one-way stream, with the profile the
 * person chose and no auto-stop). Nothing is stored, so every send starts "off".
 */
import type { MultiRateProfileName } from '../multicode/multirate';

/** What asking for the camera came back with. */
export type CameraPermission = 'granted' | 'denied' | 'unavailable';

export type FeedbackLinkState =
  | { status: 'off' }
  | { status: 'requesting' }
  | { status: 'listening' }
  | { status: 'one-way'; reason: 'denied' | 'unavailable' | 'camera-lost' | 'error' };

export interface FeedbackLinkOptions {
  /** Asks for the camera. Called only from `enable()`. A rejection counts as an error. */
  requestCamera: () => Promise<CameraPermission>;
  /** Called when the camera is no longer needed (turned off, or lost): stop its tracks here. */
  releaseCamera?: () => void;
}

export interface FeedbackLink {
  readonly state: FeedbackLinkState;
  /**
   * The user turned "Let the receiver steer" on. The only call that asks for the camera.
   * @returns The state once the permission answered.
   */
  enable(): Promise<FeedbackLinkState>;
  /** The user turned it off. */
  disable(): void;
  /** The camera stopped (unplugged, the tab lost it, the permission was revoked). */
  cameraLost(): void;
  /**
   * The profile to show.
   * @param chosen - The one the person chose (or the default).
   * @param steered - The one the speed controller asks for.
   * @returns The steered profile while listening, otherwise the chosen one.
   */
  profileFor(chosen: MultiRateProfileName, steered: MultiRateProfileName): MultiRateProfileName;
  /**
   * Whether the sender should stop.
   * @param allDone - The controller's stop decision.
   * @returns True only while listening: a one-way stream never stops by itself.
   */
  shouldStop(allDone: boolean): boolean;
}

/**
 * Creates the link. Nothing is requested until `enable()`.
 * @param options - The injected camera request and release.
 * @returns The link.
 */
export function createFeedbackLink(options: FeedbackLinkOptions): FeedbackLink {
  let state: FeedbackLinkState = { status: 'off' };
  let pending: Promise<FeedbackLinkState> | null = null;
  /** Bumped by every enable and disable, so an answer that arrives after "off" is dropped. */
  let epoch = 0;

  const release = () => options.releaseCamera?.();

  return {
    get state() {
      return state;
    },
    enable() {
      if (state.status === 'requesting' && pending) return pending;
      if (state.status === 'listening') return Promise.resolve(state);
      const mine = ++epoch;
      state = { status: 'requesting' };
      pending = options.requestCamera().then(
        (permission): FeedbackLinkState => {
          if (mine !== epoch) {
            // Turned off while the prompt was open: do not keep a camera nobody wants.
            if (permission === 'granted') release();
            return state;
          }
          state = permission === 'granted' ? { status: 'listening' } : { status: 'one-way', reason: permission };
          return state;
        },
        (): FeedbackLinkState => {
          if (mine === epoch) state = { status: 'one-way', reason: 'error' };
          return state;
        }
      );
      return pending;
    },
    disable() {
      epoch += 1;
      if (state.status === 'listening') release();
      state = { status: 'off' };
    },
    cameraLost() {
      if (state.status !== 'listening') return;
      release();
      state = { status: 'one-way', reason: 'camera-lost' };
    },
    profileFor: (chosen, steered) => (state.status === 'listening' ? steered : chosen),
    shouldStop: (allDone) => state.status === 'listening' && allDone,
  };
}
