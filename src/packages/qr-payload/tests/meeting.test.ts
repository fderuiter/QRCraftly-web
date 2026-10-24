/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { describe, it, expect } from 'vitest';
import { constructMeetingString, hydrateMeetingData, MeetingContract } from '../index';
import { QRType } from '@/packages/core/types';

describe('Meeting generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
      url: 'https://zoom.us/j/1234567890',
    };
    const str = constructMeetingString(data);
    const hydrated = hydrateMeetingData(str);
    expect(hydrated).toEqual(data);
  });

  it('implements MeetingContract correctly and validates URLs', () => {
    expect(MeetingContract.type).toBe(QRType.MEETING);
    expect(MeetingContract.matches('https://zoom.us/j/1234567890')).toBe(true);
    expect(MeetingContract.matches('random')).toBe(false);

    // Empty URL construction
    expect(MeetingContract.construct({ url: '' })).toBe('');

    // Safe URL validation
    expect(MeetingContract.validate?.('https://zoom.us/j/1234567890')).toEqual([]);

    // Dangerous URL validation
    expect(MeetingContract.validate?.('javascript:alert(1)')).toEqual(['URI_INJECTION_VIOLATION']);

    // Malformed URL starting with http
    expect(MeetingContract.validate?.('http://invalid url space')).toEqual([
      'URL_STRUCTURE_VIOLATION',
    ]);
  });
});
