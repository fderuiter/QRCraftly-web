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
import { UrlContract, constructUrlString } from '../index';
import { QRType } from '@/packages/core/types';

describe('Url generator and contract', () => {
  it('constructs url string with normalization', () => {
    expect(constructUrlString({ url: 'https://example.com' })).toBe('https://example.com/');
    expect(constructUrlString({ url: 'google.com' })).toBe('https://google.com/');
  });

  it('implements UrlContract correctly and validates URLs', () => {
    expect(UrlContract.type).toBe(QRType.URL);
    expect(UrlContract.matches('https://example.com')).toBe(true);
    expect(UrlContract.matches('random')).toBe(false);

    // Empty URL hydration
    expect(UrlContract.hydrate('https://example.com')).toEqual({ url: 'https://example.com' });

    // Safe URL validation
    expect(UrlContract.validate?.('https://example.com')).toEqual([]);

    // Dangerous URL validation
    expect(UrlContract.validate?.('javascript:alert(1)')).toEqual(['URI_INJECTION_VIOLATION']);

    // Malformed URL starting with http
    expect(UrlContract.validate?.('http://invalid url space')).toEqual(['URL_STRUCTURE_VIOLATION']);
  });
});
