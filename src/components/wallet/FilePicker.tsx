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

import { useRef } from 'react';
import { FileKey2 } from 'lucide-react';
import { Button } from '../ui/Button';

/** A file read into memory: its name and bytes. */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

interface FilePickerProps {
  label: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  files: PickedFile[];
  onPick: (files: PickedFile[]) => void;
}

/** A labelled "Choose file" button over a hidden file input, listing what was chosen. */
export function FilePicker({ label, hint, accept, multiple, files, onPick }: FilePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-fg-soft">{label}</p>
      <p className="text-xs text-fg-muted">{hint}</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
          <FileKey2 className="size-4" aria-hidden="true" />
          Choose {multiple ? 'files' : 'file'}
        </Button>
        <span className="truncate text-xs text-fg-muted">{files.length ? files.map((file) => file.name).join(', ') : 'None chosen'}</span>
      </div>
      <input
        ref={input}
        type="file"
        aria-label={label}
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        onChange={async (event) => {
          const chosen = Array.from(event.target.files ?? []);
          event.target.value = '';
          onPick(await Promise.all(chosen.map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }))));
        }}
      />
    </div>
  );
}
