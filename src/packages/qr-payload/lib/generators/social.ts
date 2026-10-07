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

import { SocialData, SocialPlatform, QRType, QRGeneratorContract } from '@/types';
import { SOCIAL_DOMAINS, parseProtocol, identifyProtocol } from '../protocol';
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
  if (parsed && (parsed.scheme === 'http' || parsed.scheme === 'https')) {
    // Check if path starts with a known domain
    const pathParts = parsed.path.split('/');
    let domain = pathParts[0].toLowerCase();

    // Remove www. if present
    if (domain.startsWith('www.')) {
      domain = domain.substring(4);
    }

    if (SOCIAL_DOMAINS[domain]) {
      result.platform = SOCIAL_DOMAINS[domain];
      let handlePart = pathParts[1] || '';
      if (domain === 'linkedin.com' && handlePart === 'in') {
        handlePart = pathParts[2] || '';
      }
      if (handlePart.startsWith('@')) {
        handlePart = handlePart.substring(1);
      }
      result.handle = handlePart;
    }
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
