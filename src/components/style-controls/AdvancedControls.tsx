import React from 'react';
import { AccordionItem } from '../ui/Accordion';
import { SegmentedControl } from '../ui/SegmentedControl';
import { type QRConfig, QRErrorCorrectionLevel } from '../../types';

interface AdvancedControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

const LEVELS = [
  { id: QRErrorCorrectionLevel.L, label: 'Low (~7%)', desc: 'Best for screens' },
  { id: QRErrorCorrectionLevel.M, label: 'Medium (~15%)', desc: 'Standard' },
  { id: QRErrorCorrectionLevel.Q, label: 'Quartile (~25%)', desc: 'Good for print' },
  { id: QRErrorCorrectionLevel.H, label: 'High (~30%)', desc: 'Best for logos' },
];

export const AdvancedControls: React.FC<AdvancedControlsProps> = ({ config, onChange }) => (
  <AccordionItem title="Advanced Mode" headingLevel={3} panelId="advanced-settings-panel">
    <div className="space-y-4">
      <div>
        <span id="ecc-level-label" className="mb-2 block text-sm font-medium text-fg-muted">
          Error Correction Level
        </span>
        <SegmentedControl<QRErrorCorrectionLevel>
          appearance="tiles"
          labelledBy="ecc-level-label"
          className="grid-cols-2"
          value={config.errorCorrectionLevel}
          onChange={(errorCorrectionLevel) => onChange({ errorCorrectionLevel })}
          options={LEVELS.map((level) => ({
            value: level.id,
            ariaLabel: `Set error correction level to ${level.label}`,
            describedBy: `ecc-desc-${level.id}`,
            label: (
              <>
                <span>{level.label}</span>
                <span id={`ecc-desc-${level.id}`} className="text-xs font-normal text-fg-muted">
                  {level.desc}
                </span>
              </>
            ),
          }))}
        />
        <p className="mt-2 text-xs text-fg-muted">
          Higher levels allow the QR code to be scanned even if damaged or covered (e.g., by a logo), but result in a denser code.
        </p>
      </div>
    </div>
  </AccordionItem>
);
