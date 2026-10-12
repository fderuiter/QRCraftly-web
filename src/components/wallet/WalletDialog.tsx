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

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { type QRConfig, QRType } from '@/types';
import { renderWalletCard, walletRefusalReason, WALLET_CARD_TEXT_LIMITS, WALLET_CARD_SIZE } from '@/packages/qr-export';
import { hydrateWifiData } from '@/packages/qr-payload';
import { getQRTypeLabel } from '@/data/qrTypeLabels';
import { useDebounce } from '@/hooks/useDebounce';
import { useCapabilities } from '@/hooks/useCapabilities';
import { triggerFileDownload } from '@/utils/downloadManager';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { TextField } from '../ui/TextField';
import { Alert } from '../ui/Alert';
import { Skeleton } from '../ui/Skeleton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { useToast } from '../ui/Toast';

/**
 * Suggests a card title from the content: the network name of a WiFi code, the site of a link,
 * otherwise the type's name.
 * @param config - Current content.
 * @returns A short title.
 */
export function suggestWalletTitle(config: Pick<QRConfig, 'type' | 'value'>): string {
  try {
    if (config.type === QRType.WIFI) {
      const { ssid } = hydrateWifiData(config.value);
      if (ssid) return `WiFi: ${ssid}`;
    }
    if (config.type === QRType.URL) return new URL(config.value).hostname.replace(/^www\./, '');
  } catch {
    // Not a complete link or WiFi code yet.
  }
  return getQRTypeLabel(config.type);
}

// Signing code loads only when someone opens a pass tab.
const ApplePassPanel = lazy(() => import('./ApplePassPanel'));
const GooglePassPanel = lazy(() => import('./GooglePassPanel'));

/** What the dialog makes: the card image for everyone, or a signed pass with the person's own keys. */
type WalletMode = 'card' | 'apple' | 'google';

const MODES = [
  { value: 'card', label: 'Card image' },
  { value: 'apple', label: 'Apple Wallet pass' },
  { value: 'google', label: 'Google Wallet pass' },
] as const satisfies readonly { value: WalletMode; label: string }[];

/** Message shown when the card's own code fails the scan check. */
export const WALLET_SCAN_FAILED = 'The wallet card did not pass the scan check, so it was not saved. Try shorter content.';

/** Loads our QR reader and the export check on demand, as the other exports do. */
const loadScanCheck = () =>
  Promise.all([import('@/packages/scannability/checker'), import('@/packages/qr-decode').then(({ loadQrReader }) => loadQrReader())]).then(
    ([{ performScannabilityCheck }, reader]) => (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      return performScannabilityCheck(reader, ctx.getImageData(0, 0, canvas.width, canvas.height), canvas.width, canvas.height).success;
    }
  );

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('This browser could not make the image.'))), 'image/png');
  });
}

interface WalletDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** The content to put on the card. */
  config: QRConfig;
  /** File name without extension; the card adds `-wallet-card`. */
  filename: string;
}

/**
 * "Add to a phone wallet" (ADR 0047): a Wallet card image made on the device, with honest steps
 * for each phone. Nothing is sent anywhere.
 * @param props - The content, the file name and the dialog's open state.
 * @returns The dialog.
 */
