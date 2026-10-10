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

import { useCallback, useState } from 'react';
import { useOptionalQRStoreSelector } from '@/context/QRContext';
import { type ArcadeTarget, getStagedArcadeTarget } from '@/packages/arcade/handoff';
import { DEFAULT_ARCADE_TARGET, targetFromConfig } from './target';

/** Target state for the arcade. */
export interface ArcadeTargetState {
  /** The target currently under test (a local copy the player may edit). */
  target: ArcadeTarget;
  /** Replaces fields of the local copy. */
  updateTarget: (updates: Partial<ArcadeTarget>) => void;
  /** Restores the generator design (or the defaults when there is none). */
  resetToGenerator: () => void;
  /** Whether a generator design is available in this tab. */
  hasGeneratorDesign: boolean;
}

/**
 * Resolves the generator design: the nearest `QRContext` store when the arcade is rendered
 * inside a generator provider, otherwise the design staged in memory by "Stress Test in Arcade".
 * @returns Local target state plus the generator reset action.
 */
export function useArcadeTarget(): ArcadeTargetState {
  const storeConfig = useOptionalQRStoreSelector((state) => state.config);
  const readGenerator = useCallback(
    (): ArcadeTarget | null => (storeConfig ? targetFromConfig(storeConfig) : getStagedArcadeTarget()),
    [storeConfig]
  );
  const [target, setTarget] = useState<ArcadeTarget>(() => readGenerator() ?? DEFAULT_ARCADE_TARGET);

  const updateTarget = useCallback((updates: Partial<ArcadeTarget>) => {
    setTarget((current) => ({ ...current, ...updates }));
  }, []);

  const resetToGenerator = useCallback(() => {
    setTarget(readGenerator() ?? DEFAULT_ARCADE_TARGET);
  }, [readGenerator]);

  return { target, updateTarget, resetToGenerator, hasGeneratorDesign: readGenerator() !== null };
}
