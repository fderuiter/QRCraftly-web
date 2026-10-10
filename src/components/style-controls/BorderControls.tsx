import React, { useRef, useMemo, useEffect } from 'react';
import { Button } from '../ui/Button';
import { QRConfig, BorderStyle, BorderTextPosition, BorderLogoPosition } from '../../types';
import { Upload, X } from 'lucide-react';
import { getContrastRatio } from '../../utils/colorUtils';
import { ColorInput } from '../ui/ColorInput';
import { RangeInput } from '../ui/RangeInput';
import { useImageUpload } from '../../hooks/useImageUpload';
import { ToggleSwitch } from '../ui/ToggleSwitch';
import { SelectField, TextField } from '../ui/FormFields';
import { useOptionalQRStoreSelector } from '../../context/QRContext';
import { MIN_CONTRAST_THRESHOLD } from '../../constants';
import { ContrastBadge } from './ContrastWarning';

interface BorderControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

export const BorderControls: React.FC<BorderControlsProps> = ({ config, onChange }) => {
  const moduleCount = useOptionalQRStoreSelector(s => s.moduleCount) ?? 0;

  const borderModules = useMemo(() => {
    if (!moduleCount) return 0;
    const minModules = 4;
    const userModules = (config.borderSize * moduleCount) / (1 - 2 * config.borderSize);
    return Math.max(minModules, Math.round(userModules * 10) / 10);
  }, [moduleCount, config.borderSize]);

  const borderLogoInputRef = useRef<HTMLInputElement>(null);
  const borderLogoUploadButtonRef = useRef<HTMLButtonElement>(null);
  const prevBorderLogoUrlRef = useRef<string | null>(config.borderLogoUrl);
  const { error, handleUpload, setError } = useImageUpload();

  useEffect(() => {
    if (prevBorderLogoUrlRef.current && !config.borderLogoUrl) {
      setTimeout(() => {
        borderLogoUploadButtonRef.current?.focus();
      }, 50);
    }
    prevBorderLogoUrlRef.current = config.borderLogoUrl;
  }, [config.borderLogoUrl]);

  const handleBorderLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleUpload(e, (dataUrl) => onChange({ borderLogoUrl: dataUrl }));
  };

  const borderTextContrast = useMemo(() => {
    return config.isBorderEnabled && config.borderText
      ? getContrastRatio(config.borderTextColor, config.borderColor)
      : 21;
  }, [config.isBorderEnabled, config.borderText, config.borderTextColor, config.borderColor]);

  const isLowBorderContrast = borderTextContrast < MIN_CONTRAST_THRESHOLD;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-fg-soft">Border</h4>
        <ToggleSwitch
          id="enable-border"
          label="Enable Border"
          srLabel={true}
          checked={config.isBorderEnabled}
          onChange={(checked) => onChange({ isBorderEnabled: checked })}
        />
      </div>

      {config.isBorderEnabled && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              id="border-style"
              label="Style"
              value={config.borderStyle || 'solid'}
              onChange={(e) => onChange({ borderStyle: e.target.value as BorderStyle })}
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="double">Double</option>
            </SelectField>
            <div>
              <RangeInput
                id="border-size"
                label={`Width (~${borderModules} mod)`}
                min={0.01}
                max={0.15}
                step={0.005}
                value={config.borderSize}
                onChange={(val) => onChange({ borderSize: val })}
                formatValue={(val) => `${(val * 100).toFixed(1)}%`}
              />
            </div>
          </div>

          <ColorInput
            id="border-color"
            label="Border Color"
            value={config.borderColor}
            onChange={(val) => onChange({ borderColor: val })}
          />

          {/* Border Content Section */}
          <div className="border-t border-line pt-2">
            <div className="mb-2 flex items-baseline justify-between">
              <p className="text-xs font-medium text-fg-soft">Content</p>
              <ContrastBadge isVisible={isLowBorderContrast} contrastRatio={borderTextContrast} decimalPrecision={1} />
            </div>

            {/* Border Text */}
            <div className="mb-3 space-y-2">
              <TextField
                placeholder="Text on border..."
                value={config.borderText}
                onChange={(e) => onChange({ borderText: e.target.value })}
                aria-label="Border text"
              />
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <SelectField
                    id="border-text-position"
                    label="Border text position"
                    labelClassName="sr-only"
                    value={config.borderTextPosition || 'bottom-center'}
                    onChange={(e) => onChange({ borderTextPosition: e.target.value as BorderTextPosition })}
                  >
                    <option value="top-center">Top Center</option>
                    <option value="bottom-center">Bottom Center</option>
                  </SelectField>
                </div>
                <div className="mt-1 flex items-center">
                  <ColorInput
                    id="border-text-color"
                    label="Border Text Color"
                    hideLabel={true}
                    value={config.borderTextColor || '#ffffff'}
                    onChange={(val) => onChange({ borderTextColor: val })}
                    sizeClass="w-9 h-9"
                    title="Text Color"
                  />
                </div>
              </div>
            </div>

            {/* Border Logo */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {config.borderLogoUrl ? (
                  <img src={config.borderLogoUrl} alt="Secondary Brand Graphic" width={32} height={32} className="size-8 rounded border border-line bg-surface-raised object-contain" />
                ) : (
                  <span className="text-xs text-fg-muted italic">No secondary logo</span>
                )}
                {config.borderLogoUrl && (
                  <Button
                    variant="error"
                    iconOnly
                    size="xs"
                    shape="round"
                    onClick={() => { onChange({ borderLogoUrl: null }); setError(null); }}
                    aria-label="Remove border logo"
                  >
                    <X className="size-3" />
                  </Button>
                )}
              </div>
              <Button
                ref={borderLogoUploadButtonRef}
                variant="secondary"
                size="sm"
                onClick={() => borderLogoInputRef.current?.click()}
              >
                <Upload className="size-3.5" aria-hidden="true" />
                {config.borderLogoUrl ? 'Change' : 'Add Logo'}
              </Button>
              <input
                ref={borderLogoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleBorderLogoUpload}
              />
            </div>
            {error && <div role="alert" className="mt-1 text-xs text-danger">{error}</div>}
            {config.borderLogoUrl && (
              <div className="mt-2">
                <SelectField
                  id="border-logo-position"
                  label="Border logo position"
                  labelClassName="sr-only"
                  value={config.borderLogoPosition || 'bottom-center'}
                  onChange={(e) => onChange({ borderLogoPosition: e.target.value as BorderLogoPosition })}
                >
                  <option value="bottom-center">Bottom Center</option>
                  <option value="bottom-right">Bottom Right</option>
                </SelectField>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
