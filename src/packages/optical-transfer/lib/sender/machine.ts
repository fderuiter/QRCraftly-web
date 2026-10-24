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
 * The sender's phase as one value (#1510), so the flags the hook returns and the views the send
 * page shows are read from it and cannot disagree. Pure: no React, no timers, no worker.
 */

/** Where a transfer stands. */
export type SenderPhase =
  /** No file chosen. */
  | 'idle'
  /** A file is chosen and nothing plays. */
  | 'ready'
  /** Reduced motion is on: the person is asked once more before the stream flashes. */
  | 'confirmingMotion'
  /** Start was pressed: the first frame is being checked before anything plays. */
  | 'verifying'
  /** The stream plays. */
  | 'transmitting'
  /** The stream holds its last frame (#1148). */
  | 'paused'
  /** Every receiver in view had the file, so the speed controller stopped the stream (#1146). */
  | 'autoStopped'
  /** The first frame failed its check, or the worker reported an error. */
  | 'failed';

/** What happens to the sender. */
export type SenderEvent =
  | { type: 'select' }
  | { type: 'clear' }
  | { type: 'start'; reducedMotion: boolean }
  | { type: 'confirmMotion' }
  | { type: 'cancelMotion' }
  | { type: 'handshakeOk' }
  | { type: 'handshakeFailed' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'autoStop' }
  | { type: 'error' };

export interface SenderState {
  phase: SenderPhase;
  /** Whether a file is chosen, so a stopped stream goes back to 'ready' rather than 'idle'. */
  hasFiles: boolean;
}

export const INITIAL_SENDER_STATE: SenderState = Object.freeze({ phase: 'idle', hasFiles: false });

const RESTARTABLE: ReadonlySet<SenderPhase> = new Set(['ready', 'autoStopped', 'failed']);
const RUNNING: ReadonlySet<SenderPhase> = new Set(['verifying', 'transmitting', 'paused']);

const withPhase = (state: SenderState, phase: SenderPhase): SenderState => (state.phase === phase ? state : { ...state, phase });

/**
 * The next sender state. An event that does not apply to the current phase returns the same state object.
 * @param state - The current state.
 * @param event - What happened.
 */
export function senderReducer(state: SenderState, event: SenderEvent): SenderState {
  const { phase } = state;
  switch (event.type) {
    case 'select':
    case 'clear': {
      const hasFiles = event.type === 'select';
      if (hasFiles === state.hasFiles) return state;
      // Choosing or clearing a file moves idle and ready between each other; any other phase keeps going.
      const next = phase === 'idle' || phase === 'ready' ? (hasFiles ? 'ready' : 'idle') : phase;
      return { phase: next, hasFiles };
    }
    case 'start':
      if (!RESTARTABLE.has(phase) || !state.hasFiles) return state;
      return withPhase(state, event.reducedMotion ? 'confirmingMotion' : 'verifying');
    case 'confirmMotion':
      return phase === 'confirmingMotion' ? withPhase(state, 'verifying') : state;
    case 'cancelMotion':
      return phase === 'confirmingMotion' ? withPhase(state, state.hasFiles ? 'ready' : 'idle') : state;
    case 'handshakeOk':
      return phase === 'verifying' ? withPhase(state, 'transmitting') : state;
    case 'handshakeFailed':
      return phase === 'verifying' ? withPhase(state, 'failed') : state;
    case 'pause':
      return phase === 'transmitting' ? withPhase(state, 'paused') : state;
    case 'resume':
      return phase === 'paused' ? withPhase(state, 'transmitting') : state;
    case 'stop':
      // A finished auto-stop keeps saying so until the next start; the motion confirm stays open.
      return RUNNING.has(phase) || phase === 'failed' ? withPhase(state, state.hasFiles ? 'ready' : 'idle') : state;
    case 'autoStop':
      return phase === 'transmitting' || phase === 'paused' ? withPhase(state, 'autoStopped') : state;
    case 'error':
      return RUNNING.has(phase) ? withPhase(state, 'failed') : state;
    default: {
      const unknown: never = event;
      return unknown;
    }
  }
}
