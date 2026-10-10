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

import React, { useEffect, useId, useRef, useState } from 'react';
import { FileImage, RefreshCw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ScannabilityIndicator } from '@/components/ScannabilityIndicator';
import { ScanResultSheet } from '@/components/scanner/ScanResultSheet';
import type { ScanDescription } from '@/components/scanner/describeScan';
import { checkQrImage, type CheckOutcome } from '@/components/checker/checkImage';

interface QRCheckerProps {
  /** Opens the checked code in the generator. Left out where there is no generator to open. */
  onEdit?: (scan: ScanDescription) => void;
  /** Label of the edit action. */
  editLabel?: string;
}

/** Files with no type (some pickers and file managers) are tried anyway, as the scanner does. */
const mayBeImage = (file: File): boolean => file.type === '' || file.type.startsWith('image/');

const NOT_AN_IMAGE = 'Please choose an image, such as a photo or screenshot of the QR code.';

/**
 * Checks a picture of any QR code (#1036): choose, drop or paste an image and get what the code
 * holds, the real address of a link and a screen scan and print simulation verdict. The picture
 * is read in this browser and never leaves it.
 * @param props - Component properties.
 * @param props.onEdit - Opens the checked code in the generator.
 * @param props.editLabel - Label of the edit action.
 * @returns The checker.
 */
export const QRChecker: React.FC<QRCheckerProps> = ({ onEdit, editLabel = 'Open in generator' }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [working, setWorking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const helpId = useId();
  const errorId = useId();

  const check = async (file: File) => {
    const request = ++requestRef.current;
    setWorking(true);
    setError(null);
    try {
      const next = await checkQrImage(file);
      if (request !== requestRef.current) return;
      if (next.kind === 'unreadable') {
        // The result on screen belongs to the previous picture, so it makes way for the reason.
        setOutcome(null);
        setError(next.message);
      } else setOutcome(next);
    } catch {
      if (request === requestRef.current) {
        setOutcome(null);
        setError('This picture could not be read. Try a different file.');
      }
    } finally {
      if (request === requestRef.current) setWorking(false);
    }
  };

  /** Checks the first picture among the files, or says why nothing was checked (#1298). */
  const checkFiles = (files: FileList | readonly File[] | undefined | null) => {
    const list = [...(files ?? [])];
    if (list.length === 0) return;
    const image = list.find(mayBeImage);
    if (image) {
      void check(image);
      return;
    }
    requestRef.current += 1;
    setWorking(false);
    setError(NOT_AN_IMAGE);
  };
  const checkFilesRef = useRef(checkFiles);
  useEffect(() => {
    checkFilesRef.current = checkFiles;
  });

  // Ctrl/Cmd+V pastes a screenshot while the checker is on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => checkFilesRef.current(event.clipboardData?.files);
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const checkAnother = () => {
    setOutcome(null);
    setError(null);
  };

  const feedback = (
    <>
      {working && (
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-fg-soft">
          <RefreshCw className="size-4 text-accent motion-safe:animate-spin" aria-hidden="true" />
          Checking...
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="max-w-sm rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </>
  );

  if (outcome?.kind === 'read') {
    return (
      <div className="flex flex-col gap-4" data-testid="qr-checker">
        {feedback}
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-lg font-semibold text-fg">Scan check</h2>
          {outcome.status ? (
            <ScannabilityIndicator status={outcome.status} />
          ) : (
            <p className="text-sm text-fg-muted">This code holds a script or data address, so it is not tested for scanning.</p>
          )}
          <p className="mt-3 text-sm text-fg-muted">
            The picture was redrawn and checked on a screen and after a simulated print. A pass is a strong sign, not a promise: scan a printed copy with a
            phone before you print a batch.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <ScanResultSheet scan={outcome.scan} onEdit={onEdit} editLabel={editLabel} onScanAnother={checkAnother} />
        </div>
      </div>
    );
  }

  return (
    <section
      data-testid="qr-checker"
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onDragOver={(event) => {
        if (!event.dataTransfer?.types?.includes?.('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        checkFiles(event.dataTransfer.files);
      }}
      className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center ${
        dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface-sunken'
      }`}
    >
      <input
        type="file"
        accept="image/*"
        className="hidden"
        ref={fileInputRef}
        aria-label="Choose a picture of a QR code"
        onChange={(event) => {
          checkFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <FileImage className="size-10 text-fg-muted" aria-hidden="true" />
      <h2 id={titleId} className="text-base font-semibold text-fg">
        Check a QR code from a picture
      </h2>
      <p id={helpId} className="max-w-sm text-sm text-fg-muted">
        Choose a photo or screenshot, paste one with Ctrl+V or ⌘V, or drop it here. Any QR code works, even one made elsewhere. It never leaves this device.
      </p>
      <Button variant="primary" onClick={() => fileInputRef.current?.click()} aria-describedby={error ? errorId : undefined}>
        <Upload className="size-4" aria-hidden="true" />
        Choose picture
      </Button>
      {feedback}
    </section>
  );
};
