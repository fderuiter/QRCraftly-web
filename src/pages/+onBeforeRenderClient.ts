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

import type { PageContextClient } from 'vike/types';

/** Longest wait for a frame; a hidden tab draws none, so hydration then goes ahead anyway. */
const FIRST_PAINT_WAIT_MS = 100;

/**
 * Lets the browser paint the pre-rendered page before React hydrates it (#1058). Hydration is one
 * long task; run first, it holds back the first paint of content that is already in the HTML.
 * Client-side navigation renders at once.
 * @param pageContext - The page being rendered.
 */
export default async function onBeforeRenderClient(pageContext: PageContextClient): Promise<void> {
  if (!pageContext.isHydration) return;
  await new Promise<void>((resolve) => {
    const fallback = setTimeout(resolve, FIRST_PAINT_WAIT_MS);
    // A frame's callbacks run before it is painted; a task queued from one runs after it.
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      setTimeout(resolve, 0);
    });
  });
}
