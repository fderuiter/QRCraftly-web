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

import { useEffect, useId, useState } from 'react';
import { loadQrEncoder, QrEncodeError, type QrSymbolEncoder } from '@/packages/qr-matrix/encoder';
import { TextAreaField } from '@/components/ui/FormFields';
import { RangeInput } from '@/components/ui/RangeInput';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl';
import { QRErrorCorrectionLevel } from '@/types';
import { formatDistanceBoth, formatWidth, getPrintGuidance, MIN_MODULE_MM, widthForDistance } from '@/utils/printGuidance';

/** What the calculator starts with: a typical short link. */
const SAMPLE_CONTENT = 'https://example.com/menu';

/** Printed widths people commonly ask about, in centimetres: stickers, business cards, flyers, posters. */
export const COMMON_WIDTHS_CM: readonly number[] = [2, 2.5, 3.5, 5, 10, 20, 50, 100];

const LEVEL_OPTIONS: readonly SegmentedOption<QRErrorCorrectionLevel>[] = [
  { value: QRErrorCorrectionLevel.L, label: 'L', ariaLabel: 'Low (L)' },
  { value: QRErrorCorrectionLevel.M, label: 'M', ariaLabel: 'Medium (M)' },
  { value: QRErrorCorrectionLevel.Q, label: 'Q', ariaLabel: 'Quartile (Q)' },
  { value: QRErrorCorrectionLevel.H, label: 'H', ariaLabel: 'High (H)' },
];

/** The code the content makes, or why it makes none. */
type Measured = { kind: 'ok'; moduleCount: number; version: number } | { kind: 'empty' } | { kind: 'too-long' } | { kind: 'loading' } | { kind: 'failed' };

/** The calculator's state when the encoder could not load. */
const FAILED: Measured = { kind: 'failed' };

/**
 * Measures the code the content would make, with the same encoder the generator uses.
 * @param encoder - The loaded encoder, or null while it loads.
 * @param content - What the code holds.
 * @param level - Error correction level.
 * @returns The module count and version, or why there is none.
 */
function measure(encoder: QrSymbolEncoder | null, content: string, level: QRErrorCorrectionLevel): Measured {
  if (!encoder) return { kind: 'loading' };
  if (content.length === 0) return { kind: 'empty' };
  try {
    const symbol = encoder.create(content, { errorCorrectionLevel: level });
    return { kind: 'ok', moduleCount: symbol.modules.size, version: symbol.version };
  } catch (error) {
    if (error instanceof QrEncodeError && error.kind === 'too-long') return { kind: 'too-long' };
    return { kind: 'failed' };
  }
}

/**
 * Works out how big to print a QR code so a phone scans it from a chosen distance, from the real
 * code the content makes. Everything runs in the browser; the content is never sent anywhere.
 * @returns The calculator.
 */
export function QRSizeCalculator() {
  const [encoder, setEncoder] = useState<QrSymbolEncoder | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [content, setContent] = useState(SAMPLE_CONTENT);
  const [level, setLevel] = useState<QRErrorCorrectionLevel>(QRErrorCorrectionLevel.M);
  const [distanceCm, setDistanceCm] = useState(100);
  const levelLabelId = useId();
  const resultTitleId = useId();
  const tableCaptionId = useId();

  useEffect(() => {
    let active = true;
    loadQrEncoder().then(
      (loaded) => {
        if (active) setEncoder(loaded);
      },
      () => {
        if (active) setLoadFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const measured = loadFailed ? FAILED : measure(encoder, content, level);

  return (
    <div className="flex flex-col gap-6" data-testid="qr-size-calculator">
      <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
        <TextAreaField
          label="What the code will hold"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          spellCheck={false}
          aria-describedby={`${levelLabelId}-hint`}
        />
        <p id={`${levelLabelId}-hint`} className="-mt-3 text-xs text-fg-muted">
          Paste the link or text you will encode. Longer content makes a denser code that needs more room. It stays on this device.
        </p>
        <div>
          <p id={levelLabelId} className="mb-1 block text-xs font-medium text-fg-muted">
            Error correction
          </p>
          <SegmentedControl labelledBy={levelLabelId} options={LEVEL_OPTIONS} value={level} onChange={setLevel} />
        </div>
        <RangeInput
          id="scan-distance"
          label="Scan distance"
          value={distanceCm}
          onChange={setDistanceCm}
          min={10}
          max={1000}
          step={10}
          formatValue={formatDistanceBoth}
        />
      </div>

      <section aria-labelledby={resultTitleId} aria-live="polite" className="rounded-xl border border-line bg-surface p-4">
        <h2 id={resultTitleId} className="mb-2 text-lg font-semibold text-fg">
          Print it at least this wide
        </h2>
        <Result measured={measured} level={level} distanceCm={distanceCm} />
      </section>

      {measured.kind === 'ok' && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm" aria-describedby={tableCaptionId}>
            <caption id={tableCaptionId} className="p-4 pb-2 text-left text-base font-semibold text-fg">
              How far this code scans at common sizes
            </caption>
            <thead>
              <tr className="border-b border-line text-fg-muted">
                <th scope="col" className="px-4 py-2 font-medium">
                  Printed width
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Scans from about
                </th>
              </tr>
            </thead>
            <tbody>
              {COMMON_WIDTHS_CM.map((width) => {
                const guidance = getPrintGuidance(width, measured.moduleCount, level);
                return (
                  <tr key={width} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2 text-fg">{formatWidth(width)}</td>
                    <td className="px-4 py-2 text-fg-soft">
                      {guidance.tooSmall ? 'Too small to print reliably' : formatDistanceBoth(guidance.distanceCm)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * The recommended width for the measured code, or why there is none.
 * @param props - The measurement and settings.
 * @param props.measured - The code the content makes.
 * @param props.level - Error correction level.
 * @param props.distanceCm - Chosen scan distance in centimetres.
 * @returns The result text.
 */
function Result({ measured, level, distanceCm }: { measured: Measured; level: QRErrorCorrectionLevel; distanceCm: number }) {
  switch (measured.kind) {
    case 'loading':
      return <p className="text-sm text-fg-muted">Working it out...</p>;
    case 'failed':
      return <p className="text-sm text-danger">The calculator could not start in this browser. Reload the page to try again.</p>;
    case 'empty':
      return <p className="text-sm text-fg-muted">Type or paste what the code will hold to see its size.</p>;
    case 'too-long':
      return <p className="text-sm text-danger">This is more than one QR code can hold. Shorten it, or link to a page that holds it instead.</p>;
    case 'ok': {
      const width = widthForDistance(distanceCm, measured.moduleCount, level);
      const guidance = getPrintGuidance(width, measured.moduleCount, level);
      const limitedByPrint = guidance.moduleMm <= MIN_MODULE_MM + 1e-9;
      return (
        <>
          <p className="text-3xl font-bold text-fg" data-testid="recommended-width">
            {formatWidth(width)}
          </p>
          <p className="mt-2 text-sm text-fg-soft">
            That is the whole printed square, white margin included, for a phone {formatDistanceBoth(distanceCm)} away. This content makes a
            version {measured.version} code, {measured.moduleCount} squares across, so each square prints {guidance.moduleMm.toFixed(2)} mm wide.
          </p>
          {limitedByPrint && (
            <p className="mt-2 text-sm text-fg-soft">
              At this distance the size is set by the printer, not the camera: squares smaller than {MIN_MODULE_MM} mm blur together on most
              printers.
            </p>
          )}
        </>
      );
    }
  }
}
