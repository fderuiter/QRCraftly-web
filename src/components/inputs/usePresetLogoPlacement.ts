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

import { useEffect } from 'react';
import type { QRType } from '@/packages/core/types';
import { useOptionalQRStore } from '../../context/QRContext';
import { useUndoToast } from '../../hooks/useUndoToast';

/**
 * The QR type the generator last showed, kept in module memory because switching type is a route
 * change that mounts a new generator. Null until the first generator mounts, so the first page
 * of a visit gets no logo.
 */
let lastType: QRType | null = null;

/** The logo this hook last placed (a preset's data URL), or null when it has placed none. */
let placedLogo: string | null = null;

/** Forgets the type and logo seen so far. Tests only. */
export function resetPresetLogoPlacement(): void {
  lastType = null;
  placedLogo = null;
}

/**
 * Places the matching preset logo when the person switches QR type (#1554). It only replaces the
 * logo this hook placed itself: an uploaded or chosen logo stays, and so does no logo at all
 * after the person removed or undid a placed one. The error-correction level is left as it is.
 * The presets load with a dynamic import, so their markup stays out of the first page load.
 * @param type - The QR type the generator shows.
 */
export function usePresetLogoPlacement(type: QRType): void {
  const store = useOptionalQRStore();
  const notifyUndo = useUndoToast();

  useEffect(() => {
    const previous = lastType;
    lastType = type;
    if (!store || previous === null || previous === type) return;

    const logoBefore = store.getState().config.logoUrl ?? null;
    if (logoBefore !== placedLogo) return;

    // Not cancelled on cleanup: under StrictMode the effect runs twice, and only the first run
    // sees the switch. The checks below drop a result that arrives after another switch or edit.
    void import('../../constants/presetLogos').then(({ presetLogoForType }) => {
      if (lastType !== type) return;
      if ((store.getState().config.logoUrl ?? null) !== logoBefore) return;
      const preset = presetLogoForType(type);
      const next = preset?.dataUrl ?? null;
      if (next === logoBefore) return;
      placedLogo = next;
      store.updateConfig({ logoUrl: next });
      notifyUndo(preset ? `${preset.label} logo added` : 'Logo removed');
    });
  }, [type, store, notifyUndo]);
}
