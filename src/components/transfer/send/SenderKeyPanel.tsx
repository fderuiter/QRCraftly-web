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

export const AUTO_HIDE_MS = 30_000;

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
 * A private transfer's key (#1144): the words and the key QR show upon click with a 30-second
 * auto-hide window, never beside the stream by default. Secrets can be manually toggled off, and
 * both close immediately when the window loses focus or the page is hidden (#1698).
 * @returns The key panel.
 */
export function SenderKeyPanel({ keyCode, showingKeyQr, keyCanvasRef, onShowKeyQr, onHideKeyQr }: SenderKeyPanelProps) {
  const [showingKeyCode, setShowingKeyCode] = React.useState(false);
  /** Whether the key QR reveal was requested, before or while the worker draws the code. */
  const [revealingKeyQr, setRevealingKeyQr] = React.useState(false);

  const showKeyQr = React.useCallback(() => {
    setRevealingKeyQr(true);
    onShowKeyQr();
  }, [onShowKeyQr]);

  const hideKeyQr = React.useCallback(() => {
    setRevealingKeyQr(false);
    onHideKeyQr();
  }, [onHideKeyQr]);

  const hideAll = React.useCallback(() => {
    setShowingKeyCode(false);
    hideKeyQr();
  }, [hideKeyQr]);

  const isKeyQrRevealed = revealingKeyQr || showingKeyQr;

  const toggleKeyCode = React.useCallback(() => {
    setShowingKeyCode((prev) => !prev);
  }, []);

  const toggleKeyQr = React.useCallback(() => {
    if (isKeyQrRevealed) {
      hideKeyQr();
    } else {
      showKeyQr();
    }
  }, [isKeyQrRevealed, hideKeyQr, showKeyQr]);

  React.useEffect(() => {
    if (!showingKeyCode) return undefined;
    const timer = setTimeout(() => {
      setShowingKeyCode(false);
    }, AUTO_HIDE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [showingKeyCode]);

  React.useEffect(() => {
    if (!isKeyQrRevealed) return undefined;
    const timer = setTimeout(() => {
      hideKeyQr();
    }, AUTO_HIDE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isKeyQrRevealed, hideKeyQr]);

  const isRevealed = showingKeyCode || isKeyQrRevealed;

  React.useEffect(() => {
    if (!isRevealed) return undefined;
    const hideWhenHidden = () => {
      if (document.visibilityState === 'hidden') hideAll();
    };
    window.addEventListener('blur', hideAll);
    document.addEventListener('visibilitychange', hideWhenHidden);
    return () => {
      window.removeEventListener('blur', hideAll);
      document.removeEventListener('visibilitychange', hideWhenHidden);
    };
  }, [isRevealed, hideAll]);

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
        Toggle a button to show the eight words to read to the receiver, or a QR code they can scan. Anyone filming this screen while the key shows can read the file, so show it only out of view of other cameras.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={toggleKeyCode}
          aria-expanded={showingKeyCode}
        >
          {showingKeyCode ? 'Hide key code' : 'Show key code'}
        </Button>
        <Button
          variant="outline"
          onClick={toggleKeyQr}
          aria-expanded={isKeyQrRevealed}
        >
          {isKeyQrRevealed ? 'Hide key QR' : 'Show key QR'}
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
