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

import { Cpu } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Development builds only: chooses a 50 MB dummy file to load-test the sender. Renders nothing in production.
 * @returns The simulate button, or null.
 */
export function DevSimulateButton({ onSimulate, disabled }: { onSimulate: () => void; disabled: boolean }) {
  if (!import.meta.env.DEV) return null;
  return (
    <Button
      variant="outline"
      onClick={onSimulate}
      disabled={disabled}
      fullWidth
    >
      <Cpu className="size-4" />
      Simulate 50MB High-Load File
    </Button>
  );
}
