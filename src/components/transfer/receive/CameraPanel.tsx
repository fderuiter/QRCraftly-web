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

import { Play, Square } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ClearProgressButton } from './ClearProgressButton';

export interface CameraPanelProps {
  scanning: boolean;
  /** Something was received or loaded, so Clear is offered. */
  canClear: boolean;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
}

/**
 * Camera mode's controls: activate or deactivate the scanner, and clear.
 * @returns The control row.
 */
export function CameraPanel({ scanning, canClear, onStart, onStop, onClear }: CameraPanelProps) {
  return (
    <div className="flex gap-3">
      {!scanning ? (
        <Button
          variant="primary"
          fullWidth
          onClick={onStart}
          aria-label="Activate camera scanner"
        >
          <Play className="size-4" />
          Activate Camera Scanner
        </Button>
      ) : (
        <Button
          variant="error"
          fullWidth
          onClick={onStop}
          aria-label="Deactivate camera scanner"
        >
          <Square className="size-4" />
          Deactivate Scanner
        </Button>
      )}
      {canClear && <ClearProgressButton onClear={onClear} />}
    </div>
  );
}
