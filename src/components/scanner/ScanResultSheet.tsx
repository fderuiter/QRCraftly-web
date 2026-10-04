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

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Calendar,
  Check,
  Copy,
  Eye,
  EyeOff,
  CreditCard,
  FileSpreadsheet,
  Info,
  Link,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  QrCode,
  RefreshCw,
  Share2,
  Type,
  UserSquare2,
  Video,
  Wifi,
} from 'lucide-react';
import { QRType } from '@/types';
import { Button, ButtonLink } from '../ui/Button';
import { Badge } from '../ui/Badge';
import type { ScanDescription } from './describeScan';

const TYPE_ICONS: Record<QRType, React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  [QRType.URL]: Link,
  [QRType.TEXT]: Type,
  [QRType.WIFI]: Wifi,
  [QRType.EVENT]: Calendar,
  [QRType.EMAIL]: Mail,
  [QRType.VCARD]: UserSquare2,
  [QRType.PHONE]: Phone,
  [QRType.SMS]: MessageSquare,
  [QRType.PAYMENT]: CreditCard,
  [QRType.LOCATION]: MapPin,
  [QRType.MEETING]: Video,
  [QRType.SOCIAL]: Share2,
  [QRType.BULK_CSV]: FileSpreadsheet,
};

export interface ScanResultSheetProps {
  /** The decoded code. */
  scan: ScanDescription;
  /** Opens the content in the generator. Left out where there is no generator to open. */
  onEdit?: (scan: ScanDescription) => void;
  /** Label of the edit action. */
  editLabel?: string;
  /** Returns to the camera or image input for another code. */
  onScanAnother: () => void;
}

/** Whether the browser can share this text with the Web Share API. */
function canShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * The result of a scan: what the code holds, where a link really goes, and what to do with it
 * (#1101). A script or data address is blocked and offers Copy only.
 * @param props - Component properties.
 * @param props.scan - The decoded code.
 * @param props.onEdit - Opens the content in the generator.
 * @param props.editLabel - Label of the edit action.
 * @param props.onScanAnother - Starts another scan.
 * @returns The result sheet.
 */
export const ScanResultSheet: React.FC<ScanResultSheetProps> = ({ scan, onEdit, editLabel = 'Edit in generator', onScanAnother }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [revealed, setRevealed] = useState(false);
  const [shareSecret, setShareSecret] = useState(false);
  const Icon = scan.blocked ? Ban : TYPE_ICONS[scan.type];
  const { link } = scan;
  const cautions = link?.findings.filter((finding) => finding.severity === 'caution') ?? [];
  const notes = link?.findings.filter((finding) => finding.severity === 'info') ?? [];

  // Move focus to the result so keyboard and screen reader users land on it.
  useEffect(() => {
    headingRef.current?.focus();
    setRevealed(false);
    setShareSecret(false);
  }, [scan]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scan.text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const share = () => {
    navigator.share({ text: shareSecret ? scan.text : scan.shareText }).catch(() => undefined);
  };

  return (
    <section aria-labelledby="scan-result-title" className="flex flex-col gap-4 p-4 sm:p-6" data-testid="scan-result">
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
            scan.blocked ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'
          }`}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 id="scan-result-title" ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-fg outline-none">
            {scan.blocked ? 'Blocked QR code' : 'QR code found'}
          </h3>
          <Badge tone={scan.blocked ? 'danger' : 'brand'}>{scan.blocked ? 'Script link' : scan.typeLabel}</Badge>
        </div>
      </div>

      {scan.blocked && (
        <div className="flex gap-2 rounded-lg border border-danger-line bg-danger-soft p-3 text-sm text-danger" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            This code holds a script or data address that could run code in your browser, so it cannot be opened, shared or
            edited here. You can still copy the text to inspect it.
          </p>
        </div>
      )}

      {scan.cautions.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warning-line bg-warning-soft p-3 text-sm text-warning" aria-label="Cautions about this code">
          {scan.cautions.map((caution) => (
            <li key={caution} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {caution}
            </li>
          ))}
        </ul>
      )}

      {link && (
        <div className="rounded-lg border border-line bg-surface-sunken p-3">
          <p className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Opens</p>
          <p className="text-xl font-bold break-all text-fg" data-testid="scan-result-host">
            {link.host}
          </p>
          {link.findings.length === 0 && (
            <p className="mt-1 text-sm text-fg-muted">
              No warning signs found in the address. That is not a guarantee: check it is the site you expect before opening it.
            </p>
          )}
          {cautions.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-warning" aria-label="Cautions">
              {cautions.map((finding) => (
                <li key={finding.code} className="flex gap-1.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {finding.message}
                </li>
              ))}
            </ul>
          )}
          {notes.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-fg-muted" aria-label="Notes">
              {notes.map((finding) => (
                <li key={finding.code} className="flex gap-1.5">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {finding.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {scan.summary.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {scan.summary.map((row) => (
            <React.Fragment key={row.label}>
              <dt className="font-medium text-fg-muted">{row.label}</dt>
              <dd className="break-all text-fg">
                <bdi>{row.secret && !revealed ? '\u2022'.repeat(8) : row.value}</bdi>
              </dd>
            </React.Fragment>
          ))}
        </dl>
      )}

      {scan.hasSecret && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" aria-pressed={revealed} onClick={() => setRevealed((value) => !value)}>
            {revealed ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
            {revealed ? 'Hide the secret' : 'Show the secret'}
          </Button>
          {canShare() && !scan.blocked && (
            <label className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={shareSecret} onChange={(event) => setShareSecret(event.target.checked)} />
              Include the secret when sharing
            </label>
          )}
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase" id="scan-result-text-label">
          Content
        </p>
        <pre
          dir="auto"
          className="rounded-lg border border-line bg-surface p-3 font-mono text-sm break-all whitespace-pre-wrap text-fg"
          aria-labelledby="scan-result-text-label"
        >
          {revealed ? scan.revealedText : scan.displayText}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={scan.blocked || !link ? 'primary' : 'secondary'} size="sm" onClick={() => void copy()}>
          {copyState === 'copied' ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}
          {copyState === 'copied' ? 'Copied' : 'Copy'}
        </Button>
        {link && (
          <ButtonLink variant="primary" size="sm" href={link.href} target="_blank" rel="noopener noreferrer">
            <Link className="size-4" aria-hidden="true" />
            Open link
          </ButtonLink>
        )}
        {!scan.blocked && canShare() && (
          <Button variant="secondary" size="sm" onClick={share}>
            <Share2 className="size-4" aria-hidden="true" />
            Share
          </Button>
        )}
        {!scan.blocked && onEdit && (
          <Button variant="secondary" size="sm" onClick={() => onEdit(scan)}>
            <QrCode className="size-4" aria-hidden="true" />
            {editLabel}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onScanAnother}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Scan another
        </Button>
      </div>
      <p className="sr-only" role="status">
        {copyState === 'copied' ? 'Copied to the clipboard.' : ''}
      </p>
      {copyState === 'failed' && (
        <p className="text-sm text-danger" role="alert">
          The browser did not allow copying. Select the content above and copy it yourself.
        </p>
      )}
    </section>
  );
};
