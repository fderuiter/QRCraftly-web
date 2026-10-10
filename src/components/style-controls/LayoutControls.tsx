/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
import { SegmentedControl } from '../ui/SegmentedControl';
import { Square, Smartphone } from 'lucide-react';
import { type QRConfig, SocialFormat, TemplateStyle } from '../../types';
import { ColorInput } from '../ui/ColorInput';
import { RangeInput } from '../ui/RangeInput';
import { TextField } from '../ui/FormFields';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { getContrastRatio } from '../../utils/colorUtils';
import { MIN_CONTRAST_THRESHOLD } from '../../constants';
import { ContrastBadge, ContrastBanner } from './ContrastWarning';

interface LayoutControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

const FORMAT_OPTIONS: Array<{ id: SocialFormat; label: string; sublabel: string; icon: React.ReactNode }> = [
  {
    id: SocialFormat.SQUARE_1_1,
    label: 'Square',
    sublabel: '1:1',
    icon: <Square className="size-4" aria-hidden="true" />,
  },
  {
    id: SocialFormat.PORTRAIT_4_5,
    label: 'Portrait',
    sublabel: '4:5',
    icon: (
      <svg viewBox="0 0 12 15" className="h-5 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="1" y="1" width="10" height="13" rx="1" />
      </svg>
    ),
  },
  {
    id: SocialFormat.STORY_9_16,
    label: 'Story',
    sublabel: '9:16',
    icon: <Smartphone className="h-5 w-4" aria-hidden="true" />,
  },
];

const TEMPLATE_OPTIONS: Array<{ id: TemplateStyle; label: string }> = [
  { id: TemplateStyle.NONE, label: 'None' },
  { id: TemplateStyle.MINIMALIST, label: 'Minimalist' },
  { id: TemplateStyle.GRADIENT_BLUR, label: 'Gradient' },
  { id: TemplateStyle.SOLID_FRAME, label: 'Solid Frame' },
];

/**
 * Controls for choosing the social-media export aspect ratio and template
 * style applied to the QR code canvas.
 */
