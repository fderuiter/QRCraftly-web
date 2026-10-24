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

import { Camera, Upload } from 'lucide-react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

/**
 * Chooses whether the receiver reads the camera or an uploaded video.
 * @returns The mode switch.
 */
export function ReceiveModeSwitch({ mode, onChange }: { mode: 'camera' | 'file'; onChange: (mode: 'camera' | 'file') => void }) {
  return (
    <SegmentedControl<'camera' | 'file'>
      label="Receiver Input Mode"
      value={mode}
      onChange={onChange}
      options={[
        {
          value: 'camera',
          label: (
            <>
              <Camera className="size-4" aria-hidden="true" />
              Camera Feed
            </>
          ),
        },
        {
          value: 'file',
          label: (
            <>
              <Upload className="size-4" aria-hidden="true" />
              Video File
            </>
          ),
        },
      ]}
    />
  );
}
