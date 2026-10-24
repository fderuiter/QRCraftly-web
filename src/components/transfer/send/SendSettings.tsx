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

import { Sliders } from 'lucide-react';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { TRANSFER_SPEEDS, formatFileSize, matchTransferSpeed } from '@/utils/transferSpeed';
import { formatDuration } from '@/packages/optical-transfer';
import { AdvancedSettings, type AdvancedSettingsProps } from './AdvancedSettings';

export interface SendSettingsProps extends AdvancedSettingsProps {
  setIsPrivate: (on: boolean) => void;
  /** Seconds the stream takes, or null without an estimate. */
  estimatedSeconds: number | null;
  /** How many files are chosen and their bytes, or null when nothing is. */
  selection: { count: number; size: number } | null;
}

/**
 * Step 2 of the send page: the speed presets with the time they take, the private switch and
 * the Advanced settings.
 * @returns The transfer settings section.
 */
export function SendSettings(props: SendSettingsProps) {
  const { locked, density, setDensity, fps, setFps, isPrivate, setIsPrivate, estimatedSeconds, selection } = props;
  const activeSpeed = matchTransferSpeed(density, fps);
  return (
    <section className="space-y-6">
      <SectionHeading icon={<Sliders className="size-4 text-accent" aria-hidden="true" />} eyebrow="2. Transfer Settings" />

      <div className="space-y-2">
        <span id="speed-label" className="block text-sm font-medium text-fg-soft">
          Speed
        </span>
        <SegmentedControl<string>
          labelledBy="speed-label"
          value={activeSpeed?.id ?? ''}
          onChange={(id) => {
            const speed = TRANSFER_SPEEDS.find((candidate) => candidate.id === id);
            if (!speed) return;
            setDensity(speed.density);
            setFps(speed.fps);
          }}
          disabled={locked}
          options={TRANSFER_SPEEDS.map((speed) => ({ value: speed.id, label: speed.label }))}
        />
        <p className="text-xs text-fg-muted">{activeSpeed?.hint ?? 'Custom values set under Advanced.'}</p>
        <p className="text-sm font-semibold text-fg" data-testid="speed-estimate" aria-live="polite">
          {estimatedSeconds !== null && selection
            ? `~${formatDuration(estimatedSeconds, 'short')} for ${selection.count > 1 ? `these ${selection.count} files` : 'this'} ${formatFileSize(selection.size)}${selection.count > 1 ? '' : ' file'}`
            : 'Choose a file to see how long it will take.'}
        </p>
      </div>

      <div className="space-y-1">
        <ToggleSwitch id="private-transfer" label="Private transfer" checked={isPrivate} onChange={setIsPrivate} disabled={locked} />
        <p className="text-xs text-fg-muted">
          Encrypts the file and its name. You read a key code to the receiver, who enters it before the file opens. Someone filming the stream cannot read the file without the code.
        </p>
      </div>

      <AdvancedSettings {...props} />
    </section>
  );
}
