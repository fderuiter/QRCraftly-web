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

import { useCallback, useEffect } from 'react';
import { QRConfig, TemplateStyle, SocialFormat } from '../types';
import { generateQRSvg, PayloadRejectedError, renderQRRaster, validateSvgScannability } from '@/packages/qr-export';
import { QrEncodeError } from '@/packages/qr-matrix';
import { describeViolation } from '@/packages/qr-payload';
import { previewFailureMessage, tooLongMessage } from '../utils/previewFailure';
import { useCapabilities } from './useCapabilities';
import { ExportOptions } from '../utils/exportRiskPolicy';
import { isDangerousUrl } from '../utils/security';

/**
 * Error-like check that also accepts `DOMException`s, which are not `Error` instances in
 * every runtime (jsdom).
 */
const isErrorLike = (value: unknown): value is Error =>
  typeof value === 'object' && value !== null && 'name' in value && 'message' in value;

/** Normalises a caught value so `ExportStatus.error` is always an `Error`. */
const toError = (err: unknown): Error => {
  if (isErrorLike(err)) return err;
  const error = new Error(String(err));
  // Keep the name of plain `{ name }` rejections so callers can still recognise an AbortError.
  if (typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string') {
    error.name = err.name;
  }
  return error;
};

export type { ExportOptions };

/** `Error.name` of an export refused because the code failed the scan check; it can be retried with `allowUnsafe`. */
export const SCAN_VALIDATION_ERROR = 'ScanValidationError';

/** The error an export returns when the finished image failed the scan check. */
const scanValidationFailed = (): Error => {
  const error = new Error('This QR code might fail to scan.');
  error.name = SCAN_VALIDATION_ERROR;
  return error;
};

/**
 * Turns an export failure into an error whose message can be shown to people: validation
 * codes and encoder errors become plain sentences instead of raw codes (#1255).
 */
const describeExportError = (err: unknown, config: QRConfig): Error => {
  if (err instanceof PayloadRejectedError) {
    return new Error(err.violations.map(describeViolation).join(' '));
  }
  if (err instanceof QrEncodeError) {
    return new Error(
      err.kind === 'too-long' ? tooLongMessage(config.errorCorrectionLevel) : previewFailureMessage('failed', config.errorCorrectionLevel)
    );
  }
  return toError(err);
};

/** Raster width used when the caller does not ask for a size. */
const DEFAULT_EXPORT_WIDTH = 1024;

/** Shown when an export is refused because the content is a script or data link. */
export const BLOCKED_EXPORT_MESSAGE = "This code contains a script or data link and can't be exported.";

/**
 * Hard export block for dangerous content. Unlike the scannability pre-flight it cannot be
 * bypassed with `allowUnsafe`, and it applies to every format, template and social layout.
 */
const blockedExport = (
  config: QRConfig,
  format: 'png' | 'jpeg' | 'webp' | 'svg' | 'eps' | 'pdf' | 'clipboard' | 'share',
): ExportStatus | null =>
  isDangerousUrl(config.value) ? { success: false, format, error: new Error(BLOCKED_EXPORT_MESSAGE) } : null;

/**
 * The export check and our QR reader (#1178) are loaded on demand rather than with the page.
 * The hook warms them up once the browser is idle, so a copy or share keeps its user gesture.
 */
const loadScannabilityCheck = () =>
  Promise.all([import('@/packages/scannability/checker'), import('@/packages/qr-decode').then(({ loadQrReader }) => loadQrReader())]).then(
    ([{ performScannabilityCheck }, reader]) => ({ performScannabilityCheck, reader })
  );

