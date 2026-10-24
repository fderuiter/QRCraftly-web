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

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QRConfig } from '@/packages/core/types';
import { getScanAdvice, type ScanAdvice, type ScannabilityStatus } from '@/packages/scannability';
import { hydrateWifiData } from '@/packages/qr-payload';
import { QRType } from '@/packages/core/types';
import { exportBlockReason, exportDecision, type ExportAction, type ExportBlockReason } from '@/components/generator/decisions';
import { FORMAT_LABELS, clampSize, type DownloadFormat } from '@/components/ExportOptions';
import { useToast } from '@/components/ui/Toast';
import { previewFailureMessage, type PreviewFailure } from '@/utils/previewFailure';
import { useQRDownload, BLOCKED_EXPORT_MESSAGE, type AssetOptions, type ExportFormat } from './useQRDownload';
import type { HealthScore } from './useScannability';

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

/** Everything the export row can do. `copy-svg` copies the SVG markup as text. */
export type FlowAction = 'download' | 'copy' | 'copy-svg' | 'share' | 'wallet';

const FLOW_TARGETS: Record<Exclude<FlowAction, 'download' | 'wallet'>, { format: ExportFormat; message: string }> = {
  copy: { format: 'clipboard', message: 'Copied' },
  'copy-svg': { format: 'svg-copy', message: 'SVG code copied' },
  share: { format: 'share', message: 'Shared' },
};

export interface ExportFlowInput {
  /** The form's config, used for the safety checks, messages and the file name. */
  config: QRConfig;
  /** The config the export encodes. */
  effectiveConfig: QRConfig;
  isEmpty: boolean;
  refused: boolean;
  previewFailure: PreviewFailure | null;
  verdict: ScannabilityStatus;
  health: HealthScore | undefined;
}

/**
 * The generator's export flow: the safety gate, the busy and done states, the download options
 * and the wallet dialog. Every export goes through `exportBlockReason` and `exportDecision`.
 * Must be used within `QRProvider` and the toast provider.
 */
