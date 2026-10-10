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
import { RotateCcw } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { DamageAnalysis } from '@/packages/arcade';
import { FAILURE_TITLES, describeFailure } from './ScanHud';

/** Properties for {@link DefeatModal}. */
interface DefeatModalProps {
  /** Whether the dialog is shown. */
  isOpen: boolean;
  /** The analysis that failed. */
  analysis: DamageAnalysis;
  /** Rebuilds the QR code. */
  onRebuild: () => void;
  /** Closes the dialog and keeps the damaged board for inspection. */
  onClose: () => void;
}

/**
 * Game-over dialog explaining why the QR code can no longer be decoded (finder failure,
 * local block overflow or global budget exhaustion) with a rebuild action.
 * @param props - Dialog properties.
 * @returns The dialog, or null when closed or not defeated.
 */
export function DefeatModal({ isOpen, analysis, onRebuild, onClose }: DefeatModalProps) {
  const failure = analysis.failure;
  if (!failure) return null;
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`QR code defeated: ${FAILURE_TITLES[failure]}`}>
      <p className="text-sm leading-relaxed text-fg-soft" data-testid="arcade-defeat-diagnostic">
        {describeFailure(failure, analysis)}
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button variant="primary" onClick={onRebuild}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Rebuild / Try Again
        </Button>
        <Button variant="outline" onClick={onClose}>
          Inspect damage
        </Button>
      </div>
    </Modal>
  );
}
