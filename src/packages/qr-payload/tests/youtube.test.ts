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
import { parseYouTubeInput, parseYouTubeProfile } from '../youtube';
import { parseProtocol } from '../index';
import { SocialPlatform } from '@/types';

describe('YouTube URL & handle generator (youtube.ts)', () => {
  it('parses handles, channel IDs, custom URLs, video links, playlists, and youtu.be links', () => {
    // Channel handles & double @
    expect(parseYouTubeInput('@qrcraftly')).toBe('https://youtube.com/@qrcraftly');
    expect(parseYouTubeInput('@@qrcraftly')).toBe('https://youtube.com/@qrcraftly');
    expect(parseYouTubeInput('qrcraftly')).toBe('https://youtube.com/@qrcraftly');

    // Channel ID
    const channelUrl = 'https://youtube.com/channel/UC1234567890abcdef123456';
    const parsedChannel = parseProtocol(channelUrl);
    expect(parsedChannel).not.toBeNull();
    const profileChannel = parseYouTubeProfile(parsedChannel!);
    expect(profileChannel).toEqual({ platform: SocialPlatform.YOUTUBE, handle: 'channel/UC1234567890abcdef123456' });
    expect(parseYouTubeInput(channelUrl)).toBe(channelUrl);
    expect(parseYouTubeInput('UC1234567890abcdef123456')).toBe(channelUrl);

    // Custom URL
    const customUrl = 'https://youtube.com/c/customname';
    const parsedCustom = parseProtocol(customUrl);
    expect(parsedCustom).not.toBeNull();
    const profileCustom = parseYouTubeProfile(parsedCustom!);
    expect(profileCustom).toEqual({ platform: SocialPlatform.YOUTUBE, handle: 'c/customname' });
    expect(parseYouTubeInput(customUrl)).toBe(customUrl);

    // User legacy URL
    const userUrl = 'https://youtube.com/user/legacyname';
    const parsedUser = parseProtocol(userUrl);
    expect(parsedUser).not.toBeNull();
    const profileUser = parseYouTubeProfile(parsedUser!);
    expect(profileUser).toEqual({ platform: SocialPlatform.YOUTUBE, handle: 'user/legacyname' });
    expect(parseYouTubeInput(userUrl)).toBe(userUrl);

    // Video watch URL
    const watchUrl = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
    const parsedWatch = parseProtocol(watchUrl);
    expect(parsedWatch).not.toBeNull();
    const profileWatch = parseYouTubeProfile(parsedWatch!);
    expect(profileWatch).toEqual({ platform: SocialPlatform.YOUTUBE, handle: 'watch?v=dQw4w9WgXcQ' });
    expect(parseYouTubeInput(watchUrl)).toBe(watchUrl);

    // Shorts URL
    const shortsUrl = 'https://youtube.com/shorts/dQw4w9WgXcQ';
    const parsedShorts = parseProtocol(shortsUrl);
    expect(parsedShorts).not.toBeNull();
    const profileShorts = parseYouTubeProfile(parsedShorts!);
    expect(profileShorts).toEqual({ platform: SocialPlatform.YOUTUBE, handle: 'shorts/dQw4w9WgXcQ' });
    expect(parseYouTubeInput(shortsUrl)).toBe(shortsUrl);

    // youtu.be short link
    const shortLink = 'https://youtu.be/dQw4w9WgXcQ';
    const parsedShort = parseProtocol(shortLink);
    expect(parsedShort).not.toBeNull();
    const profileShort = parseYouTubeProfile(parsedShort!);
    expect(profileShort).toEqual({ platform: SocialPlatform.YOUTUBE, handle: 'youtu.be/dQw4w9WgXcQ' });
    expect(parseYouTubeInput(shortLink)).toBe(shortLink);

    // Playlist URL
    const playlistUrl = 'https://youtube.com/playlist?list=PL123456';
    const parsedPlaylist = parseProtocol(playlistUrl);
    expect(parsedPlaylist).not.toBeNull();
    const profilePlaylist = parseYouTubeProfile(parsedPlaylist!);
    expect(profilePlaylist).toEqual({ platform: SocialPlatform.YOUTUBE, handle: 'playlist?list=PL123456' });
    expect(parseYouTubeInput(playlistUrl)).toBe(playlistUrl);

    // Full URL input directly
    expect(parseYouTubeInput('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(watchUrl);
    expect(parseYouTubeInput('https://youtu.be/dQw4w9WgXcQ')).toBe(shortLink);
    expect(parseYouTubeInput('https://www.youtube.com/@qrcraftly')).toBe('https://youtube.com/@qrcraftly');
  });

  it('returns empty string for invalid YouTube URLs', () => {
    const invalidYouTubeInputs = [
      'https://youtube.com/@name/videos',
      'https://youtube.com/live/dQw4w9WgXcQ',
      'https://youtube.com/embed/dQw4w9WgXcQ',
      'https://youtube.com/channel/UC1234567890abcdef123456/featured',
      'https://youtube.com/watch',
      'https://youtube.com/playlist',
      'https://youtube.com/feed/subscriptions',
      'https://youtube.com/results?search_query=test',
      '@name/videos',
      'live/dQw4w9WgXcQ',
      'embed/dQw4w9WgXcQ',
      'channel/UC1234567890abcdef123456/featured',
    ];

    for (const input of invalidYouTubeInputs) {
      expect(parseYouTubeInput(input)).toBe('');
    }
  });

  it('handles YouTube channel IDs strictly (22 characters, case-sensitive) and distinguishes handles', () => {
    // 22-char channel ID
    expect(parseYouTubeInput('UC1234567890abcdef123456')).toBe('https://youtube.com/channel/UC1234567890abcdef123456');

    // Handles starting with UC
    expect(parseYouTubeInput('UCLA')).toBe('https://youtube.com/@UCLA');
    expect(parseYouTubeInput('uc_berkeley')).toBe('https://youtube.com/@uc_berkeley');
    expect(parseYouTubeInput('UC12345')).toBe('https://youtube.com/@UC12345');
  });

  it('preserves query parameters across all YouTube URL formats', () => {
    const testCases = [
      'https://youtu.be/dQw4w9WgXcQ?t=42',
      'https://youtube.com/@mkbhd?si=xyz123',
      'https://youtube.com/shorts/dQw4w9WgXcQ?si=abc',
      'https://youtube.com/channel/UC1234567890abcdef123456?si=abc',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42',
      'https://youtube.com/playlist?list=PL123456&si=xyz',
      'https://youtube.com/c/customname?si=abc',
    ];

    for (const raw of testCases) {
      const parsed = parseProtocol(raw);
      expect(parsed).not.toBeNull();
      const profile = parseYouTubeProfile(parsed!);
      expect(profile).not.toBeNull();
      expect(profile?.platform).toBe(SocialPlatform.YOUTUBE);
      expect(parseYouTubeInput(raw)).toBe(raw);
    }
  });

  it('maps legacy custom channel URLs without @ to /c/ namespace', () => {
    const raw = 'https://youtube.com/customname';
    const parsed = parseProtocol(raw);
    expect(parsed).not.toBeNull();
    const profile = parseYouTubeProfile(parsed!);
    expect(profile).toEqual({ platform: SocialPlatform.YOUTUBE, handle: 'c/customname' });
    expect(parseYouTubeInput(raw)).toBe('https://youtube.com/c/customname');
  });
});