export const LayoutControls: React.FC<LayoutControlsProps> = ({ config, onChange }) => {
  const showTextInputs = config.templateStyle !== TemplateStyle.NONE;
  const showAdvanced = config.templateStyle !== TemplateStyle.NONE;

  // Whether custom (decoupled) background / text colors are active
  const hasBgOverride = config.templateBgColor !== undefined;
  const hasTextOverride = config.templateTextColor !== undefined;

  // Resolved colors & contrast
  const activeBg = config.templateBgColor ?? (config.bgColor === 'transparent' ? '#ffffff' : config.bgColor);
  const activeText = config.templateTextColor ?? config.fgColor;
  const contrastRatio = getContrastRatio(activeText, activeBg);
  const isLowContrast = showAdvanced && contrastRatio < MIN_CONTRAST_THRESHOLD;

  return (
    <section>
      <h4 className="mb-4 text-sm font-semibold text-fg-soft">Export Layout</h4>

      {/* Aspect Ratio Selector */}
      <div className="mb-4">
        <p id="aspect-ratio-label" className="mb-2 text-sm font-medium text-fg-muted">Aspect Ratio</p>
        <SegmentedControl<SocialFormat>
          appearance="tiles"
          labelledBy="aspect-ratio-label"
          className="grid-cols-3"
          value={config.socialFormat}
          onChange={(socialFormat) => onChange({ socialFormat })}
          options={FORMAT_OPTIONS.map((opt) => ({
            value: opt.id,
            ariaLabel: `Select ${opt.label} format (${opt.sublabel})`,
            label: (
              <>
                {opt.icon}
                <span className="leading-none">{opt.label}</span>
                <span className="text-xs leading-none font-normal">{opt.sublabel}</span>
              </>
            ),
          }))}
        />
      </div>

      {/* Template Style Selector */}
      <div>
        <p id="template-style-label" className="mb-2 text-sm font-medium text-fg-muted">Template</p>
        <SegmentedControl<TemplateStyle>
          appearance="tiles"
          labelledBy="template-style-label"
          className="grid-cols-2"
          value={config.templateStyle}
          onChange={(templateStyle) => onChange({ templateStyle })}
          options={TEMPLATE_OPTIONS.map((opt) => ({
            value: opt.id,
            ariaLabel: `Select ${opt.label} template`,
            label: opt.label,
          }))}
        />
      </div>

      {/* Text Inputs (visible only when a template is active) */}
      {showTextInputs && (
        <div className="mt-4 space-y-2">
          <TextField
            placeholder="Headline (e.g. Scan Me!)"
            value={config.templateHeadline ?? ''}
            onChange={(e) => onChange({ templateHeadline: e.target.value })}
            aria-label="Template headline"
          />
          <TextField
            placeholder="Subtext (e.g. @yourhandle)"
            value={config.templateSubtext ?? ''}
            onChange={(e) => onChange({ templateSubtext: e.target.value })}
            aria-label="Template subtext"
          />
        </div>
      )}

      {/* Advanced Template Settings (visible only when a template is active) */}
      {showAdvanced && (
        <div className="mt-4 space-y-4 border-t border-line pt-4">
          <p className="text-xs font-semibold text-fg-muted">Advanced Settings</p>

          {/* Template Background Color */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-muted">Template Background</span>
                <ContrastBadge isVisible={isLowContrast} contrastRatio={contrastRatio} decimalPrecision={1} announce={false} data-testid="layout-bg-warning" />
              </div>
              <ToggleSwitch
                id="override-bg-color"
                checked={hasBgOverride}
                onChange={(checked) =>
                  onChange({
                    templateBgColor: checked ? config.bgColor : undefined,
                  })
                }
                aria-label={hasBgOverride ? 'Override template background color - Custom' : 'Override template background color - Inherit'}
                label={hasBgOverride ? 'Custom' : 'Inherit'}
                labelClassName="text-xs text-fg-muted"
              />
            </div>
            {hasBgOverride && (
              <ColorInput
                id="templateBgColor"
                label="Template Background Color"
                hideLabel={true}
                value={config.templateBgColor!}
                onChange={(val) => onChange({ templateBgColor: val })}
              />
            )}
          </div>

          {/* Template Text / Accent Color */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-muted">Template Text Color</span>
                <ContrastBadge isVisible={isLowContrast} contrastRatio={contrastRatio} decimalPrecision={1} announce={false} data-testid="layout-text-warning" />
              </div>
              <ToggleSwitch
                id="override-text-color"
                checked={hasTextOverride}
                onChange={(checked) =>
                  onChange({
                    templateTextColor: checked ? config.fgColor : undefined,
                  })
                }
                aria-label={hasTextOverride ? 'Override template text color - Custom' : 'Override template text color - Inherit'}
                label={hasTextOverride ? 'Custom' : 'Inherit'}
                labelClassName="text-xs text-fg-muted"
              />
            </div>
            {hasTextOverride && (
              <ColorInput
                id="templateTextColor"
                label="Template Text Color"
                hideLabel={true}
                value={config.templateTextColor!}
                onChange={(val) => onChange({ templateTextColor: val })}
              />
            )}
          </div>

          {/* QR Scale */}
          <RangeInput
            id="templateQrScale"
            label="QR Scale"
            value={config.templateQrScale ?? 1.0}
            onChange={(val) => onChange({ templateQrScale: val })}
            min={0.5}
            max={1.5}
            step={0.05}
            formatValue={(val) => `${Math.round(val * 100)}%`}
          />

          {/* Amber Alert Card detailing the legibility risk when template contrast is insufficient */}
          <ContrastBanner
            isVisible={isLowContrast}
            contrastRatio={contrastRatio}
            messageType="layout"
            className="mt-4"
            decimalPrecision={2}
          />
        </div>
      )}
    </section>
  );
};
