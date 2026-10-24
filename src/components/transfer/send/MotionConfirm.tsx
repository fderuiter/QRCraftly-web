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
import { REDUCED_MOTION_CONFIRM_BODY, REDUCED_MOTION_CONFIRM_TITLE } from '@/utils/photosensitivity';

export interface MotionConfirmProps {
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Under reduced motion, asks once more before the stream flashes (#1148). It opens under the Start
 * button and takes focus, so keyboard users land on the choice.
 * @returns The confirm group.
 */
export function MotionConfirm({ onConfirm, onCancel }: MotionConfirmProps) {
  const confirmButtonRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    confirmButtonRef.current?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-labelledby="motion-confirm-title"
      className="mb-4 rounded-xl border border-warning-line bg-warning-soft p-3 text-sm text-warning"
      data-testid="reduced-motion-confirm"
    >
      <p id="motion-confirm-title" className="font-semibold">
        {REDUCED_MOTION_CONFIRM_TITLE}
      </p>
      <p className="mt-1">{REDUCED_MOTION_CONFIRM_BODY}</p>
      <div className="mt-3 flex gap-3">
        <Button ref={confirmButtonRef} variant="primary" size="sm" onClick={onConfirm}>
          Start anyway
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
