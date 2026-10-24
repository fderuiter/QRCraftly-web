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

import React from 'react';
import { Button } from '@/components/ui/Button';

/**
 * Button handlers that show something only while the button is held, by pointer or with Space or
 * Enter, and hide it when the button is let go or loses focus.
 * @param show - Shows it.
 * @param hide - Hides it.
 * @returns Props for a `Button`.
 */
function holdToShow(show: () => void, hide: () => void) {
  return {
    onPointerDown: show,
    onPointerUp: hide,
    onPointerLeave: hide,
    onPointerCancel: hide,
    onBlur: hide,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) show();
    },
    onKeyUp: hide,
  };
}

export interface SenderKeyPanelProps {
  /** The eight words of the key code. */
  keyCode: string;
  /** Whether the key QR is drawn on `keyCanvasRef` now. */
  showingKeyQr: boolean;
  keyCanvasRef: React.Ref<HTMLCanvasElement>;
  onShowKeyQr: () => void;
  onHideKeyQr: () => void;
}

/**
 * A private transfer's key (#1144): the words and the key QR show only while their button is
 * held, never beside the stream by default.
 * @returns The key panel.
 */
export function SenderKeyPanel({ keyCode, showingKeyQr, keyCanvasRef, onShowKeyQr, onHideKeyQr }: SenderKeyPanelProps) {
  const [showingKeyCode, setShowingKeyCode] = React.useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-3" data-testid="sender-key-panel">
      <p className="font-semibold text-fg">Key code</p>
      <p className="font-mono text-sm font-semibold break-words text-fg-soft" aria-live="polite">
        {showingKeyCode ? (
          <span data-testid="sender-key-code">{keyCode}</span>
        ) : (
          <span className="font-sans font-normal text-fg-muted" data-testid="sender-key-code-hidden">
            Hidden while the stream plays.
          </span>
        )}
      </p>
      <p className="text-fg-muted">
        Hold a button to show the eight words to read to the receiver, or a QR code they can scan. Anyone filming this screen while the key shows can read the file, so show it only out of view of other cameras.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" {...holdToShow(() => setShowingKeyCode(true), () => setShowingKeyCode(false))}>
          Hold to show key code
        </Button>
        <Button variant="outline" {...holdToShow(onShowKeyQr, onHideKeyQr)}>
          Hold to show key QR
        </Button>
      </div>
      <canvas
        ref={keyCanvasRef}
        className={`mx-auto aspect-square w-48 rounded-lg bg-surface ${showingKeyQr ? '' : 'hidden'}`}
        role="img"
        aria-label="Key code QR"
        width={512}
        height={512}
      />
    </div>
  );
}
