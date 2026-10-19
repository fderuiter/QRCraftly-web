/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { motionAllowed } from '@/hooks/usePresence';

/** Length of the preview crossfade in ms (#1054). */
const CROSSFADE_MS = 150;
/** The ghost canvas that fades a preview's previous frame out, kept for reuse: allocating a new
 * backing store for every change costs more than the copy into it. */
const ghosts = new WeakMap<HTMLCanvasElement, { canvas: HTMLCanvasElement; animation: Animation | null }>();

/**
 * Crossfades the preview when the QR or its design changes: copies the current frame into a
 * ghost canvas laid over the preview and fades the ghost out, while the caller draws the new
 * frame on the real canvas straight away (the correct frame is never delayed). Skipped under
 * reduced motion, for the first frame, when the frame size changes and without the Web
 * Animations API. The ghost leaves the page when the fade ends, leaving today's render.
 * @param canvas - The preview canvas, before it is redrawn.
 * @returns Call it after drawing: it drops the fade when the frame size changed.
 */
export function crossfadeFrom(canvas: HTMLCanvasElement): () => void {
  const previous = ghosts.get(canvas);
  previous?.animation?.cancel();
  previous?.canvas.remove();
  const container = canvas.parentElement;
  const none = () => {};
  if (!container || canvas.width === 0 || canvas.height === 0 || !motionAllowed()) return none;
  const ghost = previous?.canvas ?? document.createElement('canvas');
  if (typeof ghost.animate !== 'function') return none;
  // Setting a size reallocates the canvas even when it is unchanged, so only a new size is set.
  if (ghost.width !== canvas.width) ghost.width = canvas.width;
  if (ghost.height !== canvas.height) ghost.height = canvas.height;
  const ctx = ghost.getContext('2d');
  if (!ctx) return none;
  try {
    ctx.clearRect(0, 0, ghost.width, ghost.height);
    ctx.drawImage(canvas, 0, 0);
  } catch {
    return none;
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.className = 'pointer-events-none absolute inset-0 size-full';
  container.appendChild(ghost);
  const entry: { canvas: HTMLCanvasElement; animation: Animation | null } = { canvas: ghost, animation: null };
  ghosts.set(canvas, entry);
  const animation = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: CROSSFADE_MS,
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
    fill: 'forwards',
  });
  entry.animation = animation;
  animation.onfinish = () => {
    ghost.remove();
    entry.animation = null;
  };
  return () => {
    if (canvas.width !== ghost.width || canvas.height !== ghost.height) {
      animation.cancel();
      ghost.remove();
    }
  };
}
