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

import type React from 'react';

export interface SendPreviewProps {
  canvasRef: React.Ref<HTMLCanvasElement>;
  /** Hidden until a file is chosen; the canvas stays mounted so the stream can paint on it. */
  hidden: boolean;
  /** A multi-code stream is shown: the canvas may grow taller. */
  tiled: boolean;
  /** The stream plays: a soft band sweeps it where motion is allowed. */
  playing: boolean;
}

/**
 * The transfer canvas the stream paints on, with the sweep while it plays.
 * @returns The canvas container.
 */
export function SendPreview({ canvasRef, hidden, tiled, playing }: SendPreviewProps) {
  return (
    <div className={`mb-4 flex items-center justify-center rounded-2xl border border-line-subtle bg-surface-sunken p-4 sm:p-6 ${hidden ? 'hidden' : ''}`}>
      <div className="relative w-full overflow-hidden rounded-lg">
        <canvas
          ref={canvasRef}
          className={`aspect-square w-full rounded-lg bg-surface object-contain shadow-sm ${tiled ? 'max-h-[85vh]' : 'max-h-[60vh]'}`}
          role="img"
          aria-label="Transfer QR code"
          width={512}
          height={512}
        />
        {/* A soft band sweeps the sending QR while it plays (motion-safe only). */}
        {playing && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
            <div className="h-1/3 w-full bg-linear-to-b from-transparent via-accent/20 to-transparent motion-safe:animate-scan-sweep" />
          </div>
        )}
      </div>
    </div>
  );
}
