import React from 'react';
import type { EyeOverride, EyePosition, QRConfig, QRStyle, EyeShape } from '../../types';
import { EYE_POSITIONS } from '../../types';
import { PATTERNS, EYE_SHAPES, LOW_RELIABILITY_PATTERNS } from '../../constants';
import { PatternModule } from '../ui/PatternModule';
import { Alert } from '../ui/Alert';
import { SegmentedControl } from '../ui/SegmentedControl';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { ColorInput } from '../ui/ColorInput';

interface PatternControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

const EYE_LABELS: Record<EyePosition, string> = {
  'top-left': 'Top-Left Eye',
  'top-right': 'Top-Right Eye',
  'bottom-left': 'Bottom-Left Eye',
};

export const PatternControls: React.FC<PatternControlsProps> = ({ config, onChange }) => {
  const isLowReliability = LOW_RELIABILITY_PATTERNS.includes(config.style);
  const isCustomEyesEnabled = Boolean(config.eyeOverrides);

  const handleEyeOverrideChange = (pos: EyePosition, updates: Partial<EyeOverride>) => {
    const currentOverrides = config.eyeOverrides ?? {};
    const currentPosOverride = currentOverrides[pos] ?? {};
    const updatedPosOverride = { ...currentPosOverride, ...updates };

    onChange({
      eyeOverrides: {
        ...currentOverrides,
        [pos]: updatedPosOverride,
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h4 className="mb-3 text-sm font-semibold text-fg-soft">Pattern Style</h4>
        
        {isLowReliability && (
          <div className="mb-4" data-testid="pattern-warning-slot">
            <Alert variant="error" title="Scannability Warning" role="note">
              The selected pattern ("{PATTERNS.find((p) => p.id === config.style)?.label || ''}") is complex and may reduce scannability on older mobile devices or in poor lighting. Consider testing thoroughly before printing.
            </Alert>
          </div>
        )}

        <SegmentedControl<QRStyle>
          appearance="tiles"
          label="Pattern Style"
          className="grid-cols-4"
          value={config.style}
          onChange={(style) => onChange({ style })}
          options={PATTERNS.map((pattern) => ({
            value: pattern.id,
            ariaLabel: `Select ${pattern.label} pattern`,
            label: (
              <>
                <span className="grid size-8 grid-cols-2 gap-0.5 p-1" aria-hidden="true">
                  {[1, 2, 3, 4].map((i) => (
                    <PatternModule key={i} style={pattern.id} />
                  ))}
                </span>
                <span className="leading-tight">{pattern.label}</span>
              </>
            ),
          }))}
        />
      </div>

      <div>
        <h4 className="mb-3 text-sm font-semibold text-fg-soft">Frame Shape</h4>
        <SegmentedControl<EyeShape>
          appearance="tiles"
          label="Frame Shape"
          className="grid-cols-4"
          value={(config.eyeFrameStyle || config.style) as EyeShape}
          onChange={(eyeFrameStyle) => onChange({ eyeFrameStyle })}
          options={EYE_SHAPES.map((shape) => ({
            value: shape.id,
            ariaLabel: `Select ${shape.label} frame shape`,
            label: shape.label,
          }))}
        />
      </div>

      <div>
        <h4 className="mb-3 text-sm font-semibold text-fg-soft">Eyeball Shape</h4>
        <SegmentedControl<EyeShape>
          appearance="tiles"
          label="Eyeball Shape"
          className="grid-cols-4"
          value={(config.eyeBallStyle || config.style) as EyeShape}
          onChange={(eyeBallStyle) => onChange({ eyeBallStyle })}
          options={EYE_SHAPES.map((shape) => ({
            value: shape.id,
            ariaLabel: `Select ${shape.label} eyeball shape`,
            label: shape.label,
          }))}
        />
      </div>

      <div className="border-t border-line-subtle pt-2">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-fg-soft">Individual Eye Styling</h4>
            <p className="text-xs text-fg-muted">Customize frame, eyeball, and colors per corner eye</p>
          </div>
          <ToggleSwitch
            id="toggle-individual-eyes"
            label="Customize Individual Eyes"
            checked={isCustomEyesEnabled}
            onChange={(checked) => {
              if (checked) {
                onChange({
                  eyeOverrides: {
                    'top-left': {},
                    'top-right': {},
                    'bottom-left': {},
                  },
                });
              } else {
                onChange({ eyeOverrides: undefined });
              }
            }}
          />
        </div>

        {isCustomEyesEnabled && (
          <div className="mt-4 space-y-6 pl-1" data-testid="individual-eye-controls">
            {EYE_POSITIONS.map((pos) => {
              const label = EYE_LABELS[pos];
              const eyeOverride = config.eyeOverrides?.[pos] ?? {};
              const currentFrameStyle = (eyeOverride.frameStyle || config.eyeFrameStyle || config.style) as EyeShape;
              const currentBallStyle = (eyeOverride.ballStyle || config.eyeBallStyle || config.style) as EyeShape;
              const currentFrameColor = eyeOverride.frameColor || eyeOverride.color || config.eyeFrameColor || config.eyeColor;
              const currentBallColor = eyeOverride.ballColor || eyeOverride.color || config.eyeBallColor || config.eyeColor;

              return (
                <div key={pos} className="space-y-4 rounded-xl border border-line bg-surface-raised p-3">
                  <h5 className="text-xs font-bold tracking-wider text-fg-muted uppercase">{label}</h5>

                  <div>
                    <span className="mb-2 block text-xs font-medium text-fg-soft">{label} Frame Shape</span>
                    <SegmentedControl<EyeShape>
                      appearance="tiles"
                      label={`${label} Frame Shape`}
                      className="grid-cols-4"
                      value={currentFrameStyle}
                      onChange={(frameStyle) => handleEyeOverrideChange(pos, { frameStyle })}
                      options={EYE_SHAPES.map((shape) => ({
                        value: shape.id,
                        ariaLabel: `Select ${shape.label} for ${label} frame`,
                        label: shape.label,
                      }))}
                    />
                  </div>

                  <div>
                    <span className="mb-2 block text-xs font-medium text-fg-soft">{label} Eyeball Shape</span>
                    <SegmentedControl<EyeShape>
                      appearance="tiles"
                      label={`${label} Eyeball Shape`}
                      className="grid-cols-4"
                      value={currentBallStyle}
                      onChange={(ballStyle) => handleEyeOverrideChange(pos, { ballStyle })}
                      options={EYE_SHAPES.map((shape) => ({
                        value: shape.id,
                        ariaLabel: `Select ${shape.label} for ${label} eyeball`,
                        label: shape.label,
                      }))}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <ColorInput
                      id={`${pos}-frame-color`}
                      label={`${label} Frame Color`}
                      value={currentFrameColor}
                      onChange={(frameColor) => handleEyeOverrideChange(pos, { frameColor })}
                    />
                    <ColorInput
                      id={`${pos}-ball-color`}
                      label={`${label} Eyeball Color`}
                      value={currentBallColor}
                      onChange={(ballColor) => handleEyeOverrideChange(pos, { ballColor })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
