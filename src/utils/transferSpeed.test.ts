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
  TRANSFER_SPEEDS,
  formatApproximateDuration,
  formatEta,
  formatFileSize,
  formatShortDuration,
  matchTransferSpeed,
} from './transferSpeed';

describe('transfer speeds', () => {
  it('offers Steady, Balanced and Fast, each faster than the last', () => {
    expect(TRANSFER_SPEEDS.map((speed) => speed.label)).toEqual(['Steady', 'Balanced', 'Fast']);
    const rates = TRANSFER_SPEEDS.map((speed) => speed.fps);
    expect([...rates].sort((a, b) => a - b)).toEqual(rates);
  });

  it('keeps Balanced equal to the defaults the sender starts with', () => {
    expect(matchTransferSpeed('balanced', 15)?.id).toBe('balanced');
  });

  it('matches only an exact density and frame rate', () => {
    expect(matchTransferSpeed('reliable', 8)?.id).toBe('steady');
    expect(matchTransferSpeed('fast', 24)?.id).toBe('fast');
    expect(matchTransferSpeed('fast', 25)).toBeUndefined();
    expect(matchTransferSpeed('balanced', 8)).toBeUndefined();
  });

  it('formats sizes and durations briefly', () => {
    expect(formatFileSize(812)).toBe('812 B');
    expect(formatFileSize(1229)).toBe('1.2 KB');
    expect(formatFileSize(48 * 1024)).toBe('48 KB');
    expect(formatFileSize(1.25 * 1024 * 1024)).toBe('1.25 MB');
    expect(formatShortDuration(0.2)).toBe('1 s');
    expect(formatShortDuration(12.4)).toBe('12 s');
    expect(formatShortDuration(150)).toBe('3 min');
    expect(formatShortDuration(7200)).toBe('2.0 h');
    expect(formatShortDuration(Number.POSITIVE_INFINITY)).toBe('--');
  });
});

describe('duration wording', () => {
  it('reads an approximate duration as a spoken estimate, singular at one', () => {
    expect(formatApproximateDuration(0.2)).toBe('about 1 second');
    expect(formatApproximateDuration(1)).toBe('about 1 second');
    expect(formatApproximateDuration(40)).toBe('about 40 seconds');
    expect(formatApproximateDuration(60)).toBe('about 1 minute');
    expect(formatApproximateDuration(89 * 60)).toBe('about 89 minutes');
    expect(formatApproximateDuration(90 * 60)).toBe('about 1.5 hours');
  });

  it('shows the receiver time left, and "--" only when it is unknown', () => {
    expect(formatEta(null)).toBe('--');
    expect(formatEta(Number.NaN)).toBe('--');
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('--');
    expect(formatEta(0)).toBe('<1 s');
    expect(formatEta(0.5)).toBe('<1 s');
    expect(formatEta(1)).toBe('1 s');
    expect(formatEta(59.2)).toBe('60 s');
    expect(formatEta(65)).toBe('1 min 5 s');
    expect(formatEta(120.5)).toBe('2 min 1 s');
  });
});
