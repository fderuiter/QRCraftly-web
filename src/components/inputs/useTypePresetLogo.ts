/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { useEffect, useRef } from 'react';
import type { QRType } from '@/packages/core/types';
import { useOptionalQRStore } from '@/context/QRContext';
import { useUndoToast } from '@/hooks/useUndoToast';

/**
 * Places the new type's preset logo when the person switches the QR type (#1554), and takes the
 * previous type's preset away when the new type has none. A logo the person picked, uploaded or
 * removed stays as it is, and so does the error correction level. The presets load on the first
 * switch, so their SVG marks stay out of the first-load bundle. A placed logo comes with an Undo
 * toast; undoing it stops further automatic logos.
 * @param type - The current QR type.
 */
export function useTypePresetLogo(type: QRType): void {
  const store = useOptionalQRStore();
  const notifyUndo = useUndoToast();
  const previousType = useRef<QRType | null>(null);

  useEffect(() => {
    const previous = previousType.current;
    previousType.current = type;
    // The type a route opens with is not a switch.
    if (!store || previous === null || previous === type || store.getState().logoChosen) return;
    let cancelled = false;
    void import('../../constants/presetLogos').then(({ presetLogoForType }) => {
      if (cancelled) return;
      const preset = presetLogoForType(type);
      if (store.placeTypeLogo(preset?.dataUrl ?? null) && preset) notifyUndo(`${preset.label} logo added`);
    });
    return () => {
      cancelled = true;
    };
  }, [type, store, notifyUndo]);
}
