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

import { useCallback } from 'react';
import { Download, Share2, ChevronDown, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ExportOptions as DownloadOptions, FORMAT_LABELS, type DownloadFormat } from '@/components/ExportOptions';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import type { ExportFlow } from '@/hooks/useExportFlow';
import type { HealthScore } from '@/hooks/useScannability';
import { getExportRiskPolicy } from '@/utils/exportRiskPolicy';
import { exportsOffNoteId } from './exportsOffNote';
import { getScanVerdict, type ScannabilityStatus, type ScanVerdict } from '@/packages/scannability';

/** Scan-safety dot shown in the mobile action bar, in the same tone as the verdict pill. */
const STATUS_DOT_CLASSES: Record<ScanVerdict, string> = {
  checking: 'bg-line-strong',
  reliable: 'bg-success',
  fragile: 'bg-warning',
  unreliable: 'bg-danger',
};

export interface ExportBarProps {
  flow: ExportFlow;
  verdict: ScannabilityStatus;
  health: HealthScore | undefined;
  canShare: boolean;
  /** The export row; text fields inside it do not hide the docked bar. */
  rowRef: React.RefObject<HTMLDivElement | null>;
  /** True while a text field outside the bar has focus, so the docked bar steps aside. */
  inputFocused: boolean;
}

/**
 * The format control and the one export row: Download for the chosen format, Download options,
 * Copy and Share. Below md the row docks to the bottom of the screen as a sticky action bar.
 */
export function ExportBar({ flow, verdict, health, canShare, rowRef, inputFocused }: ExportBarProps) {
  const { downloadButtonRef, copyButtonRef, shareButtonRef, optionsButtonRef, options, notifyExportsOff, run } = flow;
  const { busy: busyExport, done } = flow.status;
  const { format, setFormat, size, setSize, colorSpace, setColorSpace, filename, setFilename: setCustomFilename } = options;
  const optionsOpen = options.open;
  const exportsOffReason = exportsOffNoteId(flow.exportsOff === 'refused', flow.exportsOff === 'empty');
  const setOptionsOpen = options.setOpen;
  const closeOptions = useCallback(() => setOptionsOpen(false), [setOptionsOpen]);
  usePopoverDismiss({ open: optionsOpen, containerRef: rowRef, triggerRef: optionsButtonRef, onClose: closeOptions });

  const onDownload = () => run('download');
  const onCopy = () => run('copy');
  const onCopySvg = () => run('copy-svg');
  const onShare = () => run('share');
  const onWallet = () => run('wallet');
  const copied = done?.format === 'clipboard';

  return (
    <>
      {/* The common formats in view, so a vector download is one click; the rest are in Download options. */}
      <SegmentedControl<DownloadFormat>
         label="File format"
         className="mb-2 max-md:hidden"
         value={format}
         onChange={setFormat}
         options={[...new Set<DownloadFormat>(['png', 'svg', 'pdf', format])].map((value) => ({ value, label: FORMAT_LABELS[value] }))}
      />

      {/* One export row. Below md it docks to the bottom of the screen as a sticky action bar. */}
      <div
         ref={rowRef}
         className={`fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-overlay md:relative md:z-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none ${inputFocused ? 'max-md:hidden' : ''}`}
         data-testid="export-actions"
         data-docked-bar
      >
         <span role="status" className="sr-only">{done?.message ?? ''}</span>
         <span
           aria-hidden="true"
           className={`size-2.5 shrink-0 rounded-full md:hidden ${STATUS_DOT_CLASSES[getScanVerdict({ status: verdict, health }) ?? 'checking']}`}
           data-testid="export-status-dot"
         />
         <Button
            ref={downloadButtonRef}
            variant={!exportsOffReason && getExportRiskPolicy({ status: verdict, health }) === 'unsafe' ? 'error' : 'primary'}
            size="bar"
            className="flex-1"
            loading={busyExport === format}
            aria-disabled={exportsOffReason ? 'true' : undefined}
            aria-describedby={exportsOffReason}
            onClick={exportsOffReason ? notifyExportsOff : onDownload}
         >
            {done && done.format === format ? (
              <>
                <Check className="size-4 motion-safe:animate-pop-in" aria-hidden="true" />
                Downloaded
              </>
            ) : (
              <>
                <Download className="size-4" aria-hidden="true" />
                Download {FORMAT_LABELS[format]}
              </>
            )}
         </Button>
         <Tooltip content="Download options">
           <Button
              ref={optionsButtonRef}
              variant="secondary"
              size="bar"
              iconOnly
              aria-label="Download options"
              aria-expanded={optionsOpen}
              aria-controls={optionsOpen ? 'download-options' : undefined}
              onClick={() => setOptionsOpen((open) => !open)}
           >
              <ChevronDown className={`size-5 motion-safe:transition-transform ${optionsOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
           </Button>
         </Tooltip>
         {optionsOpen && (
           <DownloadOptions
              id="download-options"
              format={format}
              onFormatChange={setFormat}
              size={size}
              onSizeChange={setSize}
              colorSpace={colorSpace}
              onColorSpaceChange={setColorSpace}
              filename={filename}
              onFilenameChange={setCustomFilename}
              onCopySvg={onCopySvg}
              copySvgBusy={busyExport === 'svg-copy'}
              onWallet={onWallet}
           />
         )}

         <Tooltip content={copied ? 'Copied' : 'Copy image'}>
           <Button
              ref={copyButtonRef}
              variant="secondary"
              size="bar"
              iconOnly
              onClick={onCopy}
              loading={busyExport === 'clipboard'}
              aria-label={copied ? "Copied" : "Copy QR code to clipboard"}
              aria-disabled={exportsOffReason ? 'true' : undefined}
              aria-describedby={exportsOffReason}
           >
              {copied ? <Check className="size-5 text-success motion-safe:animate-pop-in" aria-hidden="true" /> : <Copy className="size-5" aria-hidden="true" />}
           </Button>
         </Tooltip>

         {canShare && (
           <Tooltip content="Share">
             <Button
                ref={shareButtonRef}
                variant="secondary"
                size="bar"
                iconOnly
                onClick={onShare}
                loading={busyExport === 'share'}
                aria-label={done?.format === 'share' ? 'Shared' : 'Share QR code'}
                aria-disabled={exportsOffReason ? 'true' : undefined}
                aria-describedby={exportsOffReason}
             >
                <Share2 className="size-5" aria-hidden="true" />
             </Button>
           </Tooltip>
         )}
      </div>
    </>
  );
}
