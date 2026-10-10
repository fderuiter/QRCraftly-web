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

import React, { Suspense, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Button, ButtonLink } from "./ui/Button";
import { Badge } from "./ui/Badge";
import { Tooltip } from "./ui/Tooltip";
import { Card } from "./ui/Card";
import { Alert } from "./ui/Alert";
import { DEFAULT_CONFIG, SYSTEM_LIMITS } from '@/constants';
import { QRConfig, SocialFormat, QRStyle, QRErrorCorrectionLevel, QRType } from '@/types';
import QRCanvas from '@/components/QRCanvas';
import { Download, Share2, ChevronDown, CircleHelp, Copy, Check, AlertTriangle } from 'lucide-react';
import { ExportOptions as DownloadOptions, FORMAT_LABELS, clampSize, type DownloadFormat } from './ExportOptions';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { Modal } from './ui/Modal';
import { useLeadingDebounce } from '@/hooks/useDebounce';
import { useQRDownload, BLOCKED_EXPORT_MESSAGE, SCAN_VALIDATION_ERROR, ExportStatus, AssetOptions, type ExportFormat } from '@/hooks/useQRDownload';
import { previewFailureMessage, type PreviewFailure } from '@/utils/previewFailure';
import { getExportRiskPolicy } from '@/utils/exportRiskPolicy';
import { isDangerousUrl } from '@/utils/security';
import { useToast } from './ui/Toast';
import { useScannability } from '@/hooks/useScannability';
import { ScannabilityIndicator } from '@/components/ScannabilityIndicator';
import { QRProvider, useQRStore, useQRStoreSelector } from '@/context/QRContext';
import { getSamplePayload, hydrateWifiData } from '@/packages/qr-payload';
import { useCapabilities } from '@/hooks/useCapabilities';
import { sidebarControls } from '@/registry';
import { StressTestButton } from './arcade/StressTestButton';
import { ToolWorkspaceLayout, ToolWorkspaceHeader } from './ToolWorkspaceLayout';
import { usePageContent } from '@/data/PageContentContext';
import { MiniPreview } from './MiniPreview';
import { getScanVerdict, type ScanFix, type ScanVerdict } from '@/packages/scannability';
import { GeneratorCommands } from './command/GeneratorCommands';
import { useUndoToast } from '@/hooks/useUndoToast';
import { SegmentedControl } from './ui/SegmentedControl';
import { Skeleton } from './ui/Skeleton';
import { PREVIEW_VIEWS, type PreviewView } from './mockups/previewViews';

// The "In the wild" scenes, viewing test and PNG export load only when a view other than Flat is chosen.
const MockupView = React.lazy(() => import('./mockups/MockupView'));

/** One-line promise under every generator heading. */
const GENERATOR_SUBTITLE = 'No sign-up, no ads, never expires.';

/** Id of the generator preview region (target of the mobile jump link). */
const PREVIEW_ID = 'qr-preview';

/** Scan-safety dot shown in the mobile action bar, in the same tone as the verdict pill. */
const STATUS_DOT_CLASSES: Record<ScanVerdict, string> = {
  checking: 'bg-line-strong',
  reliable: 'bg-success',
  fragile: 'bg-warning',
  unreliable: 'bg-danger',
};

const TEXT_ENTRY = 'input, textarea, select';

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
/** Id of the empty-preview explanation referenced by disabled export buttons. */
const EMPTY_STATE_ID = 'qr-empty-state';
/** Id of the explanation shown while a content field holds a refused value (#1279). */
const REFUSED_STATE_ID = 'qr-refused-state';
/** Message shown when there is nothing to export yet. */
export const EMPTY_CONTENT_MESSAGE = 'Enter content to generate a QR code.';

/** Last download choices, kept in memory only (no storage key) while the tab is open. */
const lastDownload: { format: DownloadFormat; size: number } = { format: 'png', size: 2048 };

/** How long a finished export shows its check mark. */
const DONE_MS = 2000;

/**
 * Suggests a file name from the QR type and a harmless hint from the content: the host of
 * a URL or the network name of a WiFi code, for example `wifi-HomeNetwork`.
 * @param config - Current configuration.
 * @returns A file name without extension.
 */