/** Loads the export check once the main thread is idle after the page has loaded. */
function warmScannabilityCheck(): () => void {
  const load = () => void loadScannabilityCheck().catch(() => undefined);
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(load, { timeout: 5000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(load, 2000);
  return () => window.clearTimeout(handle);
}

/** Export choices from the Download options, on top of the safety-gate options. */
export interface AssetOptions extends ExportOptions {
  /** Width in pixels of a raster export; defaults to 1024. */
  size?: number;
  /** File name without extension; defaults to `<type>-qr-code-qrcraftly-<date>`. */
  filename?: string;
}

/** Every export the hook performs. `svg-copy` copies the SVG markup as text. */
export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'svg' | 'eps' | 'pdf' | 'clipboard' | 'share' | 'svg-copy';

/**
 * Draws the code for `config` at `size` pixels wide for a raster export. It renders from the
 * configuration rather than copying the preview, so the file always matches the current content
 * (#1252) and is drawn at full resolution (#1256). JPEG has no transparency, so it is flattened
 * onto white (`#ffffff`).
 * @param config - The configuration to draw.
 * @param format - Export format ('jpeg', 'png', 'webp', etc.).
 * @param size - Target width in pixels.
 * @returns The canvas to export.
 */
async function renderExportCanvas(config: QRConfig, format: string, size?: number): Promise<HTMLCanvasElement> {
  const canvas = await renderQRRaster(config, size || DEFAULT_EXPORT_WIDTH);
  if (format !== 'jpeg' && format !== 'jpg') return canvas;

  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/**
 * Return type for the useQRDownload hook.
 */
export interface ExportStatus {
  /** Indicates whether the export operation succeeded. */
  success: boolean;
  /** Format of the exported asset. */
  format?: ExportFormat;
  /** Error object if export failed. */
  error?: Error;
  /** Indicates whether a fallback export mechanism was triggered. */
  fallbackTriggered?: boolean;
  /** Indicates whether remote logo was omitted during vector export. */
  logoOmitted?: boolean;
}

/**
 * Return type for the useQRDownload hook.
 */
export interface UseQRDownloadReturn {
  /** Unified seam for all asset exports. */
  exportAsset: (format: ExportFormat, options?: AssetOptions) => Promise<ExportStatus>;
  /** Downloads the canvas image to local device storage. */
  downloadToDevice: (format: 'png' | 'jpeg' | 'webp', options?: AssetOptions) => Promise<ExportStatus>;
  /** Opens native Save-As file picker if supported, with direct download fallback. */
  handleSaveAs: (format: 'png' | 'jpeg' | 'webp', options?: AssetOptions) => Promise<ExportStatus>;
  /** Generates and downloads vector SVG QR code. */
  handleSaveSvg: (options?: AssetOptions) => Promise<ExportStatus>;
  /** Generates and downloads vector EPS QR code. */
  handleSaveEps: (options?: AssetOptions) => Promise<ExportStatus>;
  /** Generates and downloads vector PDF QR code. */
  handleSavePdf: (options?: AssetOptions) => Promise<ExportStatus>;
  /** Shares QR code image via Web Share API. */
  handleShare: (options?: AssetOptions) => Promise<ExportStatus>;
  /** Copies QR code image to system clipboard. */
  handleCopy: (options?: AssetOptions) => Promise<ExportStatus>;
}

/**
 * Hook to handle downloading, sharing, and copying of the QR code.
 * Extracts this logic from the main component to reduce cognitive load.
 * @param config - Current QR configuration; raster and vector files are drawn from it.
 * @returns Object containing download and share handlers.
 */
export function useQRDownload(config: QRConfig): UseQRDownloadReturn {
  const { canSaveFilePicker, canShare } = useCapabilities();

  useEffect(() => warmScannabilityCheck(), []);

  /**
   * Validates the canvas readability against simulated optical noise.
   * Social templates and decorative poster frames bypass full-canvas matrix decode.
   */
  const validateScannability = useCallback(async (canvas: HTMLCanvasElement): Promise<boolean> => {
    if (config.templateStyle !== TemplateStyle.NONE || config.socialFormat !== SocialFormat.SQUARE_1_1) {
      return true;
    }
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { performScannabilityCheck, reader } = await loadScannabilityCheck();
      const result = performScannabilityCheck(reader, imageData, canvas.width, canvas.height);
      return result.success;
    } catch (err) {
      console.error('Scannability validation failed:', err);
      return false;
    }
  }, [config.templateStyle, config.socialFormat]);

  /**
   * Draws the export image and runs the scan check unless `allowUnsafe` is set.
   * @returns The canvas, or a failed status with a readable error.
   */
  const prepareRaster = useCallback(async (
    format: ExportFormat,
    renderFormat: 'png' | 'jpeg' | 'webp',
    options?: AssetOptions
  ): Promise<{ canvas: HTMLCanvasElement } | { status: ExportStatus }> => {
    let canvas: HTMLCanvasElement;
    try {
      canvas = await renderExportCanvas(config, renderFormat, options?.size);
    } catch (err) {
      return { status: { success: false, format, error: describeExportError(err, config) } };
    }
    if (!options?.allowUnsafe && !(await validateScannability(canvas))) {
      return { status: { success: false, format, error: scanValidationFailed() } };
    }
    return { canvas };
  }, [config, validateScannability]);

  /**
   * Helper function to normalize file extensions.
   * @param format - The image format ('png', 'jpeg', 'webp').
   * @returns The corresponding file extension (e.g., 'jpg' for 'jpeg').
   */
  const getExtension = (format: 'png' | 'jpeg' | 'webp') => {
    return format === 'jpeg' ? 'jpg' : format;
  };

  /**
   * Generates an SEO-friendly filename based on the current QR code type and date.
   * @param ext - The file extension.
   * @returns The generated filename string.
   */
  const getFilename = useCallback((ext: string, base?: string) => {
    const chosen = base?.replace(/[^\w.-]+/g, '-').slice(0, 80);
    if (chosen) return `${chosen}.${ext}`;
    const type = config.type.toLowerCase();
    const date = new Date().toISOString().split('T')[0];
    return `${type}-qr-code-qrcraftly-${date}.${ext}`;
  }, [config.type]);

  /**
   * Downloads the current QR code canvas content to the user's device.
   * Used as a fallback or direct action for saving to photos.
   * @param format - The desired image format.
   * @param options - Optional export options (e.g. allowUnsafe to bypass scannability pre-flight checks).
   */
  const downloadToDevice = useCallback(async (format: 'png' | 'jpeg' | 'webp', options?: AssetOptions): Promise<ExportStatus> => {
    const blocked = blockedExport(config, format);
    if (blocked) return blocked;
    const prepared = await prepareRaster(format, format, options);
    if ('status' in prepared) return prepared.status;
    try {
      const url = prepared.canvas.toDataURL(`image/${format}`);
      const link = document.createElement('a');
      const ext = getExtension(format);
      link.download = getFilename(ext, options?.filename);
      // nosemgrep: require-isdangerousurl -- a data URL drawn from our own canvas, never user text
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { success: true, format };
    } catch (err) {
      return { success: false, format, error: toError(err) };
    }
  }, [config, getFilename, prepareRaster]);

  /**
   * Handles saving the QR code image, attempting to use the File System Access API
   * for a native "Save As" experience, falling back to direct download if unsupported.
   * @param format - The desired image format.
   * @param options - Optional export options (e.g. allowUnsafe to bypass scannability pre-flight checks).
   */
  const handleSaveAs = useCallback(async (format: 'png' | 'jpeg' | 'webp', options?: AssetOptions): Promise<ExportStatus> => {
    const blocked = blockedExport(config, format);
    if (blocked) return blocked;
    const prepared = await prepareRaster(format, format, options);
    if ('status' in prepared) return prepared.status;
    const exportCanvas = prepared.canvas;

    // Check if the browser supports the File System Access API (e.g., Chrome, Edge Desktop)
    if (canSaveFilePicker) {
      try {
        const blob = await new Promise<Blob | null>((resolve) =>
          exportCanvas.toBlob(resolve, `image/${format}`)
        );

        if (!blob) throw new Error('Failed to create image blob');

        const ext = getExtension(format);

        if (!window.showSaveFilePicker) throw new Error('File System Access API unavailable');
        const handle = await window.showSaveFilePicker({
          suggestedName: getFilename(ext, options?.filename),
          types: [{
            description: 'QR Code Image',
            accept: { [`image/${format}`]: [`.${ext}`] },
          }],
        });

        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return { success: true, format };
      } catch (err) {
        // If user aborted the picker, return failure but identify abort.
        if (typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError') {
          return { success: false, format, error: toError(err) };
        }

        console.warn('File System Access API failed, falling back to standard download:', err);
        // The image already passed the scan check (or the person chose to export anyway).
        return downloadToDevice(format, { ...options, allowUnsafe: true });
      }
    } else {
      // Fallback for browsers that don't support showSaveFilePicker (Safari, Firefox, Mobile)
      return downloadToDevice(format, options);
    }
  }, [config, getFilename, downloadToDevice, canSaveFilePicker, prepareRaster]);

  /**
   * Copies the QR code image directly to the clipboard.
   * @param options - Optional export options (e.g. allowUnsafe to bypass scannability pre-flight checks).
   * @returns A boolean indicating if the copy operation was successful.
   */
  const handleCopy = useCallback(async (options?: AssetOptions): Promise<ExportStatus> => {
    const blocked = blockedExport(config, 'clipboard');
    if (blocked) return blocked;
    const prepared = await prepareRaster('clipboard', 'png', options);
    if ('status' in prepared) return prepared.status;
    const exportCanvas = prepared.canvas;

    try {
      const blob = await new Promise<Blob | null>((resolve) => exportCanvas.toBlob(resolve, 'image/png'));
      if (!blob) return { success: false, format: 'clipboard', error: new Error('Blob creation failed') };

      // Note: ClipboardItem is not supported in all browsers, but works in modern ones
      // We check for ClipboardItem to avoid throwing errors on older devices
      if (typeof ClipboardItem !== 'undefined') {
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);
        return { success: true, format: 'clipboard' };
      }
      return { success: false, format: 'clipboard', error: new Error('ClipboardItem not supported') };
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err);
      return { success: false, format: 'clipboard', error: toError(err) };
    }
  }, [config, prepareRaster]);

  /**
   * Uses the Web Share API to share the QR code image directly to other apps.
   * Falls back to downloading if sharing is not supported.
   * @param options - Optional export options (e.g. allowUnsafe to bypass scannability pre-flight checks).
   */
  const handleShare = useCallback(async (options?: AssetOptions): Promise<ExportStatus> => {
    const blocked = blockedExport(config, 'share');
    if (blocked) return blocked;
    const prepared = await prepareRaster('share', 'png', options);
    if ('status' in prepared) return prepared.status;
    const exportCanvas = prepared.canvas;

    return new Promise<ExportStatus>((resolve) => {
      exportCanvas.toBlob(async (blob) => {
        if (!blob) {
          resolve({ success: false, format: 'share', error: new Error('Blob creation failed') });
          return;
        }

        const file = new File([blob], getFilename('png', options?.filename ?? 'qrcode'), { type: 'image/png' });

        if (canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              title: 'QRCraftly Code',
              text: 'Here is a QR code I created with QRCraftly!',
              files: [file],
            });
            resolve({ success: true, format: 'share' });
          } catch (error) {
            console.log('Error sharing:', error);
            resolve({ success: false, format: 'share', error: toError(error) });
          }
        } else {
          // Fallback for devices that don't support sharing files
          const fallbackRes = await downloadToDevice('png', { ...options, allowUnsafe: true });
          resolve({ ...fallbackRes, format: 'share', fallbackTriggered: true });
        }
      }, 'image/png');
    });
  }, [config, downloadToDevice, canShare, prepareRaster, getFilename]);

  /**
   * Generates a vector SVG file from the current QR configuration and triggers
   * a download. The SVG embeds logos as inline base64 data-URLs for portability.
   * Before saving, the generated SVG XML is rendered to an offscreen canvas and
   * verified for scannability.
   * @param options - Optional export options (e.g. allowUnsafe to bypass scannability pre-flight checks).
   */
  const buildSvg = useCallback(async (options?: AssetOptions): Promise<{ svg: string; logoOmitted: boolean } | null> => {
    let logoOmitted = false;
    const svg = await generateQRSvg(config, {
      onLogoOmitted: () => {
        logoOmitted = true;
      },
    });
    if (!options?.allowUnsafe && !(await validateSvgScannability(svg, config, options))) return null;
    return { svg, logoOmitted };
  }, [config]);

  const handleSaveSvg = useCallback(async (options?: AssetOptions): Promise<ExportStatus> => {
    const blocked = blockedExport(config, 'svg');
    if (blocked) return blocked;
    try {
      const built = await buildSvg(options);
      if (!built) return { success: false, format: 'svg', error: scanValidationFailed() };

      const blob = new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = getFilename('svg', options?.filename);
      // nosemgrep: require-isdangerousurl -- a Blob URL made by URL.createObjectURL, never user text
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return { success: true, format: 'svg', logoOmitted: built.logoOmitted };
    } catch (err) {
      console.warn('SVG export failed:', err instanceof Error ? err.name : typeof err);
      return { success: false, format: 'svg', error: describeExportError(err, config) };
    }
  }, [buildSvg, getFilename, config]);

  /** Saves the code as a vector EPS or PDF file, built from the same SVG as the SVG download. */
  const saveVector = useCallback(async (format: 'eps' | 'pdf', options?: AssetOptions): Promise<ExportStatus> => {
    const blocked = blockedExport(config, format);
    if (blocked) return blocked;
    try {
      const built = await buildSvg(options);
      if (!built) return { success: false, format, error: scanValidationFailed() };

      const { convertSvgToEps, convertSvgToPdf } = await import('@/packages/qr-export');
      const blob =
        format === 'eps'
          ? new Blob([await convertSvgToEps(built.svg)], { type: 'application/postscript' })
          : new Blob([await convertSvgToPdf(built.svg)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = getFilename(format, options?.filename);
      // nosemgrep: require-isdangerousurl -- a Blob URL made by URL.createObjectURL, never user text
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return { success: true, format, logoOmitted: built.logoOmitted };
    } catch (err) {
      console.warn(`${format.toUpperCase()} export failed:`, err instanceof Error ? err.name : typeof err);
      return { success: false, format, error: describeExportError(err, config) };
    }
  }, [buildSvg, getFilename, config]);

  const handleSaveEps = useCallback((options?: AssetOptions) => saveVector('eps', options), [saveVector]);
  const handleSavePdf = useCallback((options?: AssetOptions) => saveVector('pdf', options), [saveVector]);

  /**
   * Copies the SVG markup to the clipboard as text, for pasting into design tools or code.
   * @param options - Optional export options.
   */
  const handleCopySvg = useCallback(async (options?: AssetOptions): Promise<ExportStatus> => {
    try {
      const built = await buildSvg(options);
      if (!built) return { success: false, format: 'svg-copy', error: scanValidationFailed() };
      await navigator.clipboard.writeText(built.svg);
      return { success: true, format: 'svg-copy', logoOmitted: built.logoOmitted };
    } catch (err) {
      return { success: false, format: 'svg-copy', error: describeExportError(err, config) };
    }
  }, [buildSvg, config]);

  /**
   * Unified QR export engine seam that coordinates all asset exports.
   * Evaluates scannability bypass policies, formats files, handles fallbacks,
   * and dispatches downloads/shares behind a single interface.
   * @param format - The target export format or sharing mechanism.
   * @param options - Optional export options (e.g. allowUnsafe to bypass scannability pre-flight checks).
   */
  const exportAsset = useCallback(
    async (format: ExportFormat, options?: AssetOptions): Promise<ExportStatus> => {
      switch (format) {
        case 'png':
        case 'jpeg':
        case 'webp':
          return options?.directDownload
            ? downloadToDevice(format, options)
            : handleSaveAs(format, options);
        case 'svg':
          return handleSaveSvg(options);
        case 'eps':
          return handleSaveEps(options);
        case 'pdf':
          return handleSavePdf(options);
        case 'clipboard':
          return handleCopy(options);
        case 'share':
          return handleShare(options);
        case 'svg-copy':
          return handleCopySvg(options);
        default:
          return { success: false, format, error: new Error(`Unsupported export format: ${format}`) };
      }
    },
    [downloadToDevice, handleSaveAs, handleSaveSvg, handleSaveEps, handleSavePdf, handleCopy, handleShare, handleCopySvg]
  );

  return { exportAsset, downloadToDevice, handleSaveAs, handleSaveSvg, handleSaveEps, handleSavePdf, handleShare, handleCopy };

}
