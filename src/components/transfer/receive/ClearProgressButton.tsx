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

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';

/**
 * Clears what the receiver has so far.
 * @returns The icon button with its tooltip.
 */
export function ClearProgressButton({ onClear }: { onClear: () => void }) {
  return (
    <Tooltip content="Clear transfer progress">
      <Button variant="outline" iconOnly onClick={onClear} aria-label="Clear transfer progress">
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </Tooltip>
  );
}
