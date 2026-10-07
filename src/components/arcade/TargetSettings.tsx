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

import React from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/TextField';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { ColorInput } from '@/components/ui/ColorInput';
import { RangeInput } from '@/components/ui/RangeInput';
import { getStyleAdaptiveMazePathWidth } from '@/packages/qr-matrix/maze';
import { ECC_LEVELS, ECC_RECOVERY, EccLevel } from '@/packages/arcade';
import type { ArcadeTarget } from '@/packages/arcade/handoff';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

const PRESETS: readonly { label: string; value: string }[] = [
  { label: 'QRCraftly', value: 'https://qrcraftly.com' },
  { label: 'Secret text', value: 'PROMO_CODE_BLASTED_SURVIVAL' },
  { label: 'Arcade mode', value: 'ARCADE_SANDBOX_STATION_ALPHA' },
  { label: 'WiFi hotspot', value: 'WIFI:S:DurabilityTest;T:WPA;P:SuperSecure123;;' },
];

/** Properties for {@link TargetSettings}. */
interface TargetSettingsProps {
  /** Target under test. */
  target: ArcadeTarget;
  /** Updates the target. */
  onChange: (updates: Partial<ArcadeTarget>) => void;
  /** Restores the generator design. */
  onResetToGenerator: () => void;
  /** Whether a generator design is available. */
  hasGeneratorDesign: boolean;
  /** Whether the fallback payload was encoded because the requested payload failed. */
  usedFallback?: boolean;
}

/**
 * Target configuration: payload, error correction tier, content presets and the
 * "Reset to Generator QR" action.
 * @param props - Panel properties.
 * @returns The panel.
 */
export function TargetSettings({ target, onChange, onResetToGenerator, hasGeneratorDesign, usedFallback }: TargetSettingsProps) {
  return (
    <Card variant="control" className="space-y-4">
      <h2 className="text-sm font-bold text-fg">Target QR</h2>
      <TextField
        id="arcade-target-payload"
        label="Target QR content"
        value={target.payload}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange({ payload: event.target.value })}
        placeholder="Enter a URL or text to test"
        autoComplete="off"
        spellCheck={false}
        error={usedFallback ? 'Payload cannot be encoded in a QR code. Showing default target.' : undefined}
      />
      {usedFallback && (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="arcade-fallback-callout"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <div>
              <p className="font-semibold">Fallback payload active</p>
              <p className="mt-0.5">
                The target payload could not be encoded. Encoding default payload <code className="font-mono font-semibold">https://qrcraftly.com</code> instead.
              </p>
            </div>
          </div>
        </div>
      )}
      <div>
        <span aria-hidden="true" className="mb-1 block text-sm font-medium text-fg-soft">
          Error correction level
        </span>
        <SegmentedControl<EccLevel>
          appearance="tiles"
          label="Error correction level"
          className="grid-cols-4"
          options={ECC_LEVELS.map((level) => ({
            value: level,
            label: level,
            ariaLabel: `Level ${level} (${Math.round(ECC_RECOVERY[level] * 100)}% recovery)`,
          }))}
          value={target.ecc}
          onChange={(ecc) => onChange({ ecc })}
        />
        <p className="mt-1 text-xs text-fg-muted">
          Level {target.ecc} recovers about {Math.round(ECC_RECOVERY[target.ecc] * 100)}% of damaged modules.
        </p>
      </div>
      <div>
        <span className="mb-1 block text-sm font-medium text-fg-soft">Content presets</span>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((preset) => (
            <Button key={preset.label} variant="outline" size="sm" pressed={target.payload === preset.value} onClick={() => onChange({ payload: preset.value })}>
              {preset.label}
            </Button>
          ))}
        </div>
      </div>
      <Button variant="secondary" fullWidth onClick={onResetToGenerator}>
        <RefreshCw className="size-4" aria-hidden="true" />
        Reset to Generator QR
      </Button>
      <p className="text-xs text-fg-muted">
        {hasGeneratorDesign
          ? 'Uses the design, colours and content from your generator session.'
          : 'No generator design in this tab yet: resets to the default high-contrast code.'}
      </p>

      {/* Maze Overlay Controls */}
      <div className="border-t border-line pt-4">
        <div className="mb-3">
          <ToggleSwitch
            id="arcade-is-maze-enabled"
            label="Playable Maze Overlay"
            checked={!!target.isMazeEnabled}
            onChange={(checked) => onChange({ isMazeEnabled: checked })}
          />
          <p className="mt-1 pl-12 text-xs text-fg-muted">
            Generates a solvable maze on empty modules and quiet zones without changing data modules.
          </p>
        </div>

        {target.isMazeEnabled && (
          <div className="space-y-4 pl-12">
            <ToggleSwitch
              id="arcade-is-maze-bridges-enabled"
              label="Finder Pattern Bridges"
              checked={target.isMazeBridgesEnabled !== false}
              onChange={(checked) => onChange({ isMazeBridgesEnabled: checked })}
            />

            <RangeInput
              id="arcade-maze-path-width"
              label="Maze Path Width"
              value={getStyleAdaptiveMazePathWidth(target.style, target.mazePathWidth)}
              min={0.10}
              max={0.50}
              step={0.01}
              formatValue={(val) => `${Math.round(val * 100)}%`}
              onChange={(val) => onChange({ mazePathWidth: val })}
            />

            <ColorInput
              id="arcade-maze-color"
              label="Maze Path Color"
              value={target.mazeColor || '#3b82f6'}
              onChange={(val) => onChange({ mazeColor: val })}
            />

            <ToggleSwitch
              id="arcade-show-maze-solution"
              label="Show Maze Solution"
              checked={!!target.showMazeSolution}
              onChange={(checked) => onChange({ showMazeSolution: checked })}
            />
          </div>
        )}
      </div>
    </Card>
  );
}
