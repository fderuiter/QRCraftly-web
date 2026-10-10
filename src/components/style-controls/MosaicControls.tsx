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

import React, { useRef } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { RangeInput } from '../ui/RangeInput';
import { QRConfig, QRErrorCorrectionLevel, MosaicMode } from '../../types';
import { Grid3x3, LayoutGrid, Upload, X } from 'lucide-react';
import { useImageUpload } from '../../hooks/useImageUpload';
import { SYSTEM_LIMITS } from '../../constants';
import { combineIds } from '../../utils/a11y';
import { DEFAULT_MOSAIC_OPTIONS } from '@/packages/qr-matrix/mosaic';

/**
 * Props for the MosaicControls component.
 */
interface MosaicControlsProps {
  /** The current QR code configuration. */
  config: QRConfig;
  /** Callback to update the configuration. */
  onChange: (updates: Partial<QRConfig>) => void;
}

const MOSAIC_MODES: { id: MosaicMode; label: string; hint: string; icon: typeof Grid3x3 }[] = [
  { id: 'halftone', label: 'Halftone', hint: 'More image detail', icon: Grid3x3 },
  { id: 'tiles', label: 'Tiles', hint: 'Bolder, scans further', icon: LayoutGrid },
];

/**
 * Controls for Mosaic QR (ADR 0019): tiles an uploaded design into the QR modules while
 * every module keeps its dark or light value. The image is processed on this device only.
 * @param props - The component props.
 * @param props.config - The current configuration.
 * @param props.onChange - Callback to update configuration.
 * @returns The MosaicControls component.
 */
export const MosaicControls: React.FC<MosaicControlsProps> = ({ config, onChange }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { error, handleUpload, setError } = useImageUpload();
  const mode = config.mosaicMode ?? DEFAULT_MOSAIC_OPTIONS.mode;
  const contrast = config.mosaicContrast ?? DEFAULT_MOSAIC_OPTIONS.contrast;

  const handleMosaicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    // High error correction leaves the most room for the logo and for print damage.
    handleUpload(e, (dataUrl) => onChange({ mosaicImageUrl: dataUrl, errorCorrectionLevel: QRErrorCorrectionLevel.H }));
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg-soft">Mosaic</h3>
        {config.mosaicImageUrl && (
          <Button
            variant="error"
            size="xs"
            onClick={() => { onChange({ mosaicImageUrl: null }); setError(null); }}
            aria-label="Remove mosaic image"
          >
            <X className="size-3.5" aria-hidden="true" /> Remove
          </Button>
        )}
      </div>

      {!config.mosaicImageUrl ? (
        <Button
          variant="dropzone"
          onClick={() => fileInputRef.current?.click()}
          aria-describedby={combineIds('mosaic-upload-help', error && 'mosaic-upload-error')}
        >
          <Upload className="mb-2 size-5" aria-hidden="true" />
          <span className="text-sm font-medium">Upload Mosaic Design</span>
          <span id="mosaic-upload-help" className="mt-1 text-xs text-fg-muted">
            Tiles your image into the code. It stays on this device.
          </span>
          {error && <span id="mosaic-upload-error" role="alert" className="mt-2 text-xs text-danger">{error}</span>}
        </Button>
      ) : (
        <Card variant="control" className="space-y-5">
          <div className="flex items-center gap-4">
            <img src={config.mosaicImageUrl} alt="Mosaic design" width={48} height={48} className="size-12 rounded-md border border-line object-cover shadow-sm" />
            <p className="flex-1 text-xs text-fg-muted">
              Error correction is set to High. Check the scan badge before you print.
            </p>
          </div>

          <fieldset>
            <legend className="mb-2 block text-xs font-medium text-fg-muted">Mosaic Layout</legend>
            <div className="grid grid-cols-2 gap-2">
              {MOSAIC_MODES.map((option) => (
                <label
                  key={option.id}
                  className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-2 text-xs focus-within:ring-2 focus-within:ring-focus ${
                    mode === option.id
                      ? 'border-accent bg-accent-soft text-accent-strong'
                      : 'border-line text-fg-muted hover:bg-surface-hover'
                  }`}
                >
                  <input
                    type="radio"
                    name="mosaic-mode"
                    value={option.id}
                    checked={mode === option.id}
                    onChange={() => onChange({ mosaicMode: option.id })}
                    className="sr-only"
                  />
                  <option.icon className="size-4" aria-hidden="true" />
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs opacity-80">{option.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <RangeInput
            id="mosaic-contrast"
            label="Scan Contrast"
            min={0}
            max={1}
            step={0.05}
            value={contrast}
            onChange={(val) => onChange({ mosaicContrast: val })}
            formatValue={(val) => `${Math.round(val * 100)}%`}
          />
        </Card>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={SYSTEM_LIMITS.SUPPORTED_IMAGE_FORMATS.join(',')}
        className="hidden"
        aria-label="Upload mosaic design"
        onChange={handleMosaicUpload}
      />
    </div>
  );
};
