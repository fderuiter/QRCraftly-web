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
import { Badge } from '@/components/ui/Badge';
import { LINK_ADVICE_TEXT, linkLabel, lockLevelText, type LinkState } from '@/packages/optical-modem';

/** Screen readers hear a change of advice at most this often; a change of lock is read at once. */
export const ANNOUNCE_GAP_MS = 5000;

interface OpticalLinkDisplayProps {
  /** The live link. The caller passes a fresh state about once a second. */
  state: LinkState;
}

/**
 * The receiver's live link display for the optical modem (#1165): a large lock level a person at
 * the sender can read out, the one-line link description, and what would raise it. The visible
 * text follows every update; the spoken announcement is separate, so a screen reader is not read
 * the data rate every second.
 * @param props - Component properties.
 * @param props.state - The live link.
 * @returns The display.
 */
export function OpticalLinkDisplay({ state }: OpticalLinkDisplayProps) {
  const [announcement, setAnnouncement] = useState('');
  const last = useRef<{ at: number; lock: number | null | undefined; advice: string }>({ at: 0, lock: undefined, advice: '' });
  const lock = lockLevelText(state);
  const advice = LINK_ADVICE_TEXT[state.advice];

  useEffect(() => {
    const now = Date.now();
    const seen = last.current;
    const lockChanged = seen.lock !== state.lockedProfile;
    const adviceChanged = seen.advice !== state.advice;
    if (lockChanged || (adviceChanged && now - seen.at >= ANNOUNCE_GAP_MS)) {
      last.current = { at: now, lock: state.lockedProfile, advice: state.advice };
      setAnnouncement(`${lock}. ${advice}`);
    }
  }, [state, lock, advice]);

  return (
    <section aria-label="Optical link" className="space-y-2 rounded-lg border border-line bg-surface p-4" data-testid="optical-link-display">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-3xl font-bold text-fg" data-testid="optical-lock-level">
          {lock}
        </p>
        <Badge tone="warning">Experimental</Badge>
      </div>
      <p className="text-fg" data-testid="optical-link-label">
        {linkLabel(state)}
      </p>
      <p className="text-fg-muted" data-testid="optical-link-advice">
        {advice}
      </p>
      <p role="status" className="sr-only" data-testid="optical-link-announcement">
        {announcement}
      </p>
    </section>
  );
}
