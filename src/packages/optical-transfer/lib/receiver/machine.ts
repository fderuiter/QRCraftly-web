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
 * The receiver's phase as one value (#1513), with the finished result or the failure it ended on.
 * Pure: no React, no timers, no worker. The switch offer is not a phase: it is an offer shown on
 * top of `receiving`.
 */

import type { BcUrResult } from '../../bcur';
import type { HandshakeInfo } from '../contracts';

/** Where a receive stands. */
export type ReceiverPhase =
  /** Camera mode, the camera is off. */
  | 'idle'
  /** Video mode, no video loaded yet. */
  | 'awaitingVideo'
  /** The camera or a video plays and no transfer code was read yet. */
  | 'scanning'
  /** A private transfer is in view and no key code has opened it. */
  | 'needsKey'
  /** Blocks of a transfer are arriving. */
  | 'receiving'
  /** Every block arrived: the file is checked against its SHA-256. */
  | 'verifying'
  /** A file, a bundle or a wallet-style stream was received. */
  | 'complete'
  /** The receive, the video file or the camera failed. */
  | 'failed';

export type ReceiverMode = 'camera' | 'file';

/** One file of a finished bundle, held in memory until the person saves it. */
export interface ReceivedBundleFile {
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  data: Uint8Array;
}

/** What a finished receive holds. */
export type ReceiverResult =
  | { kind: 'file'; handshake: HandshakeInfo | null; data: Uint8Array }
  | { kind: 'bundle'; files: ReceivedBundleFile[] }
  | { kind: 'bcur'; result: BcUrResult };

/** Why a receive failed, and which part failed. */
export interface ReceiverFailure {
  source: 'receiver' | 'file' | 'camera';
  message: string;
}

export type ReceiverState = { mode: ReceiverMode } & (
  | { phase: Exclude<ReceiverPhase, 'complete' | 'failed'> }
  | { phase: 'complete'; result: ReceiverResult }
  | { phase: 'failed'; error: ReceiverFailure }
);

/** What happens to the receiver. */
export type ReceiverEvent =
  | { type: 'chooseMode'; mode: ReceiverMode }
  | { type: 'startCamera' }
  | { type: 'loadVideo' }
  | { type: 'stop' }
  | { type: 'manifest'; needsKey: boolean }
  | { type: 'keyStatus'; accepted: boolean }
  | { type: 'progress' }
  | { type: 'verify' }
  | { type: 'complete'; result: ReceiverResult }
  | { type: 'fail'; error: ReceiverFailure }
  | { type: 'clear' };

/** Where a receiver with nothing in view starts in a mode. */
const restingPhase = (mode: ReceiverMode) => (mode === 'camera' ? 'idle' : 'awaitingVideo');

/**
 * The first state for a mode.
 * @param mode - The mode the page opens in.
 */
export function initialReceiverState(mode: ReceiverMode): ReceiverState {
  return { mode, phase: restingPhase(mode) };
}

/** Phases with no transfer under way: starting a camera or a video moves them to `scanning`. */
const WAITING: ReadonlySet<ReceiverPhase> = new Set(['idle', 'awaitingVideo', 'scanning', 'failed']);
/** Phases a transfer's news (a manifest, progress) no longer changes. */
const SETTLED: ReadonlySet<ReceiverPhase> = new Set(['verifying', 'complete']);

/** The state in `phase`, or the same object when it is there already. */
function moveTo(state: ReceiverState, phase: Exclude<ReceiverPhase, 'complete' | 'failed'>): ReceiverState {
  return state.phase === phase ? state : { mode: state.mode, phase };
}

/**
 * The next receiver state. An event that does not apply to the current phase returns the same state object.
 * @param state - The current state.
 * @param event - What happened.
 */
export function receiverReducer(state: ReceiverState, event: ReceiverEvent): ReceiverState {
  const { phase } = state;
  switch (event.type) {
    case 'chooseMode': {
      if (event.mode === state.mode) return state;
      // A transfer under way carries on in the other mode; a waiting receiver waits in the new one.
      if (WAITING.has(phase)) return initialReceiverState(event.mode);
      return { ...state, mode: event.mode };
    }
    case 'startCamera':
      return state.mode === 'camera' && WAITING.has(phase) ? moveTo(state, 'scanning') : state;
    case 'loadVideo':
      return state.mode === 'file' && WAITING.has(phase) ? moveTo(state, 'scanning') : state;
    case 'stop':
      return phase === 'scanning' ? moveTo(state, restingPhase(state.mode)) : state;
    case 'manifest':
      return SETTLED.has(phase) ? state : moveTo(state, event.needsKey ? 'needsKey' : 'receiving');
    case 'keyStatus':
      return phase === 'needsKey' && event.accepted ? moveTo(state, 'receiving') : state;
    case 'progress':
      // A fresh decode after a failed one recovers: the receiver simply scans on.
      return SETTLED.has(phase) || phase === 'needsKey' ? state : moveTo(state, 'receiving');
    case 'verify':
      return phase === 'complete' ? state : moveTo(state, 'verifying');
    case 'complete':
      return { mode: state.mode, phase: 'complete', result: event.result };
    case 'fail':
      return { mode: state.mode, phase: 'failed', error: event.error };
    case 'clear':
      return moveTo(state, restingPhase(state.mode));
    default: {
      const unknown: never = event;
      return unknown;
    }
  }
}
