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

import { useCallback, useEffect, useRef, useState } from 'react';
import { type DamageAnalysis, healthTone } from '@/packages/arcade';
import type { EmpiricalState } from '@/packages/arcade/client';
import { FAILURE_TITLES } from './ScanHud';

/** Sends a polite screen-reader announcement. */
export type Announce = (message: string) => void;

/**
 * Announces meaningful status changes (health band, defeat, scanner verdict) and manages the
 * defeat dialog: it opens when the code is first defeated, can be dismissed to inspect the
 * damage, and re-arms after a rebuild.
 * @param analysis - Layer 1 analysis.
 * @param empirical - Layer 2 verdict.
 * @param announce - Announcement sink.
 * @returns Defeat dialog state.
 */
export function useArcadeStatus(analysis: DamageAnalysis, empirical: EmpiricalState, announce: Announce) {
  const tone = healthTone(analysis.healthPercent);
  const previousTone = useRef(tone);
  const previousFailure = useRef(analysis.failure);
  const previousScan = useRef(empirical.status);
  const [defeatOpen, setDefeatOpen] = useState(false);

  useEffect(() => {
    if (analysis.failure && !previousFailure.current) {
      announce(`QR code defeated: ${FAILURE_TITLES[analysis.failure]}.`);
      setDefeatOpen(true);
    } else if (!analysis.failure && tone !== previousTone.current) {
      announce(`Error correction health ${tone === 'healthy' ? 'restored' : tone}: ${analysis.healthPercent}% remaining.`);
    }
    if (!analysis.failure) setDefeatOpen(false);
    previousFailure.current = analysis.failure;
    previousTone.current = tone;
  }, [analysis.failure, analysis.healthPercent, announce, tone]);

  useEffect(() => {
    if (empirical.status === previousScan.current) return;
    previousScan.current = empirical.status;
    if (empirical.status === 'scannable') announce('Live scanner: scannable.');
    else if (empirical.status === 'corrupted') announce('Live scanner: corrupted, no data decoded.');
  }, [announce, empirical.status]);

  const closeDefeat = useCallback(() => setDefeatOpen(false), []);
  return { defeatOpen, closeDefeat };
}
