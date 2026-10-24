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
import { Play, Square, Pause } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export interface SendControlsProps {
  /** A stream plays or is paused. */
  running: boolean;
  paused: boolean;
  /** The first frame is being checked: Start waits. */
  checking: boolean;
  /** Hidden until a file is chosen; kept in the page so its place does not move. */
  hidden: boolean;
  /** The id of the photosensitivity notice while it shows, so Start points to it. */
  describedBy: string | undefined;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

/**
 * Start, or Pause, Resume and Stop while a stream runs. Escape pauses a playing stream wherever
 * focus is, so the flashing can always be stopped at once.
 * @returns The transfer buttons.
 */
export function SendControls({ running, paused, checking, hidden, describedBy, onStart, onPause, onResume, onStop }: SendControlsProps) {
  // Escape stops the flashing at once, wherever focus is.
  React.useEffect(() => {
    if (!running || paused) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onPause();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [running, paused, onPause]);

  return (
    <div className={`mb-4 flex gap-3 ${hidden ? 'hidden' : ''}`}>
      {!running ? (
        <Button
          variant="primary"
          fullWidth
          onClick={onStart}
          disabled={checking}
          aria-label="Start file transfer"
          aria-describedby={describedBy}
        >
          <Play className="size-4" aria-hidden="true" />
          {checking ? 'Checking QR…' : 'Start transfer'}
        </Button>
      ) : (
        <>
          <Button
            variant="secondary"
            fullWidth
            onClick={paused ? onResume : onPause}
            aria-keyshortcuts={paused ? undefined : 'Escape'}
          >
            {paused ? <Play className="size-4" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}
            {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="error" fullWidth onClick={onStop} aria-label="Stop file transfer">
            <Square className="size-4" aria-hidden="true" />
            Stop transfer
          </Button>
        </>
      )}
    </div>
  );
}
