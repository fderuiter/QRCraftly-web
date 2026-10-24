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
import {
  describeCameraError,
  formatDuration,
  fountainStatsFrom,
  permissionOf,
  steerMessage,
  transferProgress,
  validateReceivedFile,
  type DurationStyle,
} from '../index';

/** The receiver's upload limit, 500 MB. */
const MAX_VIDEO_UPLOAD_BYTES = 500 * 1024 * 1024;

const named = (name: string, message = '') => Object.assign(new Error(message), { name });

describe('formatDuration', () => {
  const GRID: ReadonlyArray<[number | null, Record<DurationStyle, string>]> = [
    [0, { long: 'about 1 second', short: '1 s', eta: '<1 s' }],
    [0.5, { long: 'about 1 second', short: '1 s', eta: '<1 s' }],
    [59, { long: 'about 59 seconds', short: '59 s', eta: '59 s' }],
    [60, { long: 'about 1 minute', short: '1 min', eta: '1 min 0 s' }],
    [3599, { long: 'about 60 minutes', short: '60 min', eta: '59 min 59 s' }],
    [3600, { long: 'about 60 minutes', short: '60 min', eta: '60 min 0 s' }],
    [null, { long: '--', short: '--', eta: '--' }],
    [-5, { long: 'about 1 second', short: '1 s', eta: '<1 s' }],
    [Number.NaN, { long: '--', short: '--', eta: '--' }],
    [Number.POSITIVE_INFINITY, { long: '--', short: '--', eta: '--' }],
  ];

  it.each(GRID)('formats %s seconds in every style', (seconds, expected) => {
    for (const style of ['long', 'short', 'eta'] as const) {
      expect(formatDuration(seconds, style)).toBe(expected[style]);
    }
  });

  it('keeps the short labels', () => {
    expect(formatDuration(0.2, 'short')).toBe('1 s');
    expect(formatDuration(12.4, 'short')).toBe('12 s');
    expect(formatDuration(150, 'short')).toBe('3 min');
    expect(formatDuration(7200, 'short')).toBe('2.0 h');
  });

  it('reads an approximate duration as a spoken estimate, singular at one', () => {
    expect(formatDuration(0.2, 'long')).toBe('about 1 second');
    expect(formatDuration(1, 'long')).toBe('about 1 second');
    expect(formatDuration(40, 'long')).toBe('about 40 seconds');
    expect(formatDuration(60, 'long')).toBe('about 1 minute');
    expect(formatDuration(89 * 60, 'long')).toBe('about 89 minutes');
    expect(formatDuration(90 * 60, 'long')).toBe('about 1.5 hours');
  });

  it('shows the receiver time left', () => {
    expect(formatDuration(1, 'eta')).toBe('1 s');
    expect(formatDuration(59.2, 'eta')).toBe('60 s');
    expect(formatDuration(65, 'eta')).toBe('1 min 5 s');
    expect(formatDuration(120.5, 'eta')).toBe('2 min 1 s');
  });
});

describe('transferProgress', () => {
  it('reports nothing for an empty stream', () => {
    expect(transferProgress(0, 0)).toEqual({ percent: 0, loop: 1 });
    expect(transferProgress(5, 0)).toEqual({ percent: 0, loop: 1 });
  });

  it('counts the first pass', () => {
    expect(transferProgress(1, 4)).toEqual({ percent: 25, loop: 1 });
    expect(transferProgress(3, 7)).toEqual({ percent: 43, loop: 1 });
  });

  it('starts the next pass only after the last frame of a pass', () => {
    expect(transferProgress(4, 4)).toEqual({ percent: 100, loop: 1 });
    expect(transferProgress(5, 4)).toEqual({ percent: 100, loop: 2 });
    expect(transferProgress(9, 4)).toEqual({ percent: 100, loop: 3 });
  });
});

