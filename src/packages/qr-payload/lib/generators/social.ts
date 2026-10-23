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
import { parseProtocol, parseSocialProfile, identifyProtocol, YT_CHANNEL_RE, YT_PREFIX_RE } from '../protocol';
import { sanitizeSocialHandle } from '@/utils/security';

const PLATFORM_URL_PREFIXES: Partial<Record<SocialPlatform, string>> = {
  [SocialPlatform.INSTAGRAM]: 'https://instagram.com/',
  [SocialPlatform.TWITTER]: 'https://x.com/',
  [SocialPlatform.TIKTOK]: 'https://tiktok.com/@',
  [SocialPlatform.LINKEDIN]: 'https://linkedin.com/in/',
  [SocialPlatform.FACEBOOK]: 'https://facebook.com/',
  [SocialPlatform.WHATSAPP]: 'https://wa.me/',
  [SocialPlatform.GITHUB]: 'https://github.com/',
};

/**
 * Normalizes and constructs a canonical YouTube URL from a handle, channel ID, custom URL,
 * video link, or playlist link.
 */
export const parseYouTubeInput = (input: string): string => {
  if (!input) return '';
  const clean = input.trim().replace(/[\x00-\x1F\x7F-\x9F]/g, '').replace(/^\/+/, '');
  if (!clean) return '';

  const target = /^https?:\/\//i.test(clean)
    ? clean
    : /^(?:www\.|m\.|mobile\.)?(youtube\.com|youtu\.be)/i.test(clean)
      ? `https://${clean}`
      : `https://youtube.com/${YT_CHANNEL_RE.test(clean) ? 'channel/' + clean : YT_PREFIX_RE.test(clean) ? clean : '@' + clean.replace(/^@+/, '')}`;

  const profile = parseSocialProfile(parseProtocol(target)!);
  if (!profile || profile.platform !== SocialPlatform.YOUTUBE) return '';

  const h = profile.handle;
  return h.startsWith('youtu.be/') ? `https://${h}` : `https://youtube.com/${YT_PREFIX_RE.test(h) ? h : '@' + h}`;
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
  if (!data || !data.handle) return '';

  if (data.platform === SocialPlatform.YOUTUBE) {
    return parseYouTubeInput(data.handle);
  }

  const cleanHandle = sanitizeSocialHandle(data.handle);
  if (!cleanHandle) return '';

  if (data.platform === SocialPlatform.WHATSAPP && data.message && data.message.trim()) {
    return `https://wa.me/${cleanHandle}?text=${encodeURIComponent(data.message.trim())}`;
  }

  const prefix = PLATFORM_URL_PREFIXES[data.platform];
  return prefix ? prefix + cleanHandle : '';
};

/**
 * Hydrates SocialData from a raw string.
 */
export const hydrateSocialData = (raw: string): SocialData => {
  const parsed = parseProtocol(raw);
  const profile = parsed ? parseSocialProfile(parsed) : null;
  return profile
    ? { platform: profile.platform, handle: profile.handle, ...(profile.message ? { message: profile.message } : {}) }
    : { platform: SocialPlatform.INSTAGRAM, handle: '' };
};

export const SocialContract: QRGeneratorContract<SocialData> = {
  type: QRType.SOCIAL,
  construct: constructSocialString,
  hydrate: hydrateSocialData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.SOCIAL,
  validate: () => [],
};
