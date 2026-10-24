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

import React, { Suspense, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Alert';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import QRCanvas from '@/components/QRCanvas';
import { ScannabilityIndicator } from '@/components/ScannabilityIndicator';
import { StressTestButton } from '@/components/arcade/StressTestButton';
import { PREVIEW_VIEWS, type PreviewView } from '@/components/mockups/previewViews';
import { type QRErrorCorrectionLevel, SocialFormat } from '@/packages/core/types';
import type { ScanFix } from '@/packages/scannability';
import type { GeneratorPreview } from '@/hooks/useGeneratorPreview';
import { EMPTY_STATE_ID, REFUSED_STATE_ID, exportsOffNoteId } from './exportsOffNote';

// The "In the wild" scenes, viewing test and PNG export load only when a view other than Flat is chosen.
const MockupView = React.lazy(() => import('@/components/mockups/MockupView'));

/**
 * From md up the preview is a sticky, viewport-height column, so the QR is sized by the
 * screen height: 18rem is left for the site header, the heading and status row, the export row and padding, which
 * keeps the QR and the Download control on screen without scrolling (#1050).
 */
const STAGE_SIZE_CLASSES: Record<SocialFormat, string> = {
  [SocialFormat.SQUARE_1_1]: 'md:max-w-[calc(100dvh_-_18rem)]',
  [SocialFormat.PORTRAIT_4_5]: 'md:max-w-[calc((100dvh_-_18rem)*0.8)]',
  [SocialFormat.STORY_9_16]: 'md:max-w-[calc((100dvh_-_18rem)*0.5625)]',
};

export interface PreviewCardProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  preview: GeneratorPreview;
  errorCorrectionLevel: QRErrorCorrectionLevel;
  onFix: (fix: ScanFix) => void;
  onResetDefault: () => void;
  /** Runs a scene export through the same checks and safety gate as the export row. */
  guardExport: (run: () => void | Promise<void>) => void;
  /** The format control and export row, placed under the QR. */
  exportBar: React.ReactNode;
}

/**
 * The generator preview: the status row, the QR canvas, the export row passed in, the
 * "In the wild" scenes and the Arcade stress test.
 */
export function PreviewCard({
  canvasRef,
  preview,
  errorCorrectionLevel,
  onFix,
  onResetDefault,
  guardExport,
  exportBar,
}: PreviewCardProps) {
  const { verdict, health, recovering, onRendered, onRenderFailed, debouncedConfig, effectiveConfig, moduleCount } = preview;
  const [previewView, setPreviewView] = useState<PreviewView>('flat');
  const exportsOffReason = exportsOffNoteId(preview.refused, preview.isEmpty);
  return (
    <Card padding="p-5">
       {/* Heading and status share one row; the heading never wraps and the status drops below it only when there is no room. */}
       <div className="mb-3 flex flex-wrap items-start justify-between gap-x-3" data-testid="preview-status">
          <h2 className="py-1 font-semibold whitespace-nowrap text-fg-soft">Live Preview</h2>
          <div className="flex flex-wrap items-center gap-2">
          <Badge tone="success" data-testid="permanence-badge">
            Static · Non-expiring
          </Badge>
          {exportsOffReason === EMPTY_STATE_ID && (
            <Badge id={EMPTY_STATE_ID} tone="warning" data-testid="sample-preview-badge">
              Sample Preview
            </Badge>
          )}
          {exportsOffReason === REFUSED_STATE_ID && (
            <Badge id={REFUSED_STATE_ID} tone="danger" data-testid="refused-content-badge">
              Fix the highlighted field
            </Badge>
          )}
          <ScannabilityIndicator
            status={verdict}
            health={health}
            errorCorrectionLevel={errorCorrectionLevel}
            onFix={onFix}
            onResetDefault={onResetDefault}
          />
          </div>
       </div>

       {recovering && (
          <div className="mb-4">
             <Alert variant="warning" title="System Warning">
                A temporary background system error occurred. The validator has recovered and subsequent retries are active.
             </Alert>
          </div>
       )}

       {/* Preview stage: the QR is the largest thing on the page. */}
       <div className="mb-4 flex justify-center rounded-xl bg-surface-sunken p-3 md:p-2" data-testid="qr-stage">
          {/* Pass debounced config to QRCanvas to prevent heavy rendering on every keystroke */}
          <QRCanvas ref={canvasRef} onRendered={onRendered} onRenderFailed={onRenderFailed} config={debouncedConfig} className={`rounded-lg shadow-raised ${STAGE_SIZE_CLASSES[debouncedConfig.socialFormat] ?? STAGE_SIZE_CLASSES[SocialFormat.SQUARE_1_1]}`} />
       </div>

       {exportBar}

       {/* Tertiary, after the export row so the QR and Download stay in the first screen: see the code on a poster, card, table tent, screen or sticker. */}
       <div className="mt-5 space-y-3" data-testid="in-the-wild">
          <p id="preview-view-label" className="text-sm font-semibold text-fg-soft">In the wild</p>
          <SegmentedControl<PreviewView>
             appearance="tiles"
             labelledBy="preview-view-label"
             className="grid-cols-3"
             options={PREVIEW_VIEWS}
             value={previewView}
             onChange={setPreviewView}
          />
          {previewView !== 'flat' && (
             <Suspense fallback={<Skeleton className="aspect-4/3 w-full rounded-xl" />}>
                <MockupView sourceRef={canvasRef} renderKey={debouncedConfig} config={effectiveConfig} moduleCount={moduleCount} view={previewView} exportsOffReason={exportsOffReason} guardExport={guardExport} />
             </Suspense>
          )}
       </div>

       {/* Tertiary: playful side feature, after the export row. */}
       {!exportsOffReason && <StressTestButton />}
    </Card>
  );
}
