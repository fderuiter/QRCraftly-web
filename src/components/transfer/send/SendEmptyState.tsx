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
import { EmptyState } from '@/components/ui/EmptyState';
import { QrIllustration } from '@/components/QrIllustration';

/**
 * The preview before a file is chosen: a drop target that says what the page does.
 * @returns The empty state.
 */
export function SendEmptyState({ dropProps, isDragging }: { dropProps: React.HTMLAttributes<HTMLElement>; isDragging: boolean }) {
  return (
    <div
      {...dropProps}
      data-testid="send-empty-state"
    >
      <EmptyState
        level={3}
        className={`aspect-square transition-colors ${isDragging ? 'border-accent bg-accent-soft' : ''}`}
        illustration={<QrIllustration className={`size-7 text-accent ${isDragging ? 'motion-safe:animate-pulse' : ''}`} />}
        title="Drop a file to beam it"
        body="Pick a file in step 1, or drop one here. It plays as animated QR codes for the other device's camera. Nothing is uploaded."
      />
    </div>
  );
}
