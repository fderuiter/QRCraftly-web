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

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { SITE_VIDEOS, videoSrc } from '@/data/videos';
import { isDangerousUrl } from '@/packages/core/security';

/**
 * The `/videos` page: short screen recordings of the tools. The files are served from this site
 * and play in the browser's own player. `preload="none"` means nothing downloads until someone
 * presses play, and there is no autoplay and no third-party player.
 * @returns The page.
 */
export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <Breadcrumbs pageId="videos" />
        <h1 className="mb-3 text-3xl font-bold text-fg sm:text-4xl">QRCraftly videos</h1>
        <p className="mb-8 max-w-3xl text-lg text-fg-muted">
          Short recordings of the tools at work. They play from this site, with no video player from anywhere else, and
          nothing downloads until you press play.
        </p>
        <ul className="grid list-none gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SITE_VIDEOS.map((video) => {
            const wide = video.width > video.height;
            const titleId = `${video.id}-title`;
            return (
              <li key={video.id} className={`flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
                <video
                  className={`w-full rounded-lg bg-surface-sunken ${wide ? 'aspect-video' : 'aspect-[9/16]'}`}
                  controls
                  playsInline
                  preload="none"
                  poster={videoSrc(video, 'jpg')}
                  aria-labelledby={titleId}
                >
                  <source src={videoSrc(video, 'mp4')} type="video/mp4" />
                  <track kind="captions" src={videoSrc(video, 'vtt')} srcLang="en" label="English" default />
                </video>
                <h2 id={titleId} className="text-xl font-bold text-fg">{video.title}</h2>
                <p className="text-sm text-fg-soft">{video.description}</p>
                <details className="text-sm text-fg-muted">
                  <summary className="cursor-pointer font-medium text-fg">On-screen text</summary>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    {video.transcript.map((line) => <li key={line}>{line}</li>)}
                  </ol>
                </details>
                {!isDangerousUrl(video.related.href) && (
                  <a href={video.related.href} className="mt-auto font-medium text-accent underline-offset-2 hover:underline">
                    {video.related.label}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