describe('fountainStatsFrom', () => {
  it('marks every block decoded with no time left', () => {
    const stats = { k: 10, rank: 7, resolved: 6, progress: 70, dropletsReceived: 12, fps: 9.5, etaSeconds: 3 };
    expect(fountainStatsFrom(stats)).toEqual({ ...stats, rank: 10, resolved: 10, progress: 100, etaSeconds: 0 });
  });

  it('keeps no telemetry as none', () => {
    expect(fountainStatsFrom(null)).toBeNull();
  });
});

describe('permissionOf', () => {
  it.each(['NotAllowedError', 'SecurityError'])('reads %s as denied', (name) => {
    expect(permissionOf(named(name))).toBe('denied');
  });

  it.each(['NotFoundError', 'OverconstrainedError', 'NotReadableError'])('reads %s as unavailable', (name) => {
    expect(permissionOf({ name })).toBe('unavailable');
  });

  it('throws anything else back', () => {
    const error = named('AbortError');
    expect(() => permissionOf(error)).toThrow(error);
    expect(() => permissionOf('broken')).toThrow();
  });
});

describe('describeCameraError', () => {
  it.each([
    ['NotAllowedError', /blocked/],
    ['PermissionDeniedError', /blocked/],
    ['SecurityError', /blocked/],
    ['NotFoundError', /No camera was found/],
    ['OverconstrainedError', /No camera was found/],
    ['NotReadableError', /in use by another app/],
    ['TrackStartError', /in use by another app/],
  ])('explains %s', (name, expected) => {
    expect(describeCameraError(named(name))).toMatch(expected);
  });

  it('falls back to the message, then to a generic sentence', () => {
    expect(describeCameraError(named('Weird', 'Driver crashed'))).toBe('Driver crashed');
    expect(describeCameraError(named('Weird'))).toBe('The camera could not be started.');
  });
});

describe('steerMessage', () => {
  it('says nothing while steering is off', () => {
    expect(steerMessage({ status: 'off' }, null, 0)).toBe('');
  });

  it('asks for the camera, then names the speed and the receivers', () => {
    expect(steerMessage({ status: 'requesting' }, null, 0)).toBe('Asking for the camera so the receiver can steer the speed.');
    expect(steerMessage({ status: 'listening' }, null, 0)).toBe('The chosen speed. Point this device’s camera at the receiving screen’s small code.');
    expect(steerMessage({ status: 'listening' }, 'fast', 1)).toMatch(/speed, steered by 1 receiver\.$/);
    expect(steerMessage({ status: 'listening' }, 'fast', 2)).toMatch(/steered by 2 receivers\.$/);
  });

  it.each([
    ['denied', 'Camera access was refused'],
    ['unavailable', 'No camera was found'],
    ['camera-lost', 'The camera stopped'],
  ] as const)('explains a one-way stream after %s', (reason, why) => {
    expect(steerMessage({ status: 'one-way', reason }, null, 0)).toBe(`${why}, so this transfer runs at the speed you chose and does not stop by itself.`);
  });
});

describe('validateReceivedFile', () => {
  const video = { name: 'clip.mp4', type: 'video/mp4', size: 1024 };

  it('accepts a video by type, or by extension when there is no type', () => {
    expect(validateReceivedFile(video)).toBeNull();
    expect(validateReceivedFile({ name: 'clip.webm', type: '', size: 1024 })).toBeNull();
  });

  it.each([
    ['a blank name', { name: '', type: '', size: 1 }],
    ['a whitespace name', { name: '   ', type: '', size: 1 }],
    ['a refused type', { name: 'notes.txt', type: 'text/plain', size: 1 }],
  ])('refuses %s', (_label, file) => {
    expect(validateReceivedFile(file)).toBe('Invalid file type. Please upload a supported video file (e.g. MP4, WebM).');
  });

  it('accepts a video at the size limit and refuses one over it', () => {
    expect(validateReceivedFile({ ...video, size: MAX_VIDEO_UPLOAD_BYTES })).toBeNull();
    expect(validateReceivedFile({ ...video, size: MAX_VIDEO_UPLOAD_BYTES + 1 })).toBe('This video is too large to scan. The limit is 500 MB.');
  });
});