export function useExportFlow({ config, effectiveConfig, isEmpty, refused, previewFailure, verdict, health }: ExportFlowInput) {
  const { addToast } = useToast();
  const { exportAsset: runExport } = useQRDownload(effectiveConfig);

  // Focus returns to the button that started an export.
  const downloadButtonRef = useRef<HTMLButtonElement>(null);
  const copyButtonRef = useRef<HTMLButtonElement>(null);
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);

  const [gateOpen, setGateOpen] = useState(false);
  const [gateAction, setGateAction] = useState<(() => void | Promise<void>) | null>(null);

  // Which export is encoding right now; its button shows a loading state until it finishes.
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const exportAsset = useCallback(async (format: ExportFormat, options?: AssetOptions) => {
    setBusy(format);
    try {
      return await runExport(format, options);
    } finally {
      setBusy(null);
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
  const [colorSpace, setColorSpace] = useState<'rgb' | 'cmyk'>('rgb');
  const [customFilename, setCustomFilename] = useState<string | null>(null);
  const filename = customFilename ?? suggestFilename(config);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);

  const blockFor = (action: ExportAction): ExportBlockReason | null => exportBlockReason({
    config,
    refused,
    isEmpty,
    previewFailure,
    verdict: { status: verdict, health },
    action,
  });
  // Why every export is off, if it is: a refused field or an empty form.
  const offKind = blockFor('download')?.kind;
  const exportsOff = offKind === 'refused' || offKind === 'empty' ? offKind : undefined;

  const notifyExportsOff = () => {
    if (refused) {
      addToast({ type: 'error', message: previewFailureMessage('blocked', config.errorCorrectionLevel), duration: 6000 });
      return;
    }
    addToast({
      type: 'info',
      message: `${EMPTY_CONTENT_MESSAGE} Exports are available once there is something to encode.`,
      duration: 5000,
    });
  };

  /**
   * Whether this export may go ahead now. A refusal says why; a scan risk returns 'gate' so the
   * caller asks first.
   */
  const checkExport = (action: ExportAction): 'go' | 'gate' | 'refused' => {
    const block = blockFor(action);
    if (!block) return 'go';
    if (block.kind === 'scan-risk') return 'gate';
    if (block.kind === 'refused' || block.kind === 'empty') notifyExportsOff();
    else if (block.kind === 'preview-failure') addToast({ type: 'error', message: previewFailureMessage(block.failure, config.errorCorrectionLevel), duration: 6000 });
    else addToast({ type: 'error', message: BLOCKED_EXPORT_MESSAGE, duration: 6000 });
    return 'refused';
  };

  /** Runs an export after the checks, asking first through the safety gate when the code may not scan. */
  const guard = (exportAction: ExportAction, action: (options?: AssetOptions) => void | Promise<void>) => {
    const check = checkExport(exportAction);
    if (check === 'refused') return;
    if (check === 'gate') {
      setGateAction(() => () => action({ allowUnsafe: true }));
      setGateOpen(true);
    } else {
      action();
    }
  };

  /**
   * Returns focus to the button that started an export and reports the result: success
   * shows on the button itself and in the polite status region, errors raise a toast.
   */
  const exportWith = (target: ExportFormat, action: ExportAction, buttonRef: React.RefObject<HTMLButtonElement | null>, message: string) => {
    const run = async (options?: AssetOptions) => {
      const result = await exportAsset(target, { ...options, size: clampSize(size), filename, colorSpace });
      const decision = exportDecision(result, options?.allowUnsafe);
      if (decision.retryWithAllowUnsafe) {
        // The finished image failed the scan check: offer the same choice as the pre-flight gate
        // instead of a raw error (#1255).
        setGateAction(() => () => run({ ...options, allowUnsafe: true }));
        setGateOpen(true);
        return;
      }
      buttonRef.current?.focus();
      decision.toasts.forEach(addToast);
      if (decision.markDone && result.format) setDone({ format: result.format, message });
    };
    guard(action, run);
  };

  /**
   * Starts an export. A download with no `downloadFormat` uses the chosen format and size and
   * remembers them for the tab; one with a `downloadFormat` (from the command menu) does not.
   */
  const run = (action: FlowAction, downloadFormat?: DownloadFormat) => {
    if (action === 'wallet') {
      // The wallet card draws a plain black-on-white code, so the design's scan risk does not apply to it.
      if (checkExport('wallet') !== 'go') return;
      setOptionsOpen(false);
      setWalletOpen(true);
      return;
    }
    if (action === 'download') {
      const target = downloadFormat ?? format;
      if (!downloadFormat) {
        lastDownload.format = format;
        lastDownload.size = clampSize(size);
      }
      exportWith(target, 'download', downloadButtonRef, `${FORMAT_LABELS[target]} downloaded`);
      return;
    }
    const { format: target, message } = FLOW_TARGETS[action];
    const buttonRef = action === 'copy' ? copyButtonRef : action === 'share' ? shareButtonRef : optionsButtonRef;
    exportWith(target, action === 'share' ? 'share' : 'copy', buttonRef, message);
  };

  // The safety gate names the top problem and offers its one-tap fix, the same advice as the badge.
  const advice: ScanAdvice | null = gateOpen ? getScanAdvice({ status: verdict, health, errorCorrectionLevel: config.errorCorrectionLevel }) : null;

  return {
    run,
    guard,
    notifyExportsOff,
    exportsOff,
    downloadButtonRef,
    copyButtonRef,
    shareButtonRef,
    optionsButtonRef,
    gate: {
      open: gateOpen,
      advice,
      confirm: () => {
        setGateOpen(false);
        if (gateAction) gateAction();
      },
      cancel: () => setGateOpen(false),
    },
    status: { busy, done },
    options: {
      format,
      setFormat,
      size,
      setSize,
      colorSpace,
      setColorSpace,
      filename,
      setFilename: setCustomFilename,
      open: optionsOpen,
      setOpen: setOptionsOpen,
    },
    wallet: {
      open: walletOpen,
      close: () => {
        setWalletOpen(false);
        optionsButtonRef.current?.focus();
      },
    },
  };
}

/** Everything `useExportFlow` returns. */
export type ExportFlow = ReturnType<typeof useExportFlow>;
