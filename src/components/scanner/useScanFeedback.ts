import { useCallback, useRef, useState } from 'react';
import { playChime, unlockChime } from '@/utils/feedback';
import { triggerFileDownload } from '@/utils/downloadManager';
import type { ScanDescription } from './describeScan';
import { formatScanHistoryCsv } from './scanHistory';

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * What the scanner does for the person around a scan (#1603): the optional chime and buzz when a
 * code is found, and the CSV download of this tab's results.
 * @returns The sound switch, the found-code feedback and the history download.
 */
export function useScanFeedback() {
  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(soundOn);

  const toggleSound = useCallback(() => {
    const next = !soundOnRef.current;
    // This click is the gesture iOS needs before the chime can play later.
    if (next) unlockChime();
    soundOnRef.current = next;
    setSoundOn(next);
  }, []);

  /** Chimes when the sound is on, and buzzes unless the person prefers reduced motion. */
  const announceFound = useCallback(() => {
    if (soundOnRef.current) playChime();
    if (!prefersReducedMotion() && typeof navigator.vibrate === 'function') navigator.vibrate(30);
  }, []);

  const downloadHistory = useCallback((history: ScanDescription[]) => {
    const bytes = new TextEncoder().encode(formatScanHistoryCsv(history));
    triggerFileDownload(bytes, 'qrcraftly-scan-history.csv', 'text/csv');
  }, []);

  return { soundOn, toggleSound, announceFound, downloadHistory };
}
