/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import React, { useMemo } from 'react';
import { type QRConfig, type FrameStyle, type FramePosition, type FrameIcon, type FrameFontFamily, FRAME_FONT_FAMILIES } from '@/packages/core/types';
import { SelectField, TextField } from '../ui/FormFields';
import { ColorInput } from '../ui/ColorInput';
import { getContrastRatio } from '@/packages/core/encoding';
import { MIN_CONTRAST_THRESHOLD } from '../../constants';
import { ContrastBadge } from './ContrastWarning';

const FRAME_FONT_OPTIONS: ReadonlyArray<{ value: FrameFontFamily; label: string }> = [
  { value: 'sans-serif', label: 'Sans Serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'display', label: 'Display' },
  { value: 'cursive', label: 'Cursive' },
] as const;

interface FrameControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

export const FrameControls: React.FC<FrameControlsProps> = ({ config, onChange }) => {
  const frameStyle: FrameStyle = config.frameStyle || 'none';
  const isEnabled = frameStyle !== 'none';

  const contrastRatio = useMemo(() => {
    if (!isEnabled || !config.frameText) return 21;
    const fg = config.frameTextColor || '#ffffff';
    const bg = config.frameBgColor || '#000000';
    return getContrastRatio(fg, bg);
  }, [isEnabled, config.frameText, config.frameTextColor, config.frameBgColor]);

  const isLowContrast = contrastRatio < MIN_CONTRAST_THRESHOLD;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-fg-soft">Frame & CTA Badge</h4>
        <ContrastBadge isVisible={isEnabled && isLowContrast} contrastRatio={contrastRatio} decimalPrecision={1} />
      </div>

      <div className="space-y-4">
        {/* Frame Style Selector */}
        <SelectField
          id="frame-style"
          label="Frame Shape"
          value={frameStyle}
          onChange={(e) => onChange({ frameStyle: e.target.value as FrameStyle })}
        >
          <option value="none">None</option>
          <option value="pill">Pill Badge</option>
          <option value="banner">Banner Bar</option>
          <option value="speech-bubble">Speech Bubble</option>
          <option value="card">Full Card</option>
        </SelectField>

        {isEnabled && (
          <>
            {/* Position and Icon Row */}
            <div className="grid grid-cols-2 gap-4">
              <SelectField
                id="frame-position"
                label="Position"
                value={config.framePosition || 'bottom'}
                onChange={(e) => onChange({ framePosition: e.target.value as FramePosition })}
              >
                <option value="bottom">Bottom</option>
                <option value="top">Top</option>
                <option value="left">Left</option>
                <option value="right">Right</option>
              </SelectField>

              <SelectField
                id="frame-icon"
                label="Badge Icon"
                value={config.frameIcon || 'none'}
                onChange={(e) => onChange({ frameIcon: e.target.value as FrameIcon })}
              >
                <option value="none">None</option>
                <option value="scan">QR Scan</option>
                <option value="camera">Camera</option>
                <option value="star">Star</option>
                <option value="heart">Heart</option>
                <option value="info">Info</option>
                <option value="phone">Phone</option>
              </SelectField>
            </div>

            {/* CTA Text Input */}
            <TextField
              id="frame-text"
              label="Call to Action Text"
              placeholder="SCAN ME"
              value={config.frameText || ''}
              onChange={(e) => onChange({ frameText: e.target.value })}
            />

            {/* Typography Selector */}
            <div>
              <SelectField
                id="frame-font-family"
                label="Badge Font"
                aria-describedby="frame-font-family-hint"
                value={config.frameFontFamily || 'sans-serif'}
                onChange={(e) => {
                  const family = FRAME_FONT_FAMILIES.find((f) => f === e.target.value);
                  if (family) onChange({ frameFontFamily: family });
                }}
              >
                {FRAME_FONT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </SelectField>
              <p id="frame-font-family-hint" className="mt-1 text-xs text-fg-muted">
                PDF and EPS exports always use Helvetica.
              </p>
            </div>

            {/* Color Inputs */}
            <div className="grid grid-cols-2 gap-4 pt-1">
              <ColorInput
                id="frame-bg-color"
                label="Frame Background"
                value={config.frameBgColor || '#000000'}
                onChange={(val) => onChange({ frameBgColor: val })}
              />

              <ColorInput
                id="frame-text-color"
                label="Text & Icon Color"
                value={config.frameTextColor || '#ffffff'}
                onChange={(val) => onChange({ frameTextColor: val })}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
};