export function suggestFilename(config: Pick<QRConfig, 'type' | 'value'>): string {
  let hint = '';
  try {
    if (config.type === QRType.URL) hint = new URL(config.value).hostname.replace(/^www\./, '');
    if (config.type === QRType.WIFI) hint = hydrateWifiData(config.value).ssid;
  } catch {
    // Not a complete URL or WiFi code yet.
  }
  hint = hint.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return `${config.type.toLowerCase()}-${hint || 'qr-code'}`;
}

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
  const setModuleCount = store.setModuleCount;
  const { addToast } = useToast();
  
  const [showSafetyGate, setShowSafetyGate] = useState(false);
  const [gateAction, setGateAction] = useState<(() => void | Promise<void>) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [previewView, setPreviewView] = useState<PreviewView>('flat');
  const moduleCount = useQRStoreSelector(s => s.moduleCount);

  // Focus preservation refs for originating buttons
  const downloadButtonRef = useRef<HTMLButtonElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const isEmpty = !config.value || !config.value.trim();
  // A field holds a value the form refused, so the config still has the previous content: draw
  // nothing rather than a code that no longer matches the form (#1279).
  const contentRefused = useQRStoreSelector(s => s.contentRefused);
  const samplePayload = useMemo(() => getSamplePayload(config.type), [config.type]);
  const effectiveConfig = useMemo(() => {
    if (contentRefused) return { ...config, value: '' };
    return isEmpty ? { ...config, value: samplePayload } : config;
  }, [config, contentRefused, isEmpty, samplePayload]);
  // Why every export is off, as the id of the note that says so; undefined while exports work.
  const exportsOffReason = contentRefused ? REFUSED_STATE_ID : isEmpty ? EMPTY_STATE_ID : undefined;

  const { exportAsset: runExport } = useQRDownload(effectiveConfig);
  // Which export is encoding right now; its button shows a loading state until it finishes.
  const [busyExport, setBusyExport] = useState<ExportFormat | null>(null);
  const exportAsset = useCallback(async (format: ExportFormat, options?: AssetOptions) => {
    setBusyExport(format);
    try {
      return await runExport(format, options);
    } finally {
      setBusyExport(null);
    }
  }, [runExport]);
  // The export that just finished: its button shows a check and the status region says so.
  const [done, setDone] = useState<{ format: ExportFormat; message: string } | null>(null);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(null), DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);
  const [format, setFormat] = useState<DownloadFormat>(lastDownload.format);
  const [size, setSize] = useState(lastDownload.size);
  const [customFilename, setCustomFilename] = useState<string | null>(null);
  const filename = customFilename ?? suggestFilename(config);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const exportRowRef = useRef<HTMLDivElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const closeOptions = useCallback(() => setOptionsOpen(false), []);
  usePopoverDismiss({ open: optionsOpen, containerRef: exportRowRef, triggerRef: optionsButtonRef, onClose: closeOptions });
  // The mobile action bar steps aside while the on-screen keyboard is up.
  const [inputFocused, setInputFocused] = useState(false);
  useEffect(() => {
    // Fields in the Download options sit inside the bar, so they must not hide it.
    const update = () => setInputFocused(document.activeElement instanceof Element && document.activeElement.matches(TEXT_ENTRY) && !exportRowRef.current?.contains(document.activeElement));
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  const { canShare } = useCapabilities();

  // Scannability
  const { status: rawScannabilityStatus, checkScannability, health: rawHealth, workerRecoveryActive } = useScannability(canvasRef, effectiveConfig);

  // Why the preview has no code to show (blocked or too much content), if it has none (#1251).
  const [previewFailure, setPreviewFailure] = useState<PreviewFailure | null>(null);

  // In sample fallback mode, or when the preview could not draw a code, report 'idle' status so
  // no verdict is shown for a code that does not exist (#1251).
  const noVerdict = isEmpty || contentRefused || previewFailure !== null;
  const scannabilityStatus = noVerdict ? 'idle' : rawScannabilityStatus;
  const health = noVerdict ? undefined : rawHealth;

  const handleFix = useCallback((fix: ScanFix) => {
    if (fix === 'raise-error-correction') {
      store.updateConfig({ errorCorrectionLevel: QRErrorCorrectionLevel.H });
    } else if (fix === 'standard-pattern') {
      store.updateConfig({ style: QRStyle.STANDARD });
    } else if (fix === 'smaller-logo') {
      store.updateConfig({ logoSize: SYSTEM_LIMITS.MAX_LOGO_SIZE });
    } else {
      store.updateConfig({
        fgColor: '#000000',
        bgColor: '#ffffff',
        eyeColor: '#000000',
        eyeFrameColor: '#000000',
        eyeBallColor: '#000000',
      });
    }
  }, [store]);

  const notifyUndo = useUndoToast();
  const handleResetDefault = useCallback(() => {
    store.updateConfig({
      fgColor: DEFAULT_CONFIG.fgColor,
      bgColor: DEFAULT_CONFIG.bgColor,
      eyeColor: DEFAULT_CONFIG.eyeColor,
      eyeFrameColor: undefined,
      eyeBallColor: undefined,
    });
    notifyUndo('Colors reset');
  }, [store, notifyUndo]);

  
  const handleRendered = useCallback((info: { moduleCount: number, virtualImageData?: ImageData, virtualImageBitmap?: ImageBitmap } = { moduleCount: 0 }) => {
    setPreviewFailure(null);
    if (info.moduleCount) setModuleCount(info.moduleCount);
    if (info.virtualImageBitmap) {
      checkScannability(undefined, info.virtualImageBitmap, info.moduleCount);
    } else if (info.virtualImageData) {
      checkScannability(info.virtualImageData, undefined, info.moduleCount);
    }
  }, [setModuleCount, checkScannability]);

  // Debounce the effective config for QRCanvas to prevent lag during rapid typing or style changes.
  const debouncedConfig = useLeadingDebounce(effectiveConfig, 100);

  /**
   * Returns focus to the button that started an export and reports the result: success
   * shows on the button itself and in the polite status region, errors raise a toast.
   */
  const handleExportResult = useCallback((result: ExportStatus, buttonRef: React.RefObject<HTMLButtonElement | null>, message: string) => {
    buttonRef.current?.focus();
    if (result.success) {
      if (result.fallbackTriggered) {
        addToast({ type: 'info', message: 'Sharing is not supported on this device/browser. The image will be downloaded instead.', duration: 5000 });
      }
      if (result.logoOmitted) {
        addToast({
          type: 'warning',
          message: 'The remote logo was omitted from the SVG export due to connection or security limits. Try uploading a local image file instead.',
          duration: 7000,
        });
      }
      if (result.format) setDone({ format: result.format, message });
      return;
    }
    // A cancelled picker or share sheet needs no message.
    if (result.error?.name === 'AbortError') return;
    addToast({
      type: 'error',
      message: result.error?.message || `Failed to export QR code as ${result.format || 'image'}.`,
      duration: 5000,
    });
  }, [addToast]);

  const exportWith = (target: ExportFormat, buttonRef: React.RefObject<HTMLButtonElement | null>, message: string) => {
    const run = async (options?: AssetOptions) => {
      const result = await exportAsset(target, { ...options, size: clampSize(size), filename });
      if (result.error?.name === SCAN_VALIDATION_ERROR && !options?.allowUnsafe) {
        // The finished image failed the scan check: offer the same choice as the pre-flight gate
        // instead of a raw error (#1255).
        setGateAction(() => () => run({ ...options, allowUnsafe: true }));
        setShowSafetyGate(true);
        return;
      }
      handleExportResult(result, buttonRef, message);
    };
    executeWithSafetyGate(run);
  };

  const onDownload = () => {
    lastDownload.format = format;
    lastDownload.size = clampSize(size);
    exportWith(format, downloadButtonRef, `${FORMAT_LABELS[format]} downloaded`);
  };
  const onCopy = () => exportWith('clipboard', copyButtonRef, 'Copied');
  const onCopySvg = () => exportWith('svg-copy', optionsButtonRef, 'SVG code copied');
  const onShare = () => exportWith('share', shareButtonRef, 'Shared');
  const copied = done?.format === 'clipboard';
  const commandActions = {
    download: (target: DownloadFormat) => exportWith(target, downloadButtonRef, `${FORMAT_LABELS[target]} downloaded`),
    copyImage: onCopy,
    copySvg: onCopySvg,
    share: canShare ? onShare : undefined,
    jumpToPreview: () => {
      document.getElementById(PREVIEW_ID)?.scrollIntoView?.({ block: 'start' });
      downloadButtonRef.current?.focus();
    },
  };

  const notifyExportsOff = () => {
    if (contentRefused) {
      addToast({ type: 'error', message: previewFailureMessage('blocked', config.errorCorrectionLevel), duration: 6000 });
      return;
    }
    addToast({
      type: 'info',
      message: `${EMPTY_CONTENT_MESSAGE} Exports are available once there is something to encode.`,
      duration: 5000,
    });
  };

  const executeWithSafetyGate = (action: (options?: AssetOptions) => void | Promise<void>) => {
    if (exportsOffReason) {
      notifyExportsOff();
      return;
    }
    if (previewFailure) {
      // There is no code to export: say why, with no "Export Anyway" (#1251).
      addToast({ type: 'error', message: previewFailureMessage(previewFailure, config.errorCorrectionLevel), duration: 6000 });
      return;
    }
    if (isDangerousUrl(config.value)) {
      // A script or data link is refused outright: no "Export Anyway" for it.
      addToast({ type: 'error', message: BLOCKED_EXPORT_MESSAGE, duration: 6000 });
      return;
    }
    if (getExportRiskPolicy({ status: scannabilityStatus, health }) === 'unsafe') {
      setGateAction(() => () => action({ allowUnsafe: true }));
      setShowSafetyGate(true);
    } else {
      action();
    }
  };

  return (
    <div className="w-full" id="top">
      <Modal isOpen={showSafetyGate} onClose={() => setShowSafetyGate(false)} title="Scan Safety Warning">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="size-12 text-warning" aria-hidden="true" />
          <p className="text-fg-soft">
            This QR code might fail to scan in real-world conditions. We recommend adjusting colors, pattern, or margin for better contrast.
          </p>
          <div className="mt-4 flex w-full gap-3">
             <Button variant="outline" fullWidth onClick={() => setShowSafetyGate(false)}>Go Back</Button>
             <Button variant="primary" fullWidth onClick={() => {
               setShowSafetyGate(false);
               if (gateAction) gateAction();
             }}>Export Anyway</Button>
          </div>
        </div>
      </Modal>
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
                     status={scannabilityStatus}
                     health={health}
                     errorCorrectionLevel={config.errorCorrectionLevel}
                     onFix={handleFix}
                     onResetDefault={handleResetDefault}
                   />
                   </div>
                </div>

                {workerRecoveryActive && (
                   <div className="mb-4">
                      <Alert variant="warning" title="System Warning">
                         A temporary background system error occurred. The validator has recovered and subsequent retries are active.
                      </Alert>
                   </div>
                )}

                {/* Preview stage: the QR is the largest thing on the page. */}
                <div className="mb-4 flex justify-center rounded-xl bg-surface-sunken p-3 md:p-2" data-testid="qr-stage">
                   {/* Pass debounced config to QRCanvas to prevent heavy rendering on every keystroke */}
                   <QRCanvas ref={canvasRef} onRendered={handleRendered} onRenderFailed={setPreviewFailure} config={debouncedConfig} className={`rounded-lg shadow-raised ${STAGE_SIZE_CLASSES[debouncedConfig.socialFormat] ?? STAGE_SIZE_CLASSES[SocialFormat.SQUARE_1_1]}`} />
                </div>

                {/* One export row. Below md it docks to the bottom of the screen as a sticky action bar. */}
                <div
                   ref={exportRowRef}
                   className={`fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-line bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-overlay backdrop-blur md:relative md:z-auto md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none ${inputFocused ? 'max-md:hidden' : ''}`}
                   data-testid="export-actions"
                >
                   <span role="status" className="sr-only">{done?.message ?? ''}</span>
                   <span
                     aria-hidden="true"
                     className={`size-2.5 shrink-0 rounded-full md:hidden ${STATUS_DOT_CLASSES[getScanVerdict({ status: scannabilityStatus, health }) ?? 'checking']}`}
                     data-testid="export-status-dot"
                   />
                   <Button
                      ref={downloadButtonRef}
                      variant={!exportsOffReason && getExportRiskPolicy({ status: scannabilityStatus, health }) === 'unsafe' ? 'error' : 'primary'}
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
                        filename={filename}
                        onFilenameChange={setCustomFilename}
                        onCopySvg={onCopySvg}
                        copySvgBusy={busyExport === 'svg-copy'}
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
                         <MockupView sourceRef={canvasRef} renderKey={debouncedConfig} config={effectiveConfig} moduleCount={moduleCount} view={previewView} exportsOffReason={exportsOffReason} guardExport={(run) => executeWithSafetyGate(() => run())} />
                      </Suspense>
                   )}
                </div>

                {/* Tertiary: playful side feature, after the export row. */}
                {!exportsOffReason && <StressTestButton />}
             </Card>
        }
      />
      <GeneratorCommands actions={commandActions} onDownload={onDownload} />
      <MiniPreview sourceRef={canvasRef} targetId={PREVIEW_ID} renderKey={debouncedConfig} />
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
