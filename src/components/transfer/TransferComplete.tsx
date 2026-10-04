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

import { useEffect, useMemo, useState } from 'react';
import { Check, File as FileIcon, FileArchive, FileImage, FileText, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatFileSize } from '@/utils/transferSpeed';
import { analyseReceivedFile } from '@/utils/fileNames';

/** Image types shown as a thumbnail. SVG is left out so no received markup is ever rendered. */
const THUMBNAIL_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
/** Types a browser tab shows safely. Anything else is saved instead. */
const OPENABLE_TYPES = new Set([...THUMBNAIL_TYPES, 'application/pdf', 'text/plain']);
/** How long an object URL made for Open stays valid. */
const OPEN_URL_LIFETIME_MS = 60_000;

interface TransferCompleteProps {
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** SHA-256 of the file, shown shortened. */
  sha256?: string;
  /** Whether the rebuilt file matched the sender's checksum. */
  verified: boolean;
  /** The file bytes, when kept in memory; enables the thumbnail and Open. */
  data?: Uint8Array | null;
  /** Whether the file was already saved once. */
  saved: boolean;
  onSave: () => void;
  onReceiveAnother: () => void;
}

/**
 * Picks the icon for a file type.
 * @param mimeType - MIME type of the file.
 * @returns The icon element.
 */
function fileTypeIcon(mimeType: string) {
  const className = 'size-7';
  if (mimeType.startsWith('image/')) return <FileImage className={className} aria-hidden="true" />;
  if (mimeType.startsWith('text/') || mimeType === 'application/pdf') return <FileText className={className} aria-hidden="true" />;
  if (/zip|tar|gzip|compressed/.test(mimeType)) return <FileArchive className={className} aria-hidden="true" />;
  return <FileIcon className={className} aria-hidden="true" />;
}

/**
 * The finish of a receive: a check that bursts out of the dots, then the file's name, size, type
 * and checksum badge with Open, Save and Receive another. Images show a thumbnail made from an
 * object URL, which never leaves the device.
 * @param props - Component properties.
 * @param props.fileName - File name from the sender.
 * @param props.fileSize - Size in bytes.
 * @param props.mimeType - MIME type from the sender.
 * @param props.sha256 - Checksum.
 * @param props.verified - Whether the checksum matched.
 * @param props.data - File bytes, if kept.
 * @param props.saved - Whether the file was already saved.
 * @param props.onSave - Saves the file.
 * @param props.onReceiveAnother - Clears and starts over.
 * @returns The completion panel.
 */
export function TransferComplete({ fileName, fileSize, mimeType: announcedType, sha256, verified, data, saved, onSave, onReceiveAnother }: TransferCompleteProps) {
  // The name and type come from whoever is showing the stream: show and save what is safe.
  const received = useMemo(() => analyseReceivedFile(fileName, announcedType), [fileName, announcedType]);
  const mimeType = received.mimeType;
  // Risky types need a second click: the first only opens the confirmation.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [fileName, announcedType]);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const showThumbnail = !!data && THUMBNAIL_TYPES.has(mimeType);
  const canOpen = !!data && OPENABLE_TYPES.has(mimeType);

  useEffect(() => {
    if (!showThumbnail || !data) {
      setThumbnail(null);
      return;
    }
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
    setThumbnail(url);
    return () => URL.revokeObjectURL(url);
  }, [showThumbnail, data, mimeType]);

  const save = () => {
    if (received.risky && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onSave();
  };

  const open = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), OPEN_URL_LIFETIME_MS);
  };

  return (
    <div className="flex size-full flex-col items-center justify-center gap-4 bg-surface-sunken p-6 text-center" data-testid="inline-complete-panel">
      <div className="relative flex size-16 items-center justify-center">
        <span aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-success motion-safe:animate-burst motion-reduce:hidden" />
        <span className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success motion-safe:animate-pop-in">
          <Check className="size-9" aria-hidden="true" />
        </span>
      </div>
      <div className="max-w-full min-w-0">
        <h3 className="text-lg font-bold text-fg">Transfer Complete</h3>
        {verified ? (
          <p className="mt-1 text-xs text-fg-muted">The file was rebuilt on this device and its SHA-256 checksum matches the sender’s.</p>
        ) : (
          <p className="mt-1 text-xs text-fg-muted">All parts were received. Your file is ready to save.</p>
        )}
      </div>
      <div className="flex w-full max-w-xs items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left" data-testid="received-file-summary">
        {thumbnail ? (
          <img src={thumbnail} alt="Preview of the received file" className="size-14 shrink-0 rounded-lg border border-line-subtle object-cover" />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-accent">
            {fileTypeIcon(mimeType)}
          </span>
        )}
        <dl className="min-w-0 flex-1 space-y-0.5 text-xs">
          <div className="flex gap-2">
            <dt className="sr-only">File</dt>
            <dd className="min-w-0 text-sm font-semibold break-all text-fg" data-testid="received-file-name">{received.safeName}</dd>
          </div>
          <div className="flex gap-2 text-fg-muted">
            <dt className="sr-only">Type</dt>
            <dd className="font-mono" data-testid="received-file-type">
              {received.extension ? `.${received.extension}` : 'no extension'}, {mimeType || 'unknown type'}
            </dd>
          </div>
          <div className="flex gap-2 text-fg-muted">
            <dt className="sr-only">Size</dt>
            <dd className="font-mono">{formatFileSize(fileSize)}</dd>
          </div>
          {sha256 && (
            <div className="flex gap-2 text-fg-muted">
              <dt>SHA-256</dt>
              <dd className="font-mono" title={sha256}>{`${sha256.slice(0, 8)}…${sha256.slice(-4)}`}</dd>
            </div>
          )}
        </dl>
      </div>
      {received.notices.length > 0 && (
        <ul className="max-w-xs space-y-1 text-left text-xs text-fg-muted" data-testid="received-file-notices">
          {received.notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}
      {confirming && (
        <div role="alert" className="max-w-xs rounded-lg border border-line-strong bg-surface p-3 text-left text-xs text-fg" data-testid="risky-file-confirmation">
          <p className="font-semibold">Save this {received.extension ? `.${received.extension}` : ''} file?</p>
          <p className="mt-1 text-fg-muted">This kind of file can run programs on your device. Only save it if you trust the sender.</p>
        </div>
      )}
      {verified && (
        <Badge tone="success">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Checksum verified
        </Badge>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {canOpen && (
          <Button variant="outline" onClick={open}>
            Open
          </Button>
        )}
        <Button variant={saved && !confirming ? 'outline' : 'primary'} onClick={save}>
          {confirming ? 'Save anyway' : saved ? 'Save again' : 'Save'}
        </Button>
        {confirming && (
          <Button variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        )}
        <Button variant="outline" onClick={onReceiveAnother}>
          Receive another file
        </Button>
      </div>
    </div>
  );
}
