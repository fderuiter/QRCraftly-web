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

import { useEffect, useRef } from 'react';
import { useQrEncoder } from '@/hooks/useQrEncoder';
import { buildMatrix, drawQR } from '@/packages/qr-matrix';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { QRErrorCorrectionLevel, QRStyle, QRType, type QRConfig } from '@/packages/core/types';

/** Display dimensions of the pairing QR canvas in logical CSS pixels. */
const PAIRING_QR_SIZE = 96;

export interface PairingGuideProps {
  /** Optional receiver URL override, defaults to fully qualified origin + /file-transfer/receive. */
  receiverUrl?: string;
}

/**
 * Resolves the fully qualified receiver URL for the bootstrap pairing QR code.
 * @param override - Optional explicit receiver URL.
 * @returns Fully qualified receiver URL.
 */
export function getReceiverUrl(override?: string): string {
  if (override) return override;
  if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') {
    return `${window.location.origin}/file-transfer/receive`;
  }
  return 'https://qrcraftly.com/file-transfer/receive';
}

/**
 * The pairing moment before a transfer starts: an active scannable QR code canvas containing
 * the receiver page URL, and fallback textual directions for manual navigation.
 * @param props - Pairing guide props.
 * @returns The pairing guide.
 */
export function PairingGuide({ receiverUrl }: PairingGuideProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const encoderLoad = useQrEncoder();
  const targetUrl = getReceiverUrl(receiverUrl);

  useEffect(() => {
    if (encoderLoad.status !== 'ready' || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    try {
      const modules = buildMatrix(
        {
          type: QRType.URL,
          value: targetUrl,
          errorCorrectionLevel: QRErrorCorrectionLevel.M,
        },
        encoderLoad.encoder
      );

      const config: QRConfig = {
        ...DEFAULT_CONFIG,
        type: QRType.URL,
        value: targetUrl,
        errorCorrectionLevel: QRErrorCorrectionLevel.M,
        fgColor: '#000000',
        bgColor: '#ffffff',
        eyeColor: '#000000',
        style: QRStyle.STANDARD,
        isBorderEnabled: false,
        frameStyle: 'none',
        isMazeEnabled: false,
        logoUrl: null,
        borderLogoUrl: null,
        backgroundImageUrl: null,
      };

      drawQR(ctx, modules, config, null, null, PAIRING_QR_SIZE);
    } catch (err) {
      console.warn('Failed to render pairing QR code:', err);
    }
  }, [encoderLoad, targetUrl]);

  return (
    <div className="mb-4 flex items-center gap-4 rounded-xl border border-line-subtle bg-surface-sunken p-4" data-testid="pairing-guide">
      <canvas
        ref={canvasRef}
        width={PAIRING_QR_SIZE}
        height={PAIRING_QR_SIZE}
        role="img"
        aria-label={`Pairing QR code to open receiver page at ${targetUrl}`}
        className="size-24 shrink-0 rounded-lg border border-line-subtle bg-surface shadow-xs"
        data-testid="pairing-qr-canvas"
      />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-fg">Point your other phone here</p>
        <p className="mt-0.5 text-xs text-fg-muted">
          On the other phone open <a href="/file-transfer/receive" className="font-medium text-accent underline-offset-2 hover:underline">Receive</a>, press Start camera, then press Start transfer here.
        </p>
      </div>
    </div>
  );
}
