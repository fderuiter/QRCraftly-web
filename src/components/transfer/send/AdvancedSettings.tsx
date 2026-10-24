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

import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { RangeInput } from '@/components/ui/RangeInput';
import { AccordionItem } from '@/components/ui/Accordion';
import { formatDuration, type OuterCode, type TransferDensity } from '@/packages/optical-transfer';
import type { SenderFountainInfo } from '@/packages/optical-transfer/client';

export const DENSITY_OPTIONS: ReadonlyArray<{ value: TransferDensity; label: string; hint: string }> = [
  { value: 'reliable', label: 'Reliable', hint: 'Small QR codes for older phones, dim rooms or a shaky hand.' },
  { value: 'balanced', label: 'Balanced', hint: 'Medium QR codes. Works for most phones held steady.' },
  { value: 'fast', label: 'Fast', hint: 'Large QR codes. Needs a sharp camera close to a bright screen.' },
];

export interface AdvancedSettingsProps {
  /** True while a stream starts or runs: the switches cannot change. */
  locked: boolean;
  fps: number;
  setFps: (fps: number) => void;
  density: TransferDensity;
  setDensity: (density: TransferDensity) => void;
  outerCode: OuterCode;
  setOuterCode: (code: OuterCode) => void;
  multiCode: boolean;
  setMultiCode: (on: boolean) => void;
  steer: boolean;
  setSteer: (on: boolean) => void;
  walletCompat: boolean;
  setWalletCompat: (on: boolean) => void;
  isPrivate: boolean;
  /** The running stream's session, or null before one starts. */
  fountainInfo: SenderFountainInfo | null;
  /** Frames a receiver typically needs. */
  framesNeeded: number;
  /** The upper-bound estimate before a stream starts, or null without a file. */
  estimate: { frames: number; symbolSize: number } | null;
}

/**
 * The send page's Advanced settings: frame rate, density, the transfer format, several codes per
 * frame, steering and wallet-compatible mode, with what each one does now.
 * @returns The Advanced accordion.
 */
export function AdvancedSettings(props: AdvancedSettingsProps) {
  const { locked, fps, setFps, density, setDensity, outerCode, setOuterCode, multiCode, setMultiCode, steer, setSteer, walletCompat, setWalletCompat, isPrivate, fountainInfo, framesNeeded, estimate } = props;
  const activeDensityHint = DENSITY_OPTIONS.find(option => option.value === density)?.hint ?? '';
  return (
    <AccordionItem title="Advanced" headingLevel={3}>
      <div className="space-y-6">
        <RangeInput
          id="fps-slider"
          label="Transfer speed"
          min={1}
          max={60}
          step={1}
          value={fps}
          onChange={setFps}
          formatValue={(v) => `${v} frames/sec`}
        />

        <div className="space-y-2">
          <span id="density-label" className="block text-sm font-medium text-fg-soft">
            QR density
          </span>
          <SegmentedControl<TransferDensity>
            labelledBy="density-label"
            value={density}
            onChange={setDensity}
            disabled={locked}
            options={DENSITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          />
          <p className="text-xs text-fg-muted">{activeDensityHint}</p>
        </div>

        <div className="space-y-1">
          <ToggleSwitch
            id="outer-code"
            label="New transfer format (preview)"
            checked={outerCode === 'fec'}
            onChange={(checked) => setOuterCode(checked ? 'fec' : 'lt')}
            disabled={locked}
          />
          <p className="text-xs text-fg-muted" data-testid="outer-code-hint">
            {fountainInfo && outerCode === 'fec' && fountainInfo.outerCode === 'lt'
              ? 'This transfer uses the standard format: it is too large for the new one, or this browser cannot run it.'
              : 'Copes better with missed frames: the receiver needs only a few frames beyond the file’s size, where the standard format can need 15% more. The receiving device needs the latest QRCraftly.'}
          </p>
        </div>

        <div className="space-y-1">
          <ToggleSwitch
            id="multi-code"
            label="Several codes per frame (preview)"
            checked={multiCode}
            onChange={setMultiCode}
            disabled={locked}
          />
          <p className="text-xs text-fg-muted" data-testid="multi-code-hint">
            {fountainInfo && multiCode && !fountainInfo.tiles
              ? 'This screen is too small for several codes, so this transfer shows one at a time.'
              : 'Shows up to four large codes at once, timed to the display, with one bigger code every few frames for cameras that cannot read them. Turn on “Read several codes per frame” on the receiving device.'}
          </p>
        </div>

        <div className="space-y-1">
          <ToggleSwitch
            id="steer-speed"
            label="Let the receiver steer (preview)"
            checked={steer && multiCode}
            onChange={setSteer}
            disabled={locked || !multiCode}
          />
          <p className="text-xs text-fg-muted" data-testid="steer-hint">
            {multiCode
              ? 'Uses this device’s camera to read a small code on the receiving screen, so the transfer speeds up or slows down for it and stops once it has the file. The camera is asked for when you start, and nothing it sees leaves this device. Turn on “Help the sender pick its speed” on the receiving device.'
              : 'Needs “Several codes per frame”.'}
          </p>
        </div>
        <div className="space-y-1">
          <ToggleSwitch
            id="wallet-bcur"
            label="Wallet-compatible (BC-UR)"
            checked={walletCompat && !isPrivate}
            onChange={setWalletCompat}
            disabled={locked || isPrivate}
          />
          <p className="text-xs text-fg-muted" data-testid="wallet-bcur-hint">
            {isPrivate
              ? 'Not available for a private transfer: BC-UR has no encryption.'
              : 'Sends the file as a standard BC-UR animated QR (ur:bytes) that hardware wallets and other BC-UR apps can read, as well as QRCraftly. It is slower, carries only the file’s bytes, not its name, and sends one file at a time. The other options above do not apply to it.'}
          </p>
        </div>
        <p className="text-xs text-fg-muted" data-testid="fountain-symbol-info">
          {walletCompat && !isPrivate
            ? 'A wallet-compatible stream carries fewer bytes per QR than QRCraftly’s own format, so it takes longer. It repeats until you stop it.'
            : fountainInfo?.tiles
            ? `Each code carries ${fountainInfo.symbolSize}-byte pieces (${fountainInfo.compression === 'deflate-raw' ? 'compressed' : 'uncompressed'}). How fast it goes depends on the receiving camera.`
            : fountainInfo
            ? `Each QR carries ${fountainInfo.symbolSize} bytes (${fountainInfo.compression === 'deflate-raw' ? 'compressed' : 'uncompressed'}). The receiver needs about ${framesNeeded} frames, ${formatDuration(framesNeeded / fps, 'long')} at ${fps} frames/sec.`
            : estimate
              ? `Estimated transfer time: up to ${formatDuration(estimate.frames / fps, 'long')} at ${fps} frames/sec (${estimate.symbolSize} bytes per QR). Text and other compressible files go faster.`
              : 'Choose a file to see how long the transfer will take.'}
        </p>
      </div>
    </AccordionItem>
  );
}
