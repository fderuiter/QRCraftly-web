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
import { TRANSFER_SPEEDS, formatFileSize, formatShortDuration, matchTransferSpeed } from './transferSpeed';

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
