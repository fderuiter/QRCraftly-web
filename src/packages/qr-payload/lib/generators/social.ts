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

import { type SocialData, SocialPlatform, QRType, type QRGeneratorContract } from '@/types';
import { parseProtocol, parseSocialProfile, identifyProtocol } from '../protocol';
import { sanitizeSocialHandle } from '@/utils/security';

const SOCIAL_PLATFORM_URLS: Record<SocialPlatform, (handle: string) => string> = {
  [SocialPlatform.INSTAGRAM]: (handle) => `https://instagram.com/${handle}`,
  [SocialPlatform.TWITTER]: (handle) => `https://x.com/${handle}`,
  [SocialPlatform.TIKTOK]: (handle) => `https://tiktok.com/@${handle}`,
  [SocialPlatform.LINKEDIN]: (handle) => `https://linkedin.com/in/${handle}`,
  [SocialPlatform.YOUTUBE]: (handle) => `https://youtube.com/@${handle}`,
  [SocialPlatform.FACEBOOK]: (handle) => `https://facebook.com/${handle}`,
  [SocialPlatform.WHATSAPP]: (handle) => `https://wa.me/${handle}`,
  [SocialPlatform.GITHUB]: (handle) => `https://github.com/${handle}`,
};

/**
 * Constructs a standard HTTPS social media profile URL from the given data.
 *
 * Uses Universal Links (HTTPS) so modern mobile operating systems automatically
 * route to the installed native app when available, with a web browser fallback.
 *
 * @param data - The social data containing the platform and handle.
 * @returns A full HTTPS profile URL, or an empty string if the handle is empty.
 */
export const constructSocialString = (data: SocialData): string => {
  if (!data) return '';
  const cleanHandle = sanitizeSocialHandle(data.handle);
  if (!cleanHandle) return '';

  const constructUrl = SOCIAL_PLATFORM_URLS[data.platform];
  return constructUrl ? constructUrl(cleanHandle) : '';
};

/**
 * Hydrates SocialData from a raw string.
 */
export const hydrateSocialData = (raw: string): SocialData => {
  const result: SocialData = {
    platform: SocialPlatform.INSTAGRAM,
    handle: '',
  };

  const parsed = parseProtocol(raw);
  const profile = parsed ? parseSocialProfile(parsed) : null;
  if (profile) {
    result.platform = profile.platform;
    result.handle = profile.handle;
  }

  return result;
};

export const SocialContract: QRGeneratorContract<SocialData> = {
  type: QRType.SOCIAL,
  construct: constructSocialString,
  hydrate: hydrateSocialData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.SOCIAL,
  validate: () => [],
};
