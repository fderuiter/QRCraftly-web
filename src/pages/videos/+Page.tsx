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

import { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { SITE_VIDEOS, videoSrc, type SiteVideo } from '@/data/videos';
import { isDangerousUrl } from '@/packages/core/security';

/**
 * One video. Until someone presses play it is a poster image in a button: a page of native
 * players costs a second of main-thread work for their controls and fetches every captions
 * file, so the player is only built for the video being watched (#1662). Pressing play swaps
 * in the browser's own player, which starts at once and takes the keyboard focus.
 * @param props The video, the id of its title and whether its poster is above the fold.
 * @returns The poster button, or the player once started.
 */
function VideoPlayer({ video, titleId, eager }: { video: SiteVideo; titleId: string; eager: boolean }) {
  const [started, setStarted] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  // The button that was pressed is gone, so keyboard focus moves to the player that replaced it.
  useEffect(() => {
    if (started) player.current?.focus();
  }, [started]);
  const wide = video.width > video.height;
  const box = `w-full rounded-lg bg-surface-sunken ${wide ? 'aspect-video' : 'aspect-[9/16]'}`;
  if (started) {
    return (
      <video ref={player} tabIndex={0} className={box} controls playsInline autoPlay preload="auto" poster={videoSrc(video, 'jpg')} aria-labelledby={titleId}>
        <source src={videoSrc(video, 'mp4')} type="video/mp4" />
        <track kind="captions" src={videoSrc(video, 'vtt')} srcLang="en" label="English" default />
      </video>
    );
  }
  return (
    <Button variant="ghost" size="none" className={`group relative overflow-hidden p-0 ${box}`} aria-label={`Play ${video.title}`} onClick={() => setStarted(true)}>
      <img
        src={videoSrc(video, 'jpg')}
        alt=""
        width={video.width}
        height={video.height}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
        className="size-full object-cover"
      />
      <span className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-action text-on-action shadow-lg transition-transform group-hover:scale-105">
        <Play aria-hidden="true" className="size-8 translate-x-0.5" fill="currentColor" />
      </span>
    </Button>
  );
}

/**
 * The `/videos` page: short screen recordings of the tools. The files are served from this site
 * and play in the browser's own player. Only the posters load with the page: no video or
 * captions file downloads until someone presses play, and there is no third-party player.
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
          {SITE_VIDEOS.map((video, index) => {
            const wide = video.width > video.height;
            const titleId = `${video.id}-title`;
            return (
              <li key={video.id} className={`flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-4 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
                <VideoPlayer video={video} titleId={titleId} eager={index === 0} />
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
