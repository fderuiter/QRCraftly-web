import React, { useMemo } from 'react';
import type { GradientType, QRConfig } from '../../types';
import { PRESET_COLORS, MIN_CONTRAST_THRESHOLD, buildPresetColorPatch, DEFAULT_GRADIENT_END_COLOR } from '../../constants';
import { getContrastRatio, calculateAutoFixColorPatch } from '../../utils/colorUtils';
import { announcePolitely } from '../../utils/a11y';
import { ColorInput } from '../ui/ColorInput';
import { RangeInput } from '../ui/RangeInput';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { ContrastBadge, ContrastBanner } from './ContrastWarning';

interface ColorControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

/** The background colour, with a switch for a transparent background. */
const BackgroundColorField: React.FC<ColorControlsProps> = ({ config, onChange }) => {
  const isTransparent = config.bgColor === 'transparent';
  return (
    <div className="space-y-2">
      <ColorInput
        id="bg-color"
        label="Background"
        value={isTransparent ? '#ffffff' : config.bgColor}
        onChange={(val) => onChange({ bgColor: val })}
        disabled={isTransparent}
      />
      <ToggleSwitch
        id="transparent-bg"
        label="Transparent Background"
        checked={isTransparent}
        onChange={(checked) => onChange({ bgColor: checked ? 'transparent' : '#ffffff' })}
        labelClassName="text-xs font-medium text-fg-muted"
      />
    </div>
  );
};

const PRESET_OPTIONS = PRESET_COLORS.map((preset) => ({
  value: preset.label,
  ariaLabel: `Select ${preset.label} theme`,
  label: (
    <>
      <svg viewBox="0 0 40 40" className="size-7 shrink-0 rounded ring-1 ring-line-strong" aria-hidden="true">
        <rect width="40" height="40" fill={preset.bg} />
        <rect x="6" y="6" width="28" height="28" rx="2" fill="none" stroke={preset.fg} strokeWidth="6" />
        <rect x="11" y="11" width="18" height="18" rx="1" fill={preset.eye} />
      </svg>
      <span className="min-w-0 leading-tight">{preset.label}</span>
    </>
  ),
}));

const FILL_MODE_OPTIONS: Array<{ value: GradientType; label: string }> = [
  { value: 'none', label: 'Solid' },
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
];

export const ColorControls: React.FC<ColorControlsProps> = ({ config, onChange }) => {

  const activeGradientType: GradientType = config.gradientType || 'none';
  const colorStops = (config.gradientColorStops && config.gradientColorStops.length > 0)
    ? config.gradientColorStops
    : [
        { offset: 0, color: config.fgColor || '#000000' },
        { offset: 1, color: DEFAULT_GRADIENT_END_COLOR },
      ];

  const stop0Color = colorStops[0]?.color ?? config.fgColor;
  const stop1Color = colorStops[colorStops.length - 1]?.color ?? DEFAULT_GRADIENT_END_COLOR;
  const stopColors = colorStops.map((stop) => stop.color).join(',');

  const contrastRatios = useMemo(() => {
    const bgForContrast = config.bgColor === 'transparent' ? '#ffffff' : config.bgColor;
    // A gradient is only as scannable as its weakest stop, so every stop is checked (an imported style can have more than two).
    const moduleColors = activeGradientType !== 'none' ? stopColors.split(',') : [config.fgColor];
    const fgContrast = Math.min(...moduleColors.map((color) => getContrastRatio(color, bgForContrast)));
    const eyeFrameContrast = getContrastRatio(config.eyeFrameColor || config.eyeColor, bgForContrast);
    const eyeBallContrast = getContrastRatio(config.eyeBallColor || config.eyeColor, bgForContrast);
    return { fg: fgContrast, eyeFrame: eyeFrameContrast, eyeBall: eyeBallContrast };
  }, [activeGradientType, stopColors, config.fgColor, config.bgColor, config.eyeColor, config.eyeFrameColor, config.eyeBallColor]);

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
              ...buildPresetColorPatch(preset, config),
              gradientType: 'none',
            });
          }
        }}
        options={PRESET_OPTIONS}
      />

      <div className="mb-4">
        <span className="mb-1.5 block text-xs font-medium text-fg-muted">
          Fill Mode
        </span>
        <SegmentedControl<GradientType>
          appearance="track"
          label="Fill Mode"
          value={activeGradientType}
          onChange={(type) => {
            if (type === 'none') {
              onChange({ gradientType: 'none' });
            } else {
              const updatedStops = [
                { offset: 0, color: config.fgColor },
                { offset: 1, color: stop1Color },
              ];
              onChange({
                gradientType: type,
                gradientColorStops: updatedStops,
                gradientAngle: config.gradientAngle ?? 0,
              });
            }
          }}
          options={FILL_MODE_OPTIONS}
        />
      </div>

      {activeGradientType === 'none' ? (
        <div className="grid grid-cols-2 gap-4">
          <ColorInput
            id="fg-color"
            label="Foreground"
            value={config.fgColor}
            onChange={(val) => onChange({ fgColor: val })}
          />
          <BackgroundColorField config={config} onChange={onChange} />
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
      ) : (
        <div className="grid grid-cols-2 gap-4">
          <ColorInput
            id="gradient-start-color"
            label="Start Color"
            value={stop0Color}
            onChange={(val) => {
              const newStops = [
                { offset: 0, color: val },
                { offset: 1, color: stop1Color },
              ];
              onChange({ fgColor: val, gradientColorStops: newStops });
            }}
          />
          <ColorInput
            id="gradient-end-color"
            label="End Color"
            value={stop1Color}
            onChange={(val) => {
              const newStops = [
                { offset: 0, color: stop0Color },
                { offset: 1, color: val },
              ];
              onChange({ gradientColorStops: newStops });
            }}
          />
          {activeGradientType === 'linear' && (
            <div className="col-span-2">
              <RangeInput
                id="gradient-angle"
                label="Gradient Angle"
                value={config.gradientAngle ?? 0}
                min={0}
                max={360}
                step={15}
                formatValue={(val) => `${val}°`}
                onChange={(val) => onChange({ gradientAngle: val })}
              />
            </div>
          )}
          <BackgroundColorField config={config} onChange={onChange} />
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
      )}

      <ContrastBanner
        isVisible={isLowContrast}
        contrastRatio={worstContrast}
        messageType="color"
        className="mt-3"
        decimalPrecision={2}
        onAutoFix={() => {
          onChange(calculateAutoFixColorPatch(config));
          announcePolitely('Contrast adjusted to meet WCAG standards');
          requestAnimationFrame(() => {
            (document.getElementById('fg-color') || document.getElementById('gradient-start-color') || document.getElementById('bg-color'))?.focus();
          });
        }}
      />
    </div>
  );
};
