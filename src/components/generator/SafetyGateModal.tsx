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

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { FIX_LABELS } from '@/components/ScannabilityIndicator';
import type { ScanAdvice, ScanFix } from '@/packages/scannability';

export interface SafetyGateModalProps {
  open: boolean;
  /** The top problem and its one-tap fix, the same advice as the badge. */
  advice: ScanAdvice | null;
  /** Applies the advice's fix; the dialog then closes. */
  onFix: (fix: ScanFix) => void;
  onCancel: () => void;
  /** "Export anyway": closes the dialog and runs the export that was held. */
  onConfirm: () => void;
}

/** Asks before exporting a code that may not scan, and offers the advice's one-tap fix. */
export function SafetyGateModal({ open, advice, onFix, onCancel, onConfirm }: SafetyGateModalProps) {
  return (
    <Modal isOpen={open} onClose={onCancel} title="This Code May Not Scan">
      <div className="flex flex-col items-center gap-4 text-center">
        <AlertTriangle className="size-12 text-warning" aria-hidden="true" />
        <p className="text-fg-soft">
          This QR code might fail to scan in real-world conditions.{' '}
          {advice?.message ?? 'Adjust the colors, pattern or margin, then try again.'}
        </p>
        <div className="mt-4 flex w-full flex-wrap gap-3">
           {advice?.fix ? (
             <Button variant="primary" fullWidth onClick={() => {
               if (advice.fix) onFix(advice.fix);
               onCancel();
             }}>{FIX_LABELS[advice.fix]}</Button>
           ) : (
             <Button variant="primary" fullWidth onClick={onCancel}>Go back</Button>
           )}
           <Button variant="outline" fullWidth onClick={onConfirm}>Export anyway</Button>
        </div>
      </div>
    </Modal>
  );
}
