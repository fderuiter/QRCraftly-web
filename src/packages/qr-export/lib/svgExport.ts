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

import { QRConfig, TemplateStyle, SocialFormat } from '@/types';
import { SvgContext } from './svgContext';
import { drawWithTemplate, SOCIAL_DIMENSIONS } from './templateRenderer';
import { getQrTypeLabel, getQrTypeDescription } from '@/utils/a11y';

import { SafeUrlPipeline, normalizeUrl } from '@/utils/url';
import { getCachedAsset } from '@/utils/assetCache';
import { sanitizeSvg } from '@/utils/security';

import { validateConfig } from '@/packages/qr-payload';
import { buildMatrix, loadQrEncoder, type ModuleRenderOptions } from '@/packages/qr-matrix';
import { loadMosaicSource } from '@/packages/qr-matrix/mosaic';

/**
 * Converts an image URL to a base64 data-URL so it can be embedded inline in
 * the SVG, making the output file self-contained (no external HTTP requests).
 *
 * If the URL is already a data-URL it is returned as-is (if safe).
 * If conversion fails (e.g. CORS or network error) or the URL is dangerous,
 * it returns null so the image is safely omitted.
 */
async function toDataUrl(url: string): Promise<string | null> {
  if (!url) return null;

  // Synchronously retrieve from transparent in-memory cache if available
  const cached = getCachedAsset(url);
  if (cached) {
    return cached;
  }

  const normalized = normalizeUrl(url).toLowerCase();

  if (normalized.startsWith('data:')) {
    if (normalized.startsWith('data:image/')) {
      if (normalized.startsWith('data:image/svg+xml')) {
        try {
          const isBase64 = normalized.includes('base64');
          const commaIndex = url.indexOf(',');
          if (commaIndex !== -1) {
            const rawContent = url.substring(commaIndex + 1);
            let decoded = '';
            if (isBase64) {
              decoded = decodeURIComponent(escape(atob(rawContent)));
            } else {
              decoded = decodeURIComponent(rawContent);
            }
            const sanitized = sanitizeSvg(decoded);
            const base64 = btoa(unescape(encodeURIComponent(sanitized)));
            return `data:image/svg+xml;base64,${base64}`;
          }
        } catch {
          return null; // Omit if malformed
        }
      }
      return url;
    }
    return null;
  }

  if (url === 'xmlns="http://www.w3.org/2000/svg"') {
    return null;
  }

  if (SafeUrlPipeline.isDangerous(url)) {
    return null;
  }

  try {
    // The CSP (connect-src 'self') limits this to same-origin images.
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) return null;
    
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) return null;

    const isSvg = blob.type === 'image/svg+xml' || url.toLowerCase().split('?')[0].endsWith('.svg');

    if (isSvg) {
      const text = await blob.text();
      const sanitized = sanitizeSvg(text);
      const base64 = btoa(unescape(encodeURIComponent(sanitized)));
      return `data:image/svg+xml;base64,${base64}`;
    }

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(blob);
    });
  } catch {
    // Omit the image if it fails to load
    return null;
  }
}

/**
 * Creates a mock HTMLImageElement-like object with an `src` property.
 * This is what SvgContext.drawImage() reads from.
 */
function makeImgProxy(src: string | null): HTMLImageElement | null {
  if (!src) return null;
  return { src } as unknown as HTMLImageElement;
}

/** Thrown by {@link generateQRSvg} when the payload fails validation; `violations` holds the codes. */
export class PayloadRejectedError extends Error {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`QR payload rejected: ${violations.join(', ')}`);
    this.name = 'PayloadRejectedError';
    this.violations = violations;
  }
}

/**
 * Generates a fully self-contained SVG string that visually matches the QR
 * code that would be rendered to a canvas with the same configuration.
 *
 * When a social format or template is configured the SVG uses the standard
 * high-resolution dimensions (e.g. 1080 × 1920 for Story/9:16) and routes
 * rendering through {@link drawWithTemplate} so the template background and
 * text are included.
 *
 * Logos (both center and border) are fetched and embedded as base64 data-URLs
 * so the resulting `.svg` file works without an internet connection.
 *
 * The payload is validated first (`validateConfig`); a failing payload rejects with
 * {@link PayloadRejectedError}. Set `skipPayloadValidation` only for trusted internal callers.
 *
 * @param config  The QR code configuration.
 * @returns A promise that resolves to the SVG XML string.
 */
