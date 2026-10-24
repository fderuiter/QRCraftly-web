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
import { initialReceiverState, receiverReducer, type ReceiverEvent, type ReceiverMode, type ReceiverPhase, type ReceiverState } from '../index';

const FILE_RESULT = { kind: 'file', handshake: null, data: new Uint8Array([1]) } as const;
const FAILURE = { source: 'receiver', message: 'Broken' } as const;

const EVENTS = {
  toCamera: { type: 'chooseMode', mode: 'camera' },
  toFile: { type: 'chooseMode', mode: 'file' },
  startCamera: { type: 'startCamera' },
  loadVideo: { type: 'loadVideo' },
  stop: { type: 'stop' },
  manifest: { type: 'manifest', needsKey: false },
  privateManifest: { type: 'manifest', needsKey: true },
  keyAccepted: { type: 'keyStatus', accepted: true },
  keyRejected: { type: 'keyStatus', accepted: false },
  progress: { type: 'progress' },
  verify: { type: 'verify' },
  complete: { type: 'complete', result: FILE_RESULT },
  fail: { type: 'fail', error: FAILURE },
  clear: { type: 'clear' },
} satisfies Record<string, ReceiverEvent>;
type EventName = keyof typeof EVENTS;

const PHASES: ReceiverPhase[] = ['idle', 'awaitingVideo', 'scanning', 'needsKey', 'receiving', 'verifying', 'complete', 'failed'];
const EVENT_NAMES = Object.keys(EVENTS).filter((name): name is EventName => name in EVENTS);

/** A state in `phase`, in the mode that phase is reached in. */
function stateIn(phase: ReceiverPhase): ReceiverState {
  const mode: ReceiverMode = phase === 'awaitingVideo' ? 'file' : 'camera';
  if (phase === 'complete') return { mode, phase, result: FILE_RESULT };
  if (phase === 'failed') return { mode, phase, error: FAILURE };
  return { mode, phase };
}

/** The phase after each event in camera mode (awaitingVideo is file mode); a missing entry means the same state comes back. */
const NEXT: Record<ReceiverPhase, Partial<Record<EventName, ReceiverPhase>>> = {
  idle: { toFile: 'awaitingVideo', startCamera: 'scanning', manifest: 'receiving', privateManifest: 'needsKey', progress: 'receiving', verify: 'verifying', complete: 'complete', fail: 'failed' },
  awaitingVideo: { toCamera: 'idle', loadVideo: 'scanning', manifest: 'receiving', privateManifest: 'needsKey', progress: 'receiving', verify: 'verifying', complete: 'complete', fail: 'failed' },
  scanning: { toFile: 'awaitingVideo', stop: 'idle', manifest: 'receiving', privateManifest: 'needsKey', progress: 'receiving', verify: 'verifying', complete: 'complete', fail: 'failed', clear: 'idle' },
  needsKey: { toFile: 'needsKey', manifest: 'receiving', keyAccepted: 'receiving', verify: 'verifying', complete: 'complete', fail: 'failed', clear: 'idle' },
  receiving: { toFile: 'receiving', privateManifest: 'needsKey', verify: 'verifying', complete: 'complete', fail: 'failed', clear: 'idle' },
  verifying: { toFile: 'verifying', complete: 'complete', fail: 'failed', clear: 'idle' },
  complete: { toFile: 'complete', complete: 'complete', fail: 'failed', clear: 'idle' },
  failed: { toFile: 'awaitingVideo', startCamera: 'scanning', manifest: 'receiving', privateManifest: 'needsKey', progress: 'receiving', verify: 'verifying', complete: 'complete', fail: 'failed', clear: 'idle' },
};

const CASES = PHASES.flatMap((phase) => EVENT_NAMES.map((event) => [phase, event, NEXT[phase][event] ?? null] as const));

describe('receiverReducer', () => {
  it('starts idle in camera mode and waiting for a video in file mode', () => {
    expect(initialReceiverState('camera')).toEqual({ mode: 'camera', phase: 'idle' });
    expect(initialReceiverState('file')).toEqual({ mode: 'file', phase: 'awaitingVideo' });
  });

  it.each(CASES)('in %s, %s goes to %s', (phase, event, expected) => {
    const state = stateIn(phase);
    const next = receiverReducer(state, EVENTS[event]);
    if (expected === null) {
      // An event that does not apply returns the very same state.
      expect(next).toBe(state);
      return;
    }
    expect(next.phase).toBe(expected);
  });

  it('carries the result of a finished receive and the failure of a failed one', () => {
    const done = receiverReducer(stateIn('verifying'), EVENTS.complete);
    expect(done).toEqual({ mode: 'camera', phase: 'complete', result: FILE_RESULT });
    const camera = receiverReducer(stateIn('idle'), { type: 'fail', error: { source: 'camera', message: 'Blocked' } });
    expect(camera).toEqual({ mode: 'camera', phase: 'failed', error: { source: 'camera', message: 'Blocked' } });
  });

  it('keeps a transfer under way when the mode changes, and remembers the mode for Clear', () => {
    const moved = receiverReducer(stateIn('receiving'), EVENTS.toFile);
    expect(moved).toEqual({ mode: 'file', phase: 'receiving' });
    expect(receiverReducer(moved, EVENTS.clear)).toEqual({ mode: 'file', phase: 'awaitingVideo' });
  });

  it('ignores a camera start in file mode and a video in camera mode', () => {
    const file = initialReceiverState('file');
    expect(receiverReducer(file, EVENTS.startCamera)).toBe(file);
    const camera = initialReceiverState('camera');
    expect(receiverReducer(camera, EVENTS.loadVideo)).toBe(camera);
  });

  it('runs a whole private receive', () => {
    let state = initialReceiverState('camera');
    const phases: ReceiverPhase[] = [];
    for (const event of ['startCamera', 'privateManifest', 'keyRejected', 'keyAccepted', 'progress', 'verify', 'complete', 'clear'] as const) {
      state = receiverReducer(state, EVENTS[event]);
      phases.push(state.phase);
    }
    expect(phases).toEqual(['scanning', 'needsKey', 'needsKey', 'receiving', 'receiving', 'verifying', 'complete', 'idle']);
  });
});
