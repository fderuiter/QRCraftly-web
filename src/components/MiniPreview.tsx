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

import React, { useEffect, useRef, useState } from 'react';

const THUMBNAIL_PX = 160;

interface MiniPreviewProps {
  /** The full-size preview canvas to mirror. */
  sourceRef: React.RefObject<HTMLCanvasElement | null>;
  /** DOM id of the preview region; the thumbnail shows while it is off screen. */
  targetId: string;
  /** Changes whenever the preview re-renders, so the thumbnail redraws. */
  renderKey: unknown;
  /** Hides the thumbnail, for example while a text field has focus, so it never covers it. */
  suppressed?: boolean;
}

/**
 * Small floating copy of the QR preview for phones (#1051). While the preview region is
 * scrolled out of view, a thumbnail sits above the sticky action bar so each style change
 * stays visible; tapping it scrolls back to the full preview. Hidden from md up, where the
 * preview column is sticky. Decorative for assistive technology: the "Preview & download"
 * link in the header is the accessible way to reach the preview.
 * @param props - Component properties.
 * @param props.sourceRef - The full-size preview canvas.
 * @param props.targetId - DOM id of the preview region.
 * @param props.renderKey - Value that changes on every preview render.
 * @param props.suppressed - Hides the thumbnail while true.
 * @returns The floating thumbnail, or nothing while the preview is in view.
 */
export function MiniPreview({ sourceRef, targetId, renderKey, suppressed = false }: MiniPreviewProps) {
  const [visible, setVisible] = useState(false);
  const thumbRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId]);

  useEffect(() => {
    if (!visible || suppressed) return;
    // Draw after the preview canvas has painted this render.
    const frame = requestAnimationFrame(() => {
      const source = sourceRef.current;
      const thumb = thumbRef.current;
      const ctx = thumb?.getContext('2d');
      if (!source || !thumb || !ctx || source.width === 0 || source.height === 0) return;
      ctx.clearRect(0, 0, thumb.width, thumb.height);
      ctx.drawImage(source, 0, 0, thumb.width, thumb.height);
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, suppressed, renderKey, sourceRef]);

  if (!visible || suppressed) return null;

  return (
    <button
      type="button"
      aria-hidden="true"
      tabIndex={-1}
      data-testid="mini-preview"
      onClick={() => {
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        document.getElementById(targetId)?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }}
      className="fixed right-4 bottom-24 z-30 size-20 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-overlay md:hidden"
    >
      <canvas ref={thumbRef} width={THUMBNAIL_PX} height={THUMBNAIL_PX} className="size-full rounded-lg" />
    </button>
  );
}
