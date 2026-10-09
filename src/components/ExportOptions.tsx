/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { Code, ShieldCheck } from 'lucide-react';
import { Button } from './ui/Button';
import { SegmentedControl } from './ui/SegmentedControl';
import { TextField } from './ui/TextField';

/** Download formats offered by the generator. */
export type DownloadFormat = 'png' | 'svg' | 'eps' | 'pdf' | 'jpeg' | 'webp';

/** Button and announcement label of each format. */
export const FORMAT_LABELS: Record<DownloadFormat, string> = {
  png: 'PNG',
  svg: 'SVG',
  eps: 'EPS',
  pdf: 'PDF',
  jpeg: 'JPEG',
  webp: 'WebP',
};

const FORMAT_HINTS: Record<DownloadFormat, string> = {
  png: 'Sharp image that works everywhere.',
  svg: 'Vector: scales to any size, best for print and design tools.',
  eps: 'EPS vector file for professional prepress and commercial print design workflows.',
  pdf: 'Portable vector PDF document for cross-platform vector design workflows.',
  jpeg: 'Smallest image, with no transparency.',
  webp: 'Small and sharp, for websites.',
};


/** Raster size presets in pixels. */
const SIZE_PRESETS = { screen: 512, print: 2048, poster: 4096 } as const;
type SizePreset = keyof typeof SIZE_PRESETS | 'custom';

/** Smallest and largest custom width in pixels. */
const MIN_SIZE = 128;
const MAX_SIZE = 8192;

/**
 * Keeps a requested width within the supported range.
 * @param size - Requested width in pixels.
 * @returns A whole number of pixels between 128 and 8192.
 */
export function clampSize(size: number): number {
  return Number.isFinite(size) ? Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size))) : SIZE_PRESETS.print;
}

/**
 * Describes the printed size of a raster export at 300 dpi and how far away it scans
 * (roughly ten times the code's width).
 * @param size - Width in pixels.
 * @returns For example "Prints 17.3 cm (6.8 in) wide at 300 dpi and scans from about 1.7 m."
 */
export function printHint(size: number): string {
  const inches = size / 300;
  const cm = inches * 2.54;
  return `Prints ${cm.toFixed(1)} cm (${inches.toFixed(1)} in) wide at 300 dpi and scans from about ${(cm / 10).toFixed(1)} m.`;
}

interface ExportOptionsProps {
  /** Id of the panel (the options button's `aria-controls`). */
  id: string;
  format: DownloadFormat;
  onFormatChange: (format: DownloadFormat) => void;
  /** Raster width in pixels. */
  size: number;
  onSizeChange: (size: number) => void;
  /** File name without extension. */
  filename: string;
  onFilenameChange: (filename: string) => void;
  /** Copies the code as SVG markup. */
  onCopySvg: () => void;
  copySvgBusy: boolean;
}

/**
 * The Download options panel of the generator: format, raster size with a print helper,
 * the file name and Copy as SVG. The Download button exports with these choices.
 * @param props - Current choices and their change handlers.
 * @returns The options panel.
 */
export function ExportOptions({ id, format, onFormatChange, size, onSizeChange, filename, onFilenameChange, onCopySvg, copySvgBusy }: ExportOptionsProps) {
  const preset = (Object.keys(SIZE_PRESETS) as (keyof typeof SIZE_PRESETS)[]).find((key) => SIZE_PRESETS[key] === size) ?? 'custom';
  return (
    <div
      id={id}
      role="group"
      aria-label="Download options"
      className="absolute right-0 bottom-full z-40 mb-2 w-80 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl border border-line bg-surface-raised p-4 text-left shadow-overlay motion-safe:animate-rise-in"
    >
      <div>
        <p id={`${id}-format`} className="mb-1.5 text-sm font-medium text-fg-soft">Format</p>
        <SegmentedControl<DownloadFormat>
          labelledBy={`${id}-format`}
          value={format}
          onChange={onFormatChange}
          options={(Object.keys(FORMAT_LABELS) as DownloadFormat[]).map((value) => ({ value, label: FORMAT_LABELS[value] }))}
        />
        <p className="mt-1.5 text-xs text-fg-muted">{FORMAT_HINTS[format]}</p>
      </div>

      <div>
        <p id={`${id}-size`} className="mb-1.5 text-sm font-medium text-fg-soft">Size</p>
        {format === 'svg' || format === 'eps' || format === 'pdf' ? (
          <p className="text-xs text-fg-muted">{format.toUpperCase()} is vector, so it has no pixel size: it stays sharp at any size.</p>
        ) : (
          <>
            <SegmentedControl<SizePreset>
              labelledBy={`${id}-size`}
              value={preset}
              onChange={(next) => onSizeChange(next === 'custom' ? 1000 : SIZE_PRESETS[next])}
              options={[
                { value: 'screen', label: 'Screen' },
                { value: 'print', label: 'Print' },
                { value: 'poster', label: 'Poster' },
                { value: 'custom', label: 'Custom' },
              ]}
            />
            {preset === 'custom' && (
              <TextField
                className="mt-2"
                label="Width in pixels"
                type="number"
                inputMode="numeric"
                min={MIN_SIZE}
                max={MAX_SIZE}
                value={String(size)}
                onChange={(event) => onSizeChange(Number(event.target.value))}
                onBlur={() => onSizeChange(clampSize(size))}
              />
            )}
            <p className="mt-1.5 text-xs text-fg-muted" data-testid="print-hint">
              {clampSize(size)} px wide. {printHint(clampSize(size))}
            </p>
          </>
        )}
      </div>

      <TextField label="File name" value={filename} onChange={(event) => onFilenameChange(event.target.value)} spellCheck={false} />

      <Button variant="outline" size="sm" fullWidth onClick={onCopySvg} loading={copySvgBusy}>
        <Code className="size-4" aria-hidden="true" />
        Copy as SVG
      </Button>

      <div className="rounded-lg border border-line bg-surface-sunken p-3" data-testid="export-reassurance-card">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <div className="space-y-0.5 text-xs">
            <p className="font-semibold text-fg">Never expires</p>
            <p className="leading-relaxed text-fg-muted">
              This is a static code: the content is in the pattern itself, so it keeps working with no account, scan limit or subscription.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
