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
import type { SenderPhase } from '@/packages/optical-transfer';
import { PAUSE_HINT } from '@/utils/photosensitivity';
import { AutoStoppedAlert } from './SendAlerts';

/**
 * What each phase shows around the pairing guide: a notice above it and an alert below it.
 * @param phase - Where the transfer stands.
 * @param confirm - The reduced-motion confirm, shown while it is asked.
 * @returns The notice and the alert, either of which may be null.
 */
export function phaseSections(phase: SenderPhase, confirm: React.ReactNode): { notice: React.ReactNode; alert: React.ReactNode } {
  switch (phase) {
    case 'confirmingMotion':
      return { notice: confirm, alert: null };
    case 'transmitting':
    case 'paused':
      return {
        notice: (
          <p className="mb-4 text-xs text-fg-muted" data-testid="pause-hint">
            {PAUSE_HINT}
          </p>
        ),
        alert: null,
      };
    case 'autoStopped':
      return { notice: null, alert: <AutoStoppedAlert /> };
    case 'idle':
    case 'ready':
    case 'verifying':
    case 'failed':
      return { notice: null, alert: null };
    default: {
      const unknown: never = phase;
      return unknown;
    }
  }
}
