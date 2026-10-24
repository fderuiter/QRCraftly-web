/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
import { parseMeetingUrl } from '../index';

describe('meetingParsers', () => {
  describe('parseMeetingUrl', () => {
    it('returns unknown service for empty string', () => {
      expect(parseMeetingUrl('')).toEqual({ service: 'unknown' });
    });

    it('returns unknown service for unrecognized URL', () => {
      expect(parseMeetingUrl('https://example.com/meeting/123')).toEqual({
        service: 'unknown',
      });
    });

    describe('Zoom', () => {
      it('parses a standard Zoom URL with meeting ID and passcode', () => {
        const result = parseMeetingUrl('https://zoom.us/j/123456789?pwd=AbCdEfGh');
        expect(result.service).toBe('zoom');
        expect(result.meetingId).toBe('123456789');
        expect(result.passcode).toBe('AbCdEfGh');
      });

      it('parses a Zoom URL without passcode', () => {
        const result = parseMeetingUrl('https://zoom.us/j/987654321');
        expect(result.service).toBe('zoom');
        expect(result.meetingId).toBe('987654321');
        expect(result.passcode).toBeUndefined();
      });

      it('parses a subdomain Zoom URL', () => {
        const result = parseMeetingUrl('https://us02web.zoom.us/j/555000111?pwd=XyZ123');
        expect(result.service).toBe('zoom');
        expect(result.meetingId).toBe('555000111');
        expect(result.passcode).toBe('XyZ123');
      });

      it('returns unknown when Zoom URL has no meeting ID', () => {
        const result = parseMeetingUrl('https://zoom.us/profile');
        expect(result.service).toBe('unknown');
      });
    });

    describe('Microsoft Teams', () => {
      it('parses a Teams meetup-join URL and extracts thread ID', () => {
        const url =
          'https://teams.microsoft.com/l/meetup-join/19%3Ameeting_AbCdEfGhIjKlMn%40thread.v2/0?context=%7B%22Tid%22%3A%22abc%22%7D';
        const result = parseMeetingUrl(url);
        expect(result.service).toBe('teams');
        expect(result.meetingId).toBe('AbCdEfGhIjKlMn');
      });

      it('falls back to undecoded slice on decodeURIComponent failure', () => {
        const url = 'https://teams.microsoft.com/l/meetup-join/abc%/0';
        const result = parseMeetingUrl(url);
        expect(result.service).toBe('teams');
        expect(result.meetingId).toBe('abc%');
      });

      it('returns unknown when Teams URL has no meetup-join segment', () => {
        const result = parseMeetingUrl('https://teams.microsoft.com/go');
        expect(result.service).toBe('unknown');
      });
    });

    describe('Google Meet', () => {
      it('parses a standard Google Meet URL', () => {
        const result = parseMeetingUrl('https://meet.google.com/abc-defg-hij');
        expect(result.service).toBe('meet');
        expect(result.meetingId).toBe('abc-defg-hij');
      });

      it('returns unknown when Meet URL has no code', () => {
        const result = parseMeetingUrl('https://meet.google.com/');
        expect(result.service).toBe('unknown');
      });
    });

    describe('hostname spoofing prevention', () => {
      it('does not match a URL that contains teams.microsoft.com as a path segment', () => {
        const result = parseMeetingUrl('https://evil.com/teams.microsoft.com/l/meetup-join/...');
        expect(result.service).toBe('unknown');
      });

      it('does not match a URL that contains meet.google.com as a path segment', () => {
        const result = parseMeetingUrl('https://evil.com/meet.google.com/abc-defg-hij');
        expect(result.service).toBe('unknown');
      });

      it('returns unknown for invalid (non-parseable) URL strings', () => {
        const result = parseMeetingUrl('not a url at all');
        expect(result.service).toBe('unknown');
      });
    });
  });
});
