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

const PLATFORM_URL_PREFIXES: Record<string, string> = {
  instagram: 'https://instagram.com/',
  twitter: 'https://x.com/',
  tiktok: 'https://tiktok.com/@',
  linkedin: 'https://linkedin.com/in/',
  facebook: 'https://facebook.com/',
  whatsapp: 'https://wa.me/',
  github: 'https://github.com/',
};

const P_RE = /^(watch\?|playlist\?|(shorts|channel|c|user)\/)/;
const UC_RE = /^UC[\w-]{22}$/;

/**
 * Normalizes and constructs a canonical YouTube URL from a handle, channel ID, custom URL,
 * video link, or playlist link.
 */
export const parseYouTubeInput = (input: string): string => {
  let clean = (input || '').trim().replace(/[\x00-\x1F\x7F-\x9F]/g, '').replace(/^\/+/, '');
  if (!clean) return '';

  if (/(youtube\.com|youtu\.be)/i.test(clean)) {
    const full = /^https?:\/\//i.test(clean) ? clean : 'https://' + clean;
    const p = parseSocialProfile(parseProtocol(full)!);
    return p?.platform === SocialPlatform.YOUTUBE
      ? 'https://' + (p.handle.startsWith('youtu.be/') ? p.handle : 'youtube.com/' + (P_RE.test(p.handle) ? p.handle : '@' + p.handle))
      : '';
  }

  if (UC_RE.test(clean)) clean = 'channel/' + clean;
  if (P_RE.test(clean)) {
    if (/^channel\/(?!UC[\w-]{22}(\?.*)?$)/i.test(clean)) return '';
    return 'https://youtube.com/' + clean;
  }
  if (clean.includes('/')) return '';

  const h = clean.replace(/^@+/, '');
  return h ? 'https://youtube.com/@' + h : '';
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
  if (!data?.handle) return '';

  if (data.platform === 'youtube') {
    return parseYouTubeInput(data.handle);
  }

  const cleanHandle = sanitizeSocialHandle(data.handle);
  if (!cleanHandle) return '';

  if (data.platform === 'whatsapp' && data.message?.trim()) {
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
    : { platform: 'instagram', handle: '' };
};

export const SocialContract: QRGeneratorContract<SocialData> = {
  type: QRType.SOCIAL,
  construct: constructSocialString,
  hydrate: hydrateSocialData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.SOCIAL,
  validate: () => [],
};
