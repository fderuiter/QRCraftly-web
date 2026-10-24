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

import { describe, expect, it } from 'vitest';
import { INITIAL_SENDER_STATE, senderReducer, type SenderEvent, type SenderPhase, type SenderState } from '../index';

const EVENTS: Record<string, SenderEvent> = {
  select: { type: 'select' },
  clear: { type: 'clear' },
  start: { type: 'start', reducedMotion: false },
  startReduced: { type: 'start', reducedMotion: true },
  confirmMotion: { type: 'confirmMotion' },
  cancelMotion: { type: 'cancelMotion' },
  handshakeOk: { type: 'handshakeOk' },
  handshakeFailed: { type: 'handshakeFailed' },
  pause: { type: 'pause' },
  resume: { type: 'resume' },
  stop: { type: 'stop' },
  autoStop: { type: 'autoStop' },
  error: { type: 'error' },
};

/** The next phase for every phase and event; a missing entry means the same state object comes back. */
const NEXT: Record<SenderPhase, Partial<Record<keyof typeof EVENTS, SenderPhase>>> = {
  idle: { select: 'ready' },
  ready: { clear: 'idle', start: 'verifying', startReduced: 'confirmingMotion' },
  confirmingMotion: { clear: 'confirmingMotion', confirmMotion: 'verifying', cancelMotion: 'ready' },
  verifying: { clear: 'verifying', handshakeOk: 'transmitting', handshakeFailed: 'failed', stop: 'ready', error: 'failed' },
  transmitting: { clear: 'transmitting', pause: 'paused', stop: 'ready', autoStop: 'autoStopped', error: 'failed' },
  paused: { clear: 'paused', resume: 'transmitting', stop: 'ready', autoStop: 'autoStopped', error: 'failed' },
  autoStopped: { clear: 'autoStopped', start: 'verifying', startReduced: 'confirmingMotion' },
  failed: { clear: 'failed', start: 'verifying', startReduced: 'confirmingMotion', stop: 'ready' },
};

const stateIn = (phase: SenderPhase): SenderState => ({ phase, hasFiles: phase !== 'idle' });

const PHASES: SenderPhase[] = ['idle', 'ready', 'confirmingMotion', 'verifying', 'transmitting', 'paused', 'autoStopped', 'failed'];
const CASES = PHASES.flatMap((phase) => Object.keys(EVENTS).map((event) => [phase, event, NEXT[phase][event] ?? null] as const));

describe('senderReducer', () => {
  it('starts idle with no file', () => {
    expect(INITIAL_SENDER_STATE).toEqual({ phase: 'idle', hasFiles: false });
  });

  it.each(CASES)('in %s, %s goes to %s', (phase, event, expected) => {
    const state = stateIn(phase);
    const result = senderReducer(state, EVENTS[event]);
    if (expected === null) {
      // An event that does not apply returns the very same state.
      expect(result).toBe(state);
      return;
    }
    expect(result.phase).toBe(expected);
    expect(result.hasFiles).toBe(event === 'clear' ? false : state.hasFiles || event === 'select');
  });

  it('returns a stopped stream to idle when its file was cleared meanwhile', () => {
    const cleared = senderReducer(stateIn('transmitting'), EVENTS.clear);
    expect(senderReducer(cleared, EVENTS.stop)).toEqual({ phase: 'idle', hasFiles: false });
  });

  it('does not start without a file', () => {
    const state = { phase: 'failed' as const, hasFiles: false };
    expect(senderReducer(state, EVENTS.start)).toBe(state);
  });

  it('runs a whole transfer, with a pause', () => {
    let state = INITIAL_SENDER_STATE;
    const phases: SenderPhase[] = [];
    for (const event of ['select', 'start', 'handshakeOk', 'pause', 'resume', 'stop'] as const) {
      state = senderReducer(state, EVENTS[event]);
      phases.push(state.phase);
    }
    expect(phases).toEqual(['ready', 'verifying', 'transmitting', 'paused', 'transmitting', 'ready']);
  });
});
