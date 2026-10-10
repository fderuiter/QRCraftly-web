import React, { useRef, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { QRConfig, LogoPaddingStyle } from '../../types';
import { Upload, X, Square, Circle, Minus } from 'lucide-react';
import { ColorInput } from '../ui/ColorInput';
import { RangeInput } from '../ui/RangeInput';
import { useImageUpload } from '../../hooks/useImageUpload';
import { SYSTEM_LIMITS } from '../../constants';
import { MIN_LOGO_BACKING_PADDING } from '@/packages/qr-matrix';
import { PRESET_LOGOS, PRESET_LOGO_CATEGORIES, PresetCategory } from '../../constants/presetLogos';
import { SegmentedControl } from '../ui/SegmentedControl';
import { combineIds } from '../../utils/a11y';
import { useUndoToast } from '../../hooks/useUndoToast';

const LOGO_BORDER_STYLES: { id: LogoPaddingStyle; icon: typeof Square; label: string }[] = [
  { id: 'square', icon: Square, label: 'Square' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'none', icon: Minus, label: 'None' },
];

/** What each backing does, shown under the choice. */
const LOGO_BORDER_HINTS: Record<LogoPaddingStyle, string> = {
  square: 'A square of the backing colour sits behind the logo, with a gap you set below.',
  circle: 'A circle of the backing colour sits behind the logo, with a gap you set below.',
  none: 'The logo sits straight on the code, with no backing or gap.',
};

/** Preset categories as tabs over the logo grid. */
const CATEGORY_OPTIONS = PRESET_LOGO_CATEGORIES.map((category) => ({ value: category.id, label: category.label }));

interface LogoControlsProps {
  config: QRConfig;
  onChange: (updates: Partial<QRConfig>) => void;
}

export const LogoControls: React.FC<LogoControlsProps> = ({ config, onChange }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadButtonRef = useRef<HTMLButtonElement>(null);
  const prevLogoUrlRef = useRef<string | null>(config.logoUrl);
  const { error, handleUpload, setError } = useImageUpload();
  const notifyUndo = useUndoToast();
  const [selectedCategory, setSelectedCategory] = useState<PresetCategory>('all');

  useEffect(() => {
    if (prevLogoUrlRef.current && !config.logoUrl) {
      setTimeout(() => {
        uploadButtonRef.current?.focus();
      }, 50);
    }
    prevLogoUrlRef.current = config.logoUrl;
  }, [config.logoUrl]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleUpload(e, (dataUrl) => onChange({ logoUrl: dataUrl }));
  };

  const activePreset = PRESET_LOGOS.find((p) => p.dataUrl === config.logoUrl);
  const filteredPresets = PRESET_LOGOS.filter(
    (p) => selectedCategory === 'all' || p.category === selectedCategory
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-fg-soft">Logo</h4>
        {config.logoUrl && (
          <Button variant="error" size="xs" onClick={() => { onChange({ logoUrl: null }); setError(null); notifyUndo('Logo removed'); }}>
            <X className="size-3.5" aria-hidden="true" /> Remove
          </Button>
        )}
      </div>

      {/* Preset Logo Gallery */}
      <div className="mb-4">
        <SegmentedControl
          kind="tablist"
          label="Preset logo categories"
          options={CATEGORY_OPTIONS}
          value={selectedCategory}
          onChange={setSelectedCategory}
          tabId={(id) => `logo-category-tab-${id}`}
          controls={() => 'logo-category-panel'}
          className="mb-2.5"
        />

        <div
          id="logo-category-panel"
          role="tabpanel"
          aria-labelledby={`logo-category-tab-${selectedCategory}`}
          className="grid grid-cols-5 gap-2 sm:grid-cols-6"
        >
          {filteredPresets.map((preset) => {
            const isSelected = config.logoUrl === preset.dataUrl;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => {
                  onChange({ logoUrl: preset.dataUrl });
                  setError(null);
                }}
                aria-label={`Select ${preset.label} logo`}
                aria-pressed={isSelected}
                title={preset.label}
                className={`group relative flex size-11 items-center justify-center rounded-lg border transition-all focus:ring-2 focus:ring-accent focus:outline-none ${
                  isSelected
                    ? 'border-accent bg-accent-soft shadow-xs ring-2 ring-accent'
                    : 'border-line bg-surface-raised hover:border-line-strong'
                }`}
              >
                <img
                  src={preset.dataUrl}
                  alt={preset.label}
                  className="size-6 object-contain transition-transform group-hover:scale-110"
                />
              </button>
            );
          })}
        </div>
      </div>

      {!config.logoUrl ? (
        <>
          <div className="my-3 flex items-center gap-2">
            <div className="bg-border-subtle h-px flex-1" />
            <span className="text-xs font-medium text-fg-muted">Or upload custom image</span>
            <div className="bg-border-subtle h-px flex-1" />
          </div>
          <Button
            ref={uploadButtonRef}
            variant="dropzone"
            onClick={() => fileInputRef.current?.click()}
            className="group"
            aria-describedby={combineIds('logo-upload-help', error && 'logo-upload-error')}
          >
            <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-surface-hover transition-colors group-hover:bg-accent-soft">
              <Upload className="size-5" aria-hidden="true" />
            </span>
            <span className="text-sm font-medium">Upload Logo</span>
            <span id="logo-upload-help" className="mt-1 text-xs text-fg-muted">{SYSTEM_LIMITS.SUPPORTED_IMAGE_FORMATS.map(t => t.replace('image/', '').replace('+xml', '').toUpperCase()).join(', ')} (Square recommended)</span>
            {error && <span id="logo-upload-error" role="alert" className="mt-2 text-xs text-danger">{error}</span>}
          </Button>
        </>
      ) : (
        <Card variant="control" className="space-y-5">
          <div className="flex items-center gap-4">
            <img src={config.logoUrl} alt="Custom Brand Graphic" width={48} height={48} className="size-12 rounded-md border border-line bg-surface-raised object-contain shadow-sm" />
            <div className="flex-1">
              <p className="text-sm font-medium text-fg-soft">{activePreset ? `${activePreset.label} Logo` : 'Custom Logo'}</p>
              <p className="text-xs text-fg-muted">Embedded in center</p>
            </div>
          </div>

          {/* Logo Border Styles */}
          <div>
            <span id="logo-border-style-label" className="mb-2 block text-sm font-medium text-fg-muted">Border Style</span>
            <SegmentedControl<LogoPaddingStyle>
              labelledBy="logo-border-style-label"
              value={config.logoPaddingStyle}
              onChange={(logoPaddingStyle) => onChange({ logoPaddingStyle })}
              options={LOGO_BORDER_STYLES.map((style) => ({
                value: style.id,
                ariaLabel: `Set logo border style to ${style.label}`,
                describedBy: 'logo-border-style-hint',
                label: (
                  <>
                    <style.icon className="size-4" aria-hidden="true" />
                    {style.label}
                  </>
                ),
              }))}
            />
            <p id="logo-border-style-hint" className="mt-2 text-xs text-fg-muted">
              {LOGO_BORDER_HINTS[config.logoPaddingStyle]}
            </p>
          </div>

          {/* Conditional Controls for Border */}
          {config.logoPaddingStyle !== 'none' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <RangeInput
                  id="logo-padding"
                  label="Padding"
                  min={MIN_LOGO_BACKING_PADDING}
                  max={4}
                  step={0.5}
                  value={Math.max(MIN_LOGO_BACKING_PADDING, config.logoPadding)}
                  onChange={(val) => onChange({ logoPadding: val })}
                />
              </div>
              <ColorInput
                id="logo-bg-color"
                label="Background Color"
                value={config.logoBackgroundColor || config.bgColor}
                onChange={(val) => onChange({ logoBackgroundColor: val })}
                displayValue={config.logoBackgroundColor || 'Auto'}
                sizeClass="w-8 h-8"
              />
            </div>
          )}

          <div>
            <RangeInput
              id="logo-size"
              label="Logo Size"
              min={0.1}
              max={SYSTEM_LIMITS.MAX_LOGO_SIZE}
              step={0.01}
              value={config.logoSize}
              onChange={(val) => onChange({ logoSize: val })}
              formatValue={(val) => `${(val * 100).toFixed(0)}%`}
            />
          </div>
        </Card>
      )}
      <input
        ref={fileInputRef}
        type="file"
        aria-label="Upload logo image"
        accept={SYSTEM_LIMITS.SUPPORTED_IMAGE_FORMATS.join(',')}
        className="hidden"
        onChange={handleLogoUpload}
      />
    </div>
  );
};