export default function WalletDialog({ isOpen, onClose, config, filename }: WalletDialogProps) {
  const [title, setTitle] = useState(() => suggestWalletTitle(config));
  const [subtitle, setSubtitle] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<'download' | 'share' | null>(null);
  const [mode, setMode] = useState<WalletMode>('card');
  const { canShare } = useCapabilities();
  const { addToast } = useToast();
  const refusal = walletRefusalReason(config.type);
  const text = useDebounce(useMemo(() => ({ title, subtitle }), [title, subtitle]), 200);

  useEffect(() => {
    if (!isOpen || refusal || mode !== 'card') return;
    let cancelled = false;
    renderWalletCard(config, text)
      .then((canvas) => {
        if (!cancelled) setPreview(canvas.toDataURL('image/png'));
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, refusal, mode, config, text]);

  const makeCard = async (): Promise<Blob | null> => {
    try {
      const canvas = await renderWalletCard(config, { title, subtitle });
      const scans = await loadScanCheck();
      if (!scans(canvas)) {
        addToast({ type: 'error', message: WALLET_SCAN_FAILED, duration: 6000 });
        return null;
      }
      return await toPng(canvas);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The wallet card could not be made.', duration: 6000 });
      return null;
    }
  };

  const fileName = `${filename}-wallet-card.png`;

  const onDownload = async () => {
    setBusy('download');
    try {
      const blob = await makeCard();
      if (!blob) return;
      triggerFileDownload(new Uint8Array(await blob.arrayBuffer()), fileName, 'image/png');
      addToast({ type: 'success', message: 'Wallet card downloaded', duration: 3000 });
    } finally {
      setBusy(null);
    }
  };

  const onShare = async () => {
    setBusy('share');
    try {
      const blob = await makeCard();
      if (!blob) return;
      await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })] });
    } catch (err) {
      // A cancelled share sheet needs no message.
      if (!(err instanceof Error && err.name === 'AbortError')) {
        addToast({ type: 'error', message: 'The card could not be shared. Download it instead.', duration: 5000 });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add to a phone wallet">
      <div className="space-y-4 text-left" data-testid="wallet-dialog">
        {refusal ? (
          <Alert variant="info" title="No wallet card for this code">
            {refusal}
          </Alert>
        ) : (
          <>
            <TextField label="Title" value={title} maxLength={WALLET_CARD_TEXT_LIMITS.title} onChange={(event) => setTitle(event.target.value)} />
            <TextField label="Subtitle (optional)" value={subtitle} maxLength={WALLET_CARD_TEXT_LIMITS.subtitle} onChange={(event) => setSubtitle(event.target.value)} />
            <SegmentedControl<WalletMode>
              kind="tablist"
              label="What to make"
              options={MODES}
              value={mode}
              onChange={setMode}
              tabId={(value) => `wallet-tab-${value}`}
              controls={() => 'wallet-panel'}
            />
            <div id="wallet-panel" role="tabpanel" aria-labelledby={`wallet-tab-${mode}`} className="space-y-4">
            {mode === 'apple' ? (
              <Suspense fallback={<Skeleton className="h-48 w-full rounded-md" />}>
                <ApplePassPanel config={config} title={title} subtitle={subtitle} filename={filename} />
              </Suspense>
            ) : mode === 'google' ? (
              <Suspense fallback={<Skeleton className="h-48 w-full rounded-md" />}>
                <GooglePassPanel config={config} title={title} subtitle={subtitle} />
              </Suspense>
            ) : (
            <>
            <p className="text-sm text-fg-muted">
              This makes a card image with a plain black-and-white code that a wallet app can read. It is made on your device and is not sent anywhere.
            </p>
            <div className="flex justify-center rounded-lg border border-line bg-surface-sunken p-3">
              {preview ? (
                <img
                  src={preview}
                  width={WALLET_CARD_SIZE.width}
                  height={WALLET_CARD_SIZE.height}
                  alt="Preview of the wallet card"
                  className="h-64 w-auto rounded-md shadow-raised"
                  data-testid="wallet-card-preview"
                />
              ) : (
                <Skeleton className="h-64 w-36 rounded-md" />
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="primary" fullWidth onClick={onDownload} loading={busy === 'download'}>
                <Download className="size-4" aria-hidden="true" />
                Download card
              </Button>
              {canShare && (
                <Button variant="secondary" fullWidth onClick={onShare} loading={busy === 'share'}>
                  <Share2 className="size-4" aria-hidden="true" />
                  Share card
                </Button>
              )}
            </div>
            <div className="space-y-2 text-sm">
              <h3 className="font-semibold text-fg">How to add it</h3>
              <ul className="list-disc space-y-1.5 pl-5 text-fg-muted">
                <li>
                  <span className="font-medium text-fg-soft">Google Wallet (Android):</span> save the card, open Google Wallet, tap Add to Wallet, then Photo, and pick the card. Google keeps the pass in your Google account.
                </li>
                <li>
                  <span className="font-medium text-fg-soft">iPhone:</span> Apple Wallet cannot add a pass from a picture. Save the card to Photos and mark it as a favorite to find it quickly.
                </li>
                <li>
                  <span className="font-medium text-fg-soft">Other wallets:</span> if your wallet can add a pass from a photo or a barcode, use the card the same way.
                </li>
              </ul>
            </div>
            </>
            )}
            </div>
            <p className="text-xs text-fg-muted">Wallets draw their own plain copy of the code, so your colors, pattern and logo stay in your normal downloads.</p>
          </>
        )}
      </div>
    </Modal>
  );
}
