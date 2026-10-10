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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { ARCADE_MODES, ArcadeMode, arcadeModeHref, blankTargetMatrix, buildTargetMatrix, parseArcadeMode } from '@/packages/arcade';
import { BlasterMode } from './BlasterMode';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { SimulatorMode } from './SimulatorMode';
import { TargetSettings } from './TargetSettings';
import { useArcadeTarget } from './useArcadeTarget';
import { useQrEncoder } from '@/hooks/useQrEncoder';

const PANEL_ID = 'arcade-mode-panel';
const tabId = (mode: ArcadeMode) => `arcade-tab-${mode}`;

/**
 * Keeps the mode in sync with `?mode=`: read after hydration (the prerendered page has no
 * query), written with `history.replaceState` so switching never reloads the page.
 * @returns The mode and its setter.
 */
function useModeParam(): [ArcadeMode, (mode: ArcadeMode) => void] {
  const [mode, setModeState] = useState<ArcadeMode>('blaster');

  useEffect(() => {
    setModeState(parseArcadeMode(window.location.search));
    const onPopState = () => setModeState(parseArcadeMode(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setMode = useCallback((next: ArcadeMode) => {
    setModeState(next);
    const href = arcadeModeHref(next);
    if (window.location.pathname + window.location.search !== href) {
      window.history.replaceState(window.history.state, '', href);
    }
  }, []);

  return [mode, setMode];
}

const ignore = () => {};

/**
 * The QR Arcade & Durability Lab: mode switcher, shared target state and the active mode.
 * @returns The arcade.
 */
export function ArcadeApp() {
  const [mode, setMode] = useModeParam();
  const { target, updateTarget, resetToGenerator, hasGeneratorDesign } = useArcadeTarget();
  const encoder = useQrEncoder();
  const [announcement, setAnnouncement] = useState('');
  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const changeMode = (next: ArcadeMode) => {
    setMode(next);
    const meta = ARCADE_MODES.find((m) => m.id === next);
    if (meta) announce(`${meta.label} mode.`);
  };

  const matrix = useMemo(
    () => (encoder ? buildTargetMatrix(target.payload, target.ecc, encoder) : blankTargetMatrix(target.payload, target.ecc)),
    [target.payload, target.ecc, encoder]
  );

  const settings = (
    <TargetSettings
      target={target}
      onChange={updateTarget}
      onResetToGenerator={() => {
        resetToGenerator();
        announce('Target reset to the generator QR.');
      }}
      hasGeneratorDesign={hasGeneratorDesign}
      usedFallback={matrix.usedFallback}
    />
  );

  const activeMode = ARCADE_MODES.find((m) => m.id === mode) ?? ARCADE_MODES[0];

  return (
    <div className="mx-auto w-full max-w-360 px-4 py-6 sm:px-6 lg:py-8">
      <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-action text-on-action" aria-hidden="true">
            <Gamepad2 className="size-7" />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-fg sm:text-3xl">QR Arcade &amp; Durability Lab</h1>
            <p className="mt-1 text-sm text-fg-muted sm:text-base">
              Blast your QR design and watch Reed-Solomon error correction and a real scanner decide whether it survives.
            </p>
          </div>
        </div>
        <SegmentedControl<ArcadeMode>
          kind="tablist"
          label="Arcade mode"
          className="lg:w-auto"
          options={ARCADE_MODES.map((m) => ({ value: m.id, label: m.label }))}
          value={mode}
          onChange={changeMode}
          tabId={tabId}
          controls={() => PANEL_ID}
        />
      </header>

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(mode)}>
        <p className="sr-only">{activeMode.description}</p>
        {/* Until the encoder loads, the mode shows a blank board so the page keeps its layout; it is
            inert and silent until the real target is built, which re-scans it. */}
        <div inert={!encoder} aria-busy={!encoder} data-testid={encoder ? undefined : 'arcade-loading'}>
          {mode === 'blaster' ? (
            <BlasterMode target={target} encoder={encoder} settings={settings} announce={encoder ? announce : ignore} />
          ) : (
            <SimulatorMode target={target} encoder={encoder} settings={settings} announce={encoder ? announce : ignore} />
          )}
        </div>
      </div>

      <div role="status" aria-live="polite" className="sr-only" data-testid="arcade-announcer">
        {announcement}
      </div>
    </div>
  );
}
