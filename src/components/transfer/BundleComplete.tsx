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


import { useState } from 'react';
import { Check, File as FileIcon, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { analyseReceivedFile } from '@/utils/fileNames';
import { formatFileSize } from '@/utils/transferSpeed';

/** One received file, held in memory. */
export interface BundleItem {
  /** Cleaned path inside the bundle (`photos/a.jpg`). */
  name: string;
  mimeType: string;
  size: number;
  data: Uint8Array;
}

interface BundleCompleteProps {
  files: readonly BundleItem[];
  /** Saves one file under a bare name. */
  onSaveFile: (data: Uint8Array, fileName: string, mimeType: string) => void;
  /** Saves every file in one archive. */
  onSaveAll: () => void;
  onReceiveAnother: () => void;
}

/** The last path segment, which is the name a file is saved under on its own. */
const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * The finish of a multi-file receive: the list of files, each saved on its own (with the same
 * second look for risky types as a single file) or all together as a ZIP archive.
 * @param props - Component properties.
 * @param props.files - The verified files.
 * @param props.onSaveFile - Saves one file.
 * @param props.onSaveAll - Saves the archive.
 * @param props.onReceiveAnother - Clears and starts over.
 * @returns The completion panel.
 */
export function BundleComplete({ files, onSaveFile, onSaveAll, onReceiveAnother }: BundleCompleteProps) {
  // Index of a risky file whose save the person is confirming.
  const [confirming, setConfirming] = useState<number | null>(null);
  const total = files.reduce((sum, file) => sum + file.size, 0);

  const save = (index: number) => {
    const file = files[index];
    const analysis = analyseReceivedFile(baseName(file.name), file.mimeType);
    if (analysis.risky && confirming !== index) {
      setConfirming(index);
      return;
    }
    setConfirming(null);
    onSaveFile(file.data, analysis.safeName, analysis.mimeType);
  };

  return (
    <div className="flex size-full flex-col items-center gap-4 bg-surface-sunken p-6 text-center" data-testid="inline-complete-panel">
      <span className="flex size-16 items-center justify-center rounded-full bg-success-soft text-success motion-safe:animate-pop-in">
        <Check className="size-9" aria-hidden="true" />
      </span>
      <div>
        <h3 className="text-lg font-bold text-fg">Transfer Complete</h3>
        <p className="mt-1 text-xs text-fg-muted" data-testid="bundle-summary">
          {files.length} files, {formatFileSize(total)}. Every file arrived intact (SHA-256 verified).
        </p>
      </div>
      <Badge tone="success">
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        Checksums verified
      </Badge>
      <ul className="max-h-64 w-full max-w-sm space-y-2 overflow-y-auto text-left" data-testid="received-file-list">
        {files.map((file, index) => (
          <li key={file.name} className="rounded-lg border border-line bg-surface p-2 text-xs">
            <div className="flex items-center gap-2">
              <FileIcon className="size-4 shrink-0 text-accent" aria-hidden="true" />
              <span className="min-w-0 flex-1 font-semibold break-all text-fg" data-testid="received-file-name">
                {file.name}
              </span>
              <span className="shrink-0 font-mono text-fg-muted">{formatFileSize(file.size)}</span>
              <Button variant="outline" size="xs" onClick={() => save(index)} aria-label={`Save ${file.name}`}>
                {confirming === index ? 'Save anyway' : 'Save'}
              </Button>
            </div>
            {confirming === index && (
              <p role="alert" className="mt-2 text-fg-muted">
                This kind of file can run programs on your device. Only save it if you trust the sender.
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="primary" onClick={onSaveAll}>
          Save all (.zip)
        </Button>
        <Button variant="outline" onClick={onReceiveAnother}>
          Receive another file
        </Button>
      </div>
    </div>
  );
}
