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
import { BadgeCheck, ExternalLink } from 'lucide-react';
import type { QRConfig } from '@/types';
import { buildGoogleSaveLink, describePassContent, isIssuerId, passColorsFrom, readServiceAccount, WalletPassError, type GoogleServiceAccount } from '@/packages/wallet-pass';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { TextField } from '../ui/TextField';
import { useToast } from '../ui/Toast';
import { FilePicker, type PickedFile } from './FilePicker';

interface GooglePassPanelProps {
  config: QRConfig;
  title: string;
  subtitle: string;
}

/**
 * Google Wallet passes with the person's own Google Wallet issuer (ADR 0048). The service-account
 * key is read into this tab only and the link is signed here. Opening the link sends the pass to
 * Google, so the panel asks first and says exactly what Google receives.
 * @param props - The content and the card text.
 * @returns The panel.
 */
export default function GooglePassPanel({ config, title, subtitle }: GooglePassPanelProps) {
  const [keyFile, setKeyFile] = useState<PickedFile[]>([]);
  const [account, setAccount] = useState<GoogleServiceAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuerId, setIssuerId] = useState('');
  const [issuerName, setIssuerName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    setAccount(null);
    setError(null);
    if (!keyFile.length) return;
    try {
      setAccount(readServiceAccount(new TextDecoder().decode(keyFile[0].bytes)));
    } catch (err) {
      setError(err instanceof WalletPassError ? err.message : 'This file could not be read.');
    }
  }, [keyFile]);

  const issuerOk = isIssuerId(issuerId);
  const ready = account !== null && issuerOk;

  const onOpen = async () => {
    if (!account) return;
    setBusy(true);
    try {
      const content = describePassContent(config, { title, subtitle });
      const { url } = await buildGoogleSaveLink(account, { issuerId, issuerName, content, colors: passColorsFrom(config) });
      // nosemgrep: require-isdangerousurl -- a fixed https://pay.google.com/ address plus our own base64url JWT
      window.open(url, '_blank', 'noopener,noreferrer');
      setConfirming(false);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The link could not be made.', duration: 6000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="google-pass-panel">
      <p className="text-sm text-fg-muted">
        With your own Google Wallet issuer you can make a Google Wallet pass. Load your service-account key and enter your Issuer ID. The key stays in this tab, is never uploaded, and is forgotten when
        you close this window.
      </p>
      <p className="text-sm text-fg-muted">
        <Badge tone="beta">Beta</Badge> Google Wallet passes are new: QRCraftly has not yet tried them with a real Google Wallet issuer on an Android phone, so save your pass to your own phone before you
        share it.
      </p>
      <FilePicker
        label="Service-account key"
        hint="The JSON key file from Google Cloud for the service account linked to your Google Wallet issuer."
        accept=".json,application/json"
        files={keyFile}
        onPick={setKeyFile}
      />
      <TextField label="Issuer ID" inputMode="numeric" value={issuerId} onChange={(event) => setIssuerId(event.target.value)} error={issuerId && !issuerOk ? 'Use the long number from the Google Pay & Wallet Console.' : undefined} />
      <TextField label="Business name (optional)" value={issuerName} maxLength={60} onChange={(event) => setIssuerName(event.target.value)} />
      {error && (
        <Alert variant="error" title="This key cannot sign a pass">
          {error}
        </Alert>
      )}
      {account && (
        <p className="flex items-start gap-2 text-sm text-fg-soft" data-testid="google-pass-ready">
          <BadgeCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
          <span>Ready to sign as {account.serviceAccountEmail}.</span>
        </p>
      )}
      {confirming ? (
        <div className="space-y-3">
          <Alert variant="info" title="This sends the pass to Google">
            Google Wallet receives everything on the pass, including the code&apos;s content (for example a WiFi password), and keeps it in the Google account that saves it. QRCraftly does not see it. While
            your issuer is in demo mode, only its test accounts can save the pass.
          </Alert>
          <div className="flex gap-2">
            <Button variant="outline" fullWidth onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="primary" fullWidth onClick={onOpen} loading={busy}>
              <ExternalLink className="size-4" aria-hidden="true" />
              Continue to Google Wallet
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="primary" fullWidth onClick={() => setConfirming(true)} disabled={!ready}>
          Save to Google Wallet
        </Button>
      )}
    </div>
  );
}
