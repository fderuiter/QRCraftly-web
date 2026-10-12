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

import { useEffect, useState } from 'react';
import { BadgeCheck, Download } from 'lucide-react';
import type { QRConfig } from '@/types';
import { buildApplePass, createPassSigner, describePassContent, passColorsFrom, WalletPassError, type PassSigner } from '@/packages/wallet-pass';
import { triggerFileDownload } from '@/utils/downloadManager';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { useToast } from '../ui/Toast';
import { renderPassImages } from './passImages';
import { FilePicker, type PickedFile } from './FilePicker';

/** The MIME type Safari and iOS open as a pass. */
const PKPASS_MIME_TYPE = 'application/vnd.apple.pkpass';

interface ApplePassPanelProps {
  config: QRConfig;
  title: string;
  subtitle: string;
  /** File name without extension. */
  filename: string;
}

/**
 * Signed Apple Wallet passes with the person's own Pass Type ID certificate (ADR 0048). The files
 * are read into this tab only, the key is imported so it cannot be read back, and everything is
 * forgotten when the dialog closes. Nothing is uploaded.
 * @param props - The content, the card text and the file name.
 * @returns The panel.
 */
export default function ApplePassPanel({ config, title, subtitle, filename }: ApplePassPanelProps) {
  const [certificates, setCertificates] = useState<PickedFile[]>([]);
  const [key, setKey] = useState<PickedFile[]>([]);
  const [signer, setSigner] = useState<PassSigner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { addToast } = useToast();

  // Load and check the files whenever both kinds are there; a newer choice wins over an older one.
  useEffect(() => {
    setSigner(null);
    setError(null);
    if (!certificates.length || !key.length) return;
    let current = true;
    createPassSigner({ certificateFiles: certificates.map((file) => file.bytes), privateKeyPem: new TextDecoder().decode(key[0].bytes) })
      .then((loaded) => {
        if (current) setSigner(loaded);
      })
      .catch((err: unknown) => {
        if (current) setError(err instanceof WalletPassError ? err.message : 'These files could not be loaded.');
      });
    return () => {
      current = false;
    };
  }, [certificates, key]);

  const onDownload = async () => {
    if (!signer) return;
    setBusy(true);
    try {
      const content = describePassContent(config, { title, subtitle });
      const colors = passColorsFrom(config);
      const { bytes } = await buildApplePass(signer, { content, colors, description: content.title, images: await renderPassImages(colors, config.logoUrl) });
      triggerFileDownload(bytes, `${filename}.pkpass`, PKPASS_MIME_TYPE);
      addToast({ type: 'success', message: 'Apple Wallet pass downloaded', duration: 3000 });
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The pass could not be made.', duration: 6000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="apple-pass-panel">
      <p className="text-sm text-fg-muted">
        With an Apple Developer account you can make a real Apple Wallet pass. Load your Pass Type ID certificate, Apple&apos;s WWDR intermediate and the private key. They stay in this tab, are
        never uploaded, and are forgotten when you close this window.
      </p>
      <p className="text-sm text-fg-muted">
        <Badge tone="beta">Beta</Badge> Apple Wallet passes are new: QRCraftly has not yet tried them with a real Apple certificate on an iPhone, so add your pass to your own phone before you share it.
      </p>
      <FilePicker
        label="Certificates"
        hint="Your Pass Type ID certificate and Apple's WWDR intermediate (.cer or .pem). Get the intermediate from apple.com/certificateauthority."
        accept=".cer,.crt,.pem,application/x-x509-ca-cert,application/x-pem-file"
        multiple
        files={certificates}
        onPick={setCertificates}
      />
      <FilePicker
        label="Private key"
        hint='A PEM key without a password. From a .p12 file, convert it first: "openssl pkcs12 -in pass.p12 -nodes -nocerts -out key.pem" (add -legacy for older files).'
        accept=".pem,.key,application/x-pem-file"
        files={key}
        onPick={setKey}
      />
      {error && (
        <Alert variant="error" title="These files cannot sign a pass">
          {error}
        </Alert>
      )}
      {signer && (
        <p className="flex items-start gap-2 text-sm text-fg-soft" data-testid="apple-pass-ready">
          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>
            Ready to sign as {signer.passTypeIdentifier} (team {signer.teamIdentifier}), valid until {signer.expires.toISOString().slice(0, 10)}.
          </span>
        </p>
      )}
      <Button variant="primary" fullWidth onClick={onDownload} loading={busy} disabled={!signer}>
        <Download className="size-4" aria-hidden="true" />
        Download Apple Wallet pass
      </Button>
    </div>
  );
}
