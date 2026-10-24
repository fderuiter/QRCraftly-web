/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import React, { Suspense, useRef, useCallback } from 'react';
import { ButtonLink } from "./ui/Button";
import { Tooltip } from "./ui/Tooltip";
import type { QRConfig } from '@/packages/core/types';
import { CircleHelp } from 'lucide-react';
import type { DownloadFormat } from './ExportOptions';
import { useExportFlow } from '@/hooks/useExportFlow';
import { useGeneratorPreview } from '@/hooks/useGeneratorPreview';
import { QRProvider, useQRStore, useQRStoreSelector } from '@/context/QRContext';
import { useCapabilities } from '@/hooks/useCapabilities';
import { sidebarControls } from '@/registry';
import { ToolWorkspaceLayout, ToolWorkspaceHeader } from './ToolWorkspaceLayout';
import { usePageContent } from '@/data/PageContentContext';
import { MiniPreview } from './MiniPreview';
import type { ScanFix } from '@/packages/scannability';
import { fixPatch, resetPatch } from './generator/decisions';
import { SafetyGateModal } from './generator/SafetyGateModal';
import { PreviewCard } from './generator/PreviewCard';
import { ExportBar } from './generator/ExportBar';
import { GeneratorCommands } from './command/GeneratorCommands';
import { useUndoToast } from '@/hooks/useUndoToast';
import { useTextEntryFocus } from '@/hooks/useTextEntryFocus';

// The phone wallet dialog (ADR 0048) loads only when it is opened.
const WalletDialog = React.lazy(() => import('./wallet/WalletDialog'));

/** One-line promise under every generator heading. */
const GENERATOR_SUBTITLE = 'No sign-up, no ads, never expires.';

/** Id of the generator preview region (target of the mobile jump link). */
const PREVIEW_ID = 'qr-preview';

/**
 * Renders the QR code generator interface with configuration controls, preview, and export actions.
 * @param title - Optional title used for the generator heading and branding.
 * @param toolId - Identifier passed to the sidebar controls.
 * @returns The QR code generator interface.
 */
const primaryControls = sidebarControls.filter((c) => c.placement === 'primary');
const secondaryControls = sidebarControls.filter((c) => c.placement === 'secondary');
const belowControls = sidebarControls.filter((c) => c.placement === 'below');

function QRToolInner({ title, toolId = 'index' }: { title?: string, toolId?: string }) {
  // Keyword-led H1 from the content registry (e.g. "Free WiFi QR Code Generator"); the brand
  // stays in the header link and the <title>.
  const heading = usePageContent()?.tool?.heading ?? title ?? 'QRCraftly';
  const config = useQRStoreSelector(s => s.config);
  const store = useQRStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const preview = useGeneratorPreview(canvasRef);
  const { debouncedConfig, verdict: scannabilityStatus, health, noVerdict } = preview;
  const flow = useExportFlow({ config, ...preview });
  const { downloadButtonRef, gate } = flow;

  const exportRowRef = useRef<HTMLDivElement>(null);
  const inputFocused = useTextEntryFocus(exportRowRef);
  const { canShare } = useCapabilities();

  const handleFix = useCallback((fix: ScanFix) => {
    store.updateConfig(fixPatch(fix));
  }, [store]);

  const notifyUndo = useUndoToast();
  const handleResetDefault = useCallback(() => {
    store.updateConfig(resetPatch());
    notifyUndo('Colors reset');
  }, [store, notifyUndo]);

  const commandActions = {
    download: (target: DownloadFormat) => flow.run('download', target),
    copyImage: () => flow.run('copy'),
    copySvg: () => flow.run('copy-svg'),
    share: canShare ? () => flow.run('share') : undefined,
    jumpToPreview: () => {
      document.getElementById(PREVIEW_ID)?.scrollIntoView?.({ block: 'start' });
      downloadButtonRef.current?.focus();
    },
  };

  return (
    <div className="w-full" id="top">
      <SafetyGateModal open={gate.open} advice={gate.advice} onFix={handleFix} onCancel={gate.cancel} onConfirm={gate.confirm} />
      <ToolWorkspaceLayout
        controlsLabel="QR Code Settings"
        previewLabel="QR Code Preview"
        previewId={PREVIEW_ID}
        header={
          <ToolWorkspaceHeader
            title={heading}
            subtitle={GENERATOR_SUBTITLE}
            previewId={PREVIEW_ID}
            previewJumpLabel="Preview & download"
            actions={
              <Tooltip content="How to use" side="bottom">
                <ButtonLink href="#content-section" variant="icon" iconOnly size="lg" shape="round" aria-label="How to use">
                  <CircleHelp className="size-5" aria-hidden="true" />
                </ButtonLink>
              </Tooltip>
            }
          />
        }
        controls={primaryControls.map((Control) => (
          <Control.component key={Control.id} toolId={toolId} />
        ))}
        secondary={secondaryControls.map((Control) => (
          <Control.component key={Control.id} toolId={toolId} />
        ))}
        preview={
          <PreviewCard
            canvasRef={canvasRef}
            preview={preview}
            errorCorrectionLevel={config.errorCorrectionLevel}
            onFix={handleFix}
            onResetDefault={handleResetDefault}
            guardExport={(run) => flow.guard('download', () => run())}
            exportBar={
              <ExportBar
                flow={flow}
                verdict={scannabilityStatus}
                health={health}
                canShare={canShare}
                rowRef={exportRowRef}
                inputFocused={inputFocused}
              />
            }
          />
        }
      />
      {flow.wallet.open && (
        <Suspense fallback={null}>
          <WalletDialog isOpen onClose={flow.wallet.close} config={config} filename={flow.options.filename} />
        </Suspense>
      )}
      <GeneratorCommands actions={commandActions} onDownload={() => flow.run('download')} />
      {/* No thumbnail while there is no code to mirror: it would be an empty box. */}
      <MiniPreview sourceRef={canvasRef} targetId={PREVIEW_ID} renderKey={debouncedConfig} suppressed={inputFocused || noVerdict} />
      {/* Keeps the last content clear of the mobile action bar. */}
      <div aria-hidden="true" className="h-20 md:hidden" />

      {/* Educational content: full width below the workspace, at article width. */}
      {belowControls.length > 0 && (
        <div className="border-t border-line bg-surface">
          <div className="mx-auto max-w-3xl px-4 pb-4 sm:px-6">
            {belowControls.map((Control) => (
              <Control.component key={Control.id} toolId={toolId} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

export default function QRTool({ initialConfig, presetConfig, title, toolId = 'index' }: { initialConfig?: Partial<QRConfig>, presetConfig?: Partial<QRConfig>, title?: string, toolId?: string }) {
  return (
    <QRProvider initialConfig={initialConfig} presetConfig={presetConfig} retainAppearance>
      <QRToolInner title={title} toolId={toolId} />
    </QRProvider>
  );
}
