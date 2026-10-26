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

import React, { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import type { VCardData } from '@/packages/qr-payload';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { mergeClasses } from '../ui/styles';

interface VCardFileImportProps {
  /** Receives every contact field read from the file; the card format stays as the form has it. */
  onImport: (fields: Omit<VCardData, 'version'>) => void;
}

/**
 * Fills the vCard form from a `.vcf` or `.vcard` file the person drops or picks (#1558). The file
 * is read on this device and never sent anywhere.
 * @param root0 - Component properties.
 * @param root0.onImport - Called with the fields of the file's first contact card.
 * @returns The drop zone, its file picker and the result message.
 */
export function VCardFileImport({ onImport }: VCardFileImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importedName, setImportedName] = useState<string | null>(null);

  const readFile = async (file: File) => {
    setImportedName(null);
    // The reader loads on the first file, so no page carries it in its first load.
    let reader: typeof import('@/packages/qr-payload/vcardFile');
    try {
      reader = await import('@/packages/qr-payload/vcardFile');
    } catch {
      setError("The contact file reader didn't load. Check your connection and try again.");
      return;
    }
    const { MAX_VCARD_FILE_BYTES, VCARD_FILE_ERROR_MESSAGES, readVCardFile } = reader;
    if (file.size > MAX_VCARD_FILE_BYTES) {
      setError(VCARD_FILE_ERROR_MESSAGES['too-large']);
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError(VCARD_FILE_ERROR_MESSAGES['not-a-vcard']);
      return;
    }
    const result = readVCardFile(text);
    if (!result.ok) {
      setError(VCARD_FILE_ERROR_MESSAGES[result.error]);
      return;
    }
    setError(null);
    setImportedName(file.name);
    onImport(result.fields);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear the picker so choosing the same file again reads it again.
    event.target.value = '';
    if (file) void readFile(file);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  };

  return (
    <div className="space-y-2">
      <div
        data-testid="vcard-drop-zone"
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={mergeClasses(
          'flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-4 text-center transition-colors',
          isDragging ? 'border-action bg-accent-soft' : 'border-line-strong bg-surface-sunken'
        )}
      >
        <p className="text-sm text-fg">Have a contact card already? Drop a .vcf file here to fill in the form.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()} className="flex items-center gap-2">
          <Upload className="size-4" aria-hidden="true" />
          Choose a .vcf file
        </Button>
        {/* Out of the tab order: the button above opens it. */}
        <input
          ref={inputRef}
          type="file"
          aria-label="Contact card file (.vcf)"
          accept=".vcf,.vcard,text/vcard,text/x-vcard"
          className="sr-only"
          tabIndex={-1}
          onChange={handleChange}
        />
        <p className="text-xs text-fg-muted">The file is read on this device. It is not uploaded.</p>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      <p role="status" className="text-xs text-fg-muted">
        {importedName ? `Filled in from ${importedName}. Check the fields before you download.` : ''}
      </p>
    </div>
  );
}
