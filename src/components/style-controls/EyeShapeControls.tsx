import React from 'react';
import { EyeShape, type QRConfig } from '@/packages/core/types';
import { PatternModule } from '../ui/PatternModule';
import { SegmentedControl } from '../ui/SegmentedControl';

/** The choice that leaves the eye to the module pattern. */
const MATCH_PATTERN = 'pattern';

type EyeShapeChoice = EyeShape | typeof MATCH_PATTERN;

const SHAPE_LABELS: Record<EyeShape, string> = {
  [EyeShape.SQUARE]: 'Square',
  [EyeShape.ROUNDED]: 'Rounded',
  [EyeShape.CIRCLE]: 'Circle',
  [EyeShape.LEAF]: 'Leaf',
};

/** Outlines in a 24-unit box: the frame previews stroke them, the ball previews fill a smaller copy. */
const SHAPE_PATHS: Record<EyeShape, string> = {
  [EyeShape.SQUARE]: 'M3 3H21V21H3Z',
  [EyeShape.ROUNDED]: 'M8 3H16Q21 3 21 8V16Q21 21 16 21H8Q3 21 3 16V8Q3 3 8 3Z',
  [EyeShape.CIRCLE]: 'M21 12A9 9 0 1 1 3 12A9 9 0 1 1 21 12Z',
  [EyeShape.LEAF]: 'M3 3H12A9 9 0 0 1 21 12V21H12A9 9 0 0 1 3 12Z',
};

const SHAPES = Object.values(EyeShape);

interface EyeShapePickerProps {
  label: string;
  part: 'frame' | 'ball';
  config: QRConfig;
  value: EyeShape | undefined;
  onChange: (shape: EyeShape | undefined) => void;
}

const EyeShapePicker: React.FC<EyeShapePickerProps> = ({ label, part, config, value, onChange }) => (
  <SegmentedControl<EyeShapeChoice>
    appearance="tiles"
    label={label}
    className="grid-cols-5"
    value={value ?? MATCH_PATTERN}
    onChange={(choice) => onChange(choice === MATCH_PATTERN ? undefined : choice)}
    options={[
      {
        value: MATCH_PATTERN,
        ariaLabel: `${label}: match the pattern`,
        label: (
          <>
            <span className="grid size-6 grid-cols-2 gap-0.5" aria-hidden="true">
              {[1, 2, 3, 4].map((i) => (
                <PatternModule key={i} style={config.style} />
              ))}
            </span>
            <span className="text-xs leading-tight">Pattern</span>
          </>
        ),
      },
      ...SHAPES.map((shape) => ({
        value: shape,
        ariaLabel: `${label}: ${SHAPE_LABELS[shape]}`,
        label: (
          <>
            <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
              {part === 'frame' ? (
                <path d={SHAPE_PATHS[shape]} fill="none" stroke="currentColor" strokeWidth="3.5" />
              ) : (
                <path d={SHAPE_PATHS[shape]} fill="currentColor" transform="translate(6 6) scale(0.5)" />
              )}
            </svg>
            <span className="text-xs leading-tight">{SHAPE_LABELS[shape]}</span>
          </>
        ),
      })),
    ]}
  />
);

interface EyeShapeControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

/**
 * Picks the finder eyes' frame and ball shapes apart from the module pattern (#1465). "Pattern"
 * leaves the field unset, so the eye is drawn exactly as the pattern draws it.
 */
export const EyeShapeControls: React.FC<EyeShapeControlsProps> = ({ config, onChange }) => (
  <div className="mt-5 space-y-4">
    <h4 className="text-sm font-semibold text-fg-soft">Eye Shape</h4>
    <div>
      <p className="mb-2 text-xs text-fg-muted">Frame</p>
      <EyeShapePicker
        label="Eye frame shape"
        part="frame"
        config={config}
        value={config.eyeFrameShape}
        onChange={(eyeFrameShape) => onChange({ eyeFrameShape })}
      />
    </div>
    <div>
      <p className="mb-2 text-xs text-fg-muted">Ball</p>
      <EyeShapePicker
        label="Eye ball shape"
        part="ball"
        config={config}
        value={config.eyeBallShape}
        onChange={(eyeBallShape) => onChange({ eyeBallShape })}
      />
    </div>
  </div>
);
