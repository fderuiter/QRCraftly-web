/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_VIDEO_FILE_MB, SITE_VIDEOS, videoSrc } from './videos';

const MEDIA_DIR = 'public/media';

describe('site videos', () => {
  it('ships every listed video, poster and caption file, each under the size limit', () => {
    for (const video of SITE_VIDEOS) {
      for (const kind of ['mp4', 'jpg', 'vtt'] as const) {
        const file = `public${videoSrc(video, kind)}`;
        expect(statSync(file).size, file).toBeLessThanOrEqual(MAX_VIDEO_FILE_MB * 1024 * 1024);
      }
    }
  });

  it('lists every file in public/media, so nothing large ships unseen', () => {
    const listed = new Set(SITE_VIDEOS.flatMap((video) => [`${video.id}.mp4`, `${video.id}.jpg`, `${video.id}.vtt`]));
    expect(readdirSync(MEDIA_DIR).filter((file) => !listed.has(file))).toEqual([]);
  });

  it('gives each caption file a WebVTT header', () => {
    for (const video of SITE_VIDEOS) {
      expect(readFileSync(`public${videoSrc(video, 'vtt')}`, 'utf8').startsWith('WEBVTT')).toBe(true);
    }
  });

  it('gives each video a unique id, a description and on-screen text', () => {
    expect(new Set(SITE_VIDEOS.map((video) => video.id)).size).toBe(SITE_VIDEOS.length);
    for (const video of SITE_VIDEOS) {
      expect(video.description.length).toBeGreaterThan(20);
      expect(video.transcript.length).toBeGreaterThan(0);
      expect(video.related.href.startsWith('/')).toBe(true);
    }
  });
});
