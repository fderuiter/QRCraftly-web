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

import { MeetingData, QRType, QRGeneratorContract } from '@/types';
import { validateUrlAndInject } from '@/utils/security';
import { normalizeUrl, shouldNormalizeUrl } from '@/utils/url';
import { identifyProtocol, CONTAINMENT_PROFILES } from '../protocol';

/**
 * Constructs the QR code string for a virtual meeting link.
 *
 * The encoded value is the meeting URL itself. A link pasted without a scheme
 * (`zoom.us/j/123`) gets `https://`, as the Website type does, so scanners open it (#1280).
 * The calling component may separately parse the URL to display meeting details.
 *
 * @param data - The meeting data containing the URL.
 * @returns The meeting URL string, or an empty string if the URL is empty.
 */
export const constructMeetingString = (data: MeetingData): string => {
  if (!data || !data.url) return '';
  const url = data.url.trim();
  return shouldNormalizeUrl(url) ? normalizeUrl(url) : url;
};

/**
 * Hydrates MeetingData from a raw string.
 */
export const hydrateMeetingData = (raw: string): MeetingData => {
  return {
    url: raw || '',
  };
};

export const MeetingContract: QRGeneratorContract<MeetingData> = {
  type: QRType.MEETING,
  construct: constructMeetingString,
  hydrate: hydrateMeetingData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.MEETING,
  validate: (raw: string) => {
    return validateUrlAndInject(raw, CONTAINMENT_PROFILES.URL);
  },
};
