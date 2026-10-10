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

import { normalizeUrl, shouldNormalizeUrl } from './url';

/**
 * Parsed meeting information extracted from a meeting URL.
 */
interface ParsedMeeting {
  /** The type of meeting service detected. */
  service: 'zoom' | 'teams' | 'meet' | 'unknown';
  /** The extracted meeting ID, if found. */
  meetingId?: string;
  /** The extracted passcode, if found. */
  passcode?: string;
}

/**
 * Parses a Zoom meeting URL to extract the meeting ID and optional passcode.
 *
 * Supports formats like:
 *   https://zoom.us/j/123456789?pwd=AbCdEfGh
 *   https://us02web.zoom.us/j/987654321?pwd=XyZ
 */
const parseZoomUrl = (url: string): ParsedMeeting | null => {
  const idMatch = url.match(/\/j\/(\d+)/);
  if (!idMatch) return null;

  const meetingId = idMatch[1];
  const pwdMatch = url.match(/[?&]pwd=([a-zA-Z0-9_\-]+)/);
  const passcode = pwdMatch ? pwdMatch[1] : undefined;

  return { service: 'zoom', meetingId, passcode };
};

/**
 * Parses a Microsoft Teams meeting URL to extract the meeting ID.
 *
 * Supports formats like:
 *   https://teams.microsoft.com/l/meetup-join/...
 */
const parseTeamsUrl = (url: string): ParsedMeeting | null => {
  // Teams URLs encode the meeting ID inside the path after /meetup-join/
  const match = url.match(/\/meetup-join\/([^/]+)/);
  if (!match) return null;

  // Decode and extract the thread ID which serves as the meeting identifier
  let meetingId: string | undefined;
  try {
    const decoded = decodeURIComponent(match[1]);
    // Thread IDs look like "19:meeting_<base64>@thread.v2"
    const threadMatch = decoded.match(/19:meeting_([A-Za-z0-9+/=_-]+)@thread/);
    if (threadMatch) {
      meetingId = threadMatch[1];
    } else {
      // Fall back to the raw segment, truncated for readability
      meetingId = decoded.slice(0, 40);
    }
  } catch {
    meetingId = match[1].slice(0, 40);
  }

  return { service: 'teams', meetingId };
};

/**
 * Parses a Google Meet URL to extract the meeting code.
 *
 * Supports formats like:
 *   https://meet.google.com/abc-defg-hij
 */
const parseMeetUrl = (url: string): ParsedMeeting | null => {
  const match = url.match(/meet\.google\.com\/([a-zA-Z]{3}-[a-zA-Z]{4}-[a-zA-Z]{3})/);
  if (!match) return null;

  return { service: 'meet', meetingId: match[1] };
};

/**
 * Parses a meeting invite URL and returns structured meeting information.
 *
 * Detects Zoom, Microsoft Teams, and Google Meet links.
 * Uses hostname comparison to prevent spoofed URLs (e.g. evil.com/teams.microsoft.com)
 * from being incorrectly classified as legitimate meeting links.
 *
 * @param input - The raw meeting invite URL.
 * @returns A `ParsedMeeting` object with detected service, meeting ID, and passcode.
 */
export const parseMeetingUrl = (input: string): ParsedMeeting => {
  if (!input) return { service: 'unknown' };
  // A link pasted without a scheme is encoded with https:// (#1280), so read it the same way.
  const url = shouldNormalizeUrl(input) ? normalizeUrl(input) : input;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return { service: 'unknown' };
  }

  if (hostname === 'zoom.us' || hostname.endsWith('.zoom.us')) {
    const result = parseZoomUrl(url);
    if (result) return result;
  }

  if (hostname === 'teams.microsoft.com') {
    const result = parseTeamsUrl(url);
    if (result) return result;
  }

  if (hostname === 'meet.google.com') {
    const result = parseMeetUrl(url);
    if (result) return result;
  }

  return { service: 'unknown' };
};