export async function generateQRSvg(
  config: QRConfig,
  options?: { onLogoOmitted?: () => void; renderOptions?: ModuleRenderOptions; skipPayloadValidation?: boolean }
): Promise<string> {
  // Defence in depth: no caller can render an unvalidated payload unless it opts out explicitly.
  if (!options?.skipPayloadValidation) {
    const violations = validateConfig(config);
    if (violations.length > 0) {
      throw new PayloadRejectedError(violations);
    }
  }

  // The encoder is loaded lazily so `qrcode` stays out of the main bundle.
  const modules = buildMatrix(config, await loadQrEncoder());
  const moduleCount = modules.size;

  // Pre-resolve logo images to inline data-URLs
  const isRemoteLogo = (url?: string | null) => !!url && !url.toLowerCase().startsWith('data:');
  const hasRemoteLogo = isRemoteLogo(config.logoUrl);
  const hasRemoteBorderLogo = config.isBorderEnabled && isRemoteLogo(config.borderLogoUrl);

  const logoDataUrl = config.logoUrl ? await toDataUrl(config.logoUrl) : null;
  const logoImg = logoDataUrl ? makeImgProxy(logoDataUrl) : null;

  const borderLogoDataUrl = config.isBorderEnabled && config.borderLogoUrl
    ? await toDataUrl(config.borderLogoUrl)
    : null;
  const borderLogoImg = borderLogoDataUrl ? makeImgProxy(borderLogoDataUrl) : null;

  const logoOmitted = (hasRemoteLogo && !logoDataUrl) || (hasRemoteBorderLogo && !borderLogoDataUrl);
  if (logoOmitted && options?.onLogoOmitted) {
    options.onLogoOmitted();
  }

  // Decode the Mosaic QR image (if any) so the renderer can tile it into the modules
  if (config.mosaicImageUrl) {
    await loadMosaicSource(config.mosaicImageUrl);
  }

  // Determine output dimensions from the social format (canonical resolution)
  const { width: svgWidth, height: svgHeight } = SOCIAL_DIMENSIONS[config.socialFormat] || { width: 1080, height: 1080 };

  // Resolve metadata for accessibility
  const title = `${getQrTypeLabel(config.type)} QR Code`;
  const description = getQrTypeDescription(config.type, config.value);

  // Create SVG context and render with title and description metadata
  const ctx = new SvgContext(svgWidth, svgHeight, title, description);

  try {
    drawWithTemplate(
      ctx as unknown as CanvasRenderingContext2D,
      modules,
      config,
      logoImg,
      borderLogoImg,
      svgWidth,
      svgHeight,
      moduleCount,
      true,
      null,
      options?.renderOptions
    );
  } catch (err) {
    console.warn('SVG QR generation failed:', err);
    throw err;
  }

  return sanitizeSvg(ctx.serialize());
}

/** Upper bound for an SVG blob image to load before rasterization is abandoned. */
const SVG_RASTER_LOAD_TIMEOUT_MS = 10_000;

/**
 * Draws an SVG XML payload string onto an offscreen canvas element on the main thread.
 *
 * @param svgString - The generated SVG XML payload string.
 * @param width - The canvas width in pixels.
 * @param height - The canvas height in pixels.
 * @returns A Promise resolving to an offscreen HTMLCanvasElement containing the drawn SVG.
 */
export function rasterizeSvgToCanvas(
  svgString: string,
  width: number = 1000,
  height: number = 1000
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Canvas rasterization requires DOM environment'));
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to obtain 2D canvas context'));
      return;
    }

    const img = new Image();
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    let handled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (watchdog !== undefined) clearTimeout(watchdog);
      try {
        URL.revokeObjectURL(url);
      } catch {}
    };

    const draw = () => {
      if (handled) return;
      handled = true;
      try {
        ctx.drawImage(img, 0, 0, width, height);
        cleanup();
        resolve(canvas);
      } catch (err) {
        cleanup();
        reject(err);
      }
    };

    const fail = (reason: unknown) => {
      if (handled) return;
      handled = true;
      cleanup();
      reject(reason instanceof Error ? reason : new Error('Failed to load SVG image for rasterization'));
    };

    // Only draw once the image has actually loaded; drawing earlier yields a blank canvas
    // that falsely fails the scannability check for large SVGs or SVGs with logos (#969).
    img.onload = draw;
    img.onerror = fail;
    img.src = url;

    if (img.complete && img.naturalWidth > 0) {
      // Already decoded (e.g. served from the image cache): draw now; the handled guard ignores the later onload.
      draw();
      return;
    }

    // jsdom never fetches or decodes image resources, so onload would never fire there.
    // Rasterize immediately so unit tests exercise the canvas pipeline with their mocked context.
    const isJsdom = typeof window !== 'undefined' && window.navigator?.userAgent?.includes('jsdom') === true;
    if (isJsdom) {
      setTimeout(draw, 0);
      return;
    }

    // Real browsers: fail loudly instead of hanging forever if the image never settles
    // (for example when a Content Security Policy blocks the blob: URL without firing onerror).
    watchdog = setTimeout(() => fail(new Error('Timed out waiting for SVG image to load')), SVG_RASTER_LOAD_TIMEOUT_MS);
  });
}

/**
 * Validates the scannability of an SVG XML payload string by rasterizing it onto an offscreen canvas
 * and running standard QR decoding and optical checks on the pixel data.
 *
 * @param svgString - The generated SVG XML payload string.
 * @param config - The QR code configuration.
 * @param options - Optional export options, such as allowUnsafe to bypass scannability checks.
 * @returns A promise resolving to true if the SVG offscreen raster is scannable or bypass is allowed, false otherwise.
 */
export async function validateSvgScannability(
  svgString: string,
  config: QRConfig,
  options?: { allowUnsafe?: boolean }
): Promise<boolean> {
  if (options?.allowUnsafe) {
    return true;
  }

  if (config.templateStyle !== TemplateStyle.NONE || config.socialFormat !== SocialFormat.SQUARE_1_1) {
    return true;
  }

  const dimensions = SOCIAL_DIMENSIONS[config.socialFormat] || { width: 1000, height: 1000 };
  const canvas = await rasterizeSvgToCanvas(svgString, dimensions.width, dimensions.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const [{ performScannabilityCheck }, { loadQrReader }] = await Promise.all([
    import('@/packages/scannability/checker'),
    import('@/packages/qr-decode'),
  ]);
  const result = performScannabilityCheck(await loadQrReader(), imageData, canvas.width, canvas.height);
  return result.success;
}

