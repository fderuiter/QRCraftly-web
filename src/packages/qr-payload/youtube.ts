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

import { SocialPlatform } from '@/types';
import { parseProtocol, type ParsedProtocol, type SocialProfile } from './lib/protocol';

const YT_RESERVED = /^(watch|shorts|playlist|channel|c|user|feed|results|premium|gaming|music|upload|tv|about|help|terms|privacy)$/i;
const YOUTUBE_HANDLE_PATTERN = /^[a-zA-Z0-9_.\-/@?&=%]+$/;
const P_RE = /^(watch\?|playlist\?|(shorts|channel|c|user)\/)/;
const UC_RE = /^UC[\w-]{22}$/;

/**
 * Reads a YouTube profile URL from a parsed protocol.
 */
export const parseYouTubeProfile = (parsed: ParsedProtocol): SocialProfile | null => {
  if (parsed.scheme !== 'https') return null;
  if (parsed.path.includes('#')) return null;

  const [rawHost, ...rest] = parsed.path.split('/');
  const host = rawHost.toLowerCase().replace(/^(www|m|mobile)\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be') return null;

  const segments = rest.length > 0 && rest[rest.length - 1] === '' ? rest.slice(0, -1) : rest;
  if (segments.includes('')) return null;

  let handle: string | undefined;
  const querySuffix = parsed.params.size ? '?' + new URLSearchParams([...parsed.params]).toString() : '';

  if (segments.length === 1) {
    const s0 = segments[0];
    if (host === 'youtu.be') handle = `youtu.be/${s0}`;
    else if (s0[0] === '@') handle = s0.replace(/^@+/, '');
    else if ((s0 === 'watch' && parsed.params.has('v')) || (s0 === 'playlist' && parsed.params.has('list'))) handle = s0;
    else if (!YT_RESERVED.test(s0)) handle = `c/${s0}`;
  } else if (segments.length === 2) {
    const [s0, s1] = segments;
    if (/^(c|user|shorts)$/.test(s0) || (s0 === 'channel' && /^UC[\w-]{22}$/.test(s1))) handle = `${s0}/${s1}`;
  }

  if (handle) handle += querySuffix;
  if (!handle || !YOUTUBE_HANDLE_PATTERN.test(handle)) return null;

  return { platform: SocialPlatform.YOUTUBE, handle };
};

/**
 * Normalizes and constructs a canonical YouTube URL from a handle, channel ID, custom URL,
 * video link, or playlist link.
 */
export const parseYouTubeInput = (input: string): string => {
  let clean = (input || '').trim().replace(/[\x00-\x1F\x7F-\x9F]/g, '').replace(/^\/+/, '');
  if (!clean) return '';

  if (/(youtube\.com|youtu\.be)/i.test(clean)) {
    const full = /^https?:\/\//i.test(clean) ? clean : 'https://' + clean;
    const parsed = parseProtocol(full);
    const p = parsed ? parseYouTubeProfile(parsed) : null;
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
