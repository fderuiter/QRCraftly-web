import React, { useMemo } from 'react';
import { QRConfig } from '../../types';
import { PRESET_COLORS, MIN_CONTRAST_THRESHOLD } from '../../constants';
import { getContrastRatio } from '../../utils/colorUtils';
import { ColorInput } from '../ui/ColorInput';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ContrastBadge, ContrastBanner } from './ContrastWarning';

interface ColorControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

export const ColorControls: React.FC<ColorControlsProps> = ({ config, onChange }) => {
  const isTransparent = config.bgColor === 'transparent';
  const displayBgColor = isTransparent ? '#ffffff' : config.bgColor;

  const contrastRatios = useMemo(() => {
    const bgForContrast = config.bgColor === 'transparent' ? '#ffffff' : config.bgColor;
    const fgContrast = getContrastRatio(config.fgColor, bgForContrast);
    const eyeFrameContrast = getContrastRatio(config.eyeFrameColor || config.eyeColor, bgForContrast);
    const eyeBallContrast = getContrastRatio(config.eyeBallColor || config.eyeColor, bgForContrast);
    return { fg: fgContrast, eyeFrame: eyeFrameContrast, eyeBall: eyeBallContrast };
  }, [config.fgColor, config.bgColor, config.eyeColor, config.eyeFrameColor, config.eyeBallColor]);

  const isLowContrast =
    contrastRatios.fg < MIN_CONTRAST_THRESHOLD ||
    contrastRatios.eyeFrame < MIN_CONTRAST_THRESHOLD ||
    contrastRatios.eyeBall < MIN_CONTRAST_THRESHOLD;
  const worstContrast = Math.min(contrastRatios.fg, contrastRatios.eyeFrame, contrastRatios.eyeBall);
  const selectedPreset = PRESET_COLORS.find(
    (preset) =>
      config.fgColor === preset.fg &&
      config.bgColor === preset.bg &&
      (config.eyeFrameColor || config.eyeColor) === preset.eye &&
      (config.eyeBallColor || config.eyeColor) === preset.eye
  );

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h4 className="text-sm font-semibold text-fg-soft">Colors</h4>
        <ContrastBadge isVisible={isLowContrast} contrastRatio={worstContrast} decimalPrecision={1} announce={false} />
      </div>


      <SegmentedControl<string>
        appearance="tiles"
        label="Color Presets"
        className="mb-5 grid-cols-3"
        value={selectedPreset?.label ?? ''}
        onChange={(label) => {
          const preset = PRESET_COLORS.find((p) => p.label === label);
          if (preset) {
            onChange({
              fgColor: preset.fg,
              bgColor: preset.bg,
              eyeColor: preset.eye,
              eyeFrameColor: preset.eye,
              eyeBallColor: preset.eye,
            });
          }
        }}
        options={PRESET_COLORS.map((preset) => ({
          value: preset.label,
          ariaLabel: `Select ${preset.label} theme`,
          label: (
            <>
              {/* Use SVG presentation attributes instead of inline styles for CSP compliance */}
              <svg viewBox="0 0 40 40" className="size-7 shrink-0 rounded ring-1 ring-line-strong" aria-hidden="true">
                {/* Background */}
                <rect width="40" height="40" fill={preset.bg} />
                {/* Foreground Ring (Simulating Modules) */}
                <rect x="6" y="6" width="28" height="28" rx="2" fill="none" stroke={preset.fg} strokeWidth="6" />
                {/* Eye Center */}
                <rect x="11" y="11" width="18" height="18" rx="1" fill={preset.eye} />
              </svg>
              <span className="min-w-0 leading-tight">{preset.label}</span>
            </>
          ),
        }))}
      />

      <div className="grid grid-cols-2 gap-4">
        <ColorInput
          id="fg-color"
          label="Foreground"
          value={config.fgColor}
          onChange={(val) => onChange({ fgColor: val })}
        />
        <div>
          <ColorInput
            id="bg-color"
            label="Background"
            value={displayBgColor}
            onChange={(val) => onChange({ bgColor: val })}
            disabled={isTransparent}
          />
          <label htmlFor="transparent-bg" className="mt-1 flex cursor-pointer items-center gap-2 text-xs font-medium text-fg-muted">
            <input
              id="transparent-bg"
              type="checkbox"
              checked={isTransparent}
              onChange={(e) => onChange({ bgColor: e.target.checked ? 'transparent' : '#ffffff' })}
              className="rounded border-line-strong text-accent focus:ring-focus"
            />
            <span>Transparent Background</span>
          </label>
        </div>
        <ColorInput
          id="eye-frame-color"
          label="Eye Frame"
          value={config.eyeFrameColor || config.eyeColor}
          onChange={(val) => onChange({ eyeFrameColor: val })}
        />
        <ColorInput
          id="eye-ball-color"
          label="Eye Ball"
          value={config.eyeBallColor || config.eyeColor}
          onChange={(val) => onChange({ eyeBallColor: val })}
        />
      </div>
      <ContrastBanner
        isVisible={isLowContrast}
        contrastRatio={worstContrast}
        messageType="color"
        className="mt-3"
        decimalPrecision={2}
      />
    </div>
  );
};
