import React from 'react';
import type { QRConfig, QRStyle } from '../../types';
import { PATTERNS, LOW_RELIABILITY_PATTERNS } from '../../constants';
import { PatternModule } from '../ui/PatternModule';
import { Alert } from '../ui/Alert';
import { SegmentedControl } from '../ui/SegmentedControl';

interface PatternControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

export const PatternControls: React.FC<PatternControlsProps> = ({ config, onChange }) => {
  const isLowReliability = LOW_RELIABILITY_PATTERNS.includes(config.style);

  return (
    <div>
      <h4 className="mb-3 text-sm font-semibold text-fg-soft">Pattern Style</h4>
      
      {isLowReliability && (
        <div className="mb-4" data-testid="pattern-warning-slot">
          <Alert variant="error" title="Scannability Warning" role="note">
            The selected pattern ("{PATTERNS.find(p => p.id === config.style)?.label || ''}") is complex and may reduce scannability on older mobile devices or in poor lighting. Consider testing thoroughly before printing.
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
  );
};
