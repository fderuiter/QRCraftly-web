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

import React from 'react';
import { FileUp, FolderUp } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { formatFileSize } from '@/utils/transferSpeed';

/** `webkitdirectory` is not in React's input types; browsers that support it list the picked folder's files. */
const FOLDER_INPUT_PROPS: React.InputHTMLAttributes<HTMLInputElement> & { webkitdirectory: string } = { webkitdirectory: '' };

export interface SendDropZoneProps {
  /** Drag-and-drop handlers for the zone, from `useFileDrop`. */
  dropProps: React.HTMLAttributes<HTMLElement>;
  isDragging: boolean;
  inputRef: React.Ref<HTMLInputElement>;
  /** True while a stream starts or runs: the files cannot change. */
  disabled: boolean;
  /** What is chosen: one file's name or "N files"; empty for nothing. */
  selectedLabel: string;
  /** Bytes chosen, or null when nothing is. */
  selectedSize: number | null;
  /** Several files are chosen. */
  several: boolean;
  /** The browser can pick a folder. */
  folderSupported: boolean;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  /** Shown under the folder button, such as the development-only simulate button. */
  children?: React.ReactNode;
}

/**
 * Step 1 of the send page: the drop zone and file picker, the folder picker where the browser has
 * one, and the name and size of what is chosen.
 * @returns The file choice section's body.
 */
export function SendDropZone({ dropProps, isDragging, inputRef, disabled, selectedLabel, selectedSize, several, folderSupported, onChange, children }: SendDropZoneProps) {
  const folderInputRef = React.useRef<HTMLInputElement | null>(null);
  return (
    <>
      <div className="flex flex-col gap-3">
        <label
          {...dropProps}
          className={`flex min-h-24 w-full min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-3 transition-colors ${
            disabled
              ? 'cursor-not-allowed border-line bg-surface-sunken opacity-60'
              : isDragging
                ? 'cursor-copy border-accent bg-accent-soft'
                : 'cursor-pointer border-line bg-surface-sunken hover:bg-surface-hover'
          }`}
        >
          <FileUp className="size-6 text-fg-muted" aria-hidden="true" />
          <span className="max-w-full truncate text-xs font-medium text-fg-muted">
            {selectedSize !== null ? selectedLabel : 'Choose files or drag & drop'}
          </span>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            aria-label="Choose a file to send"
            multiple
            onChange={onChange}
            disabled={disabled}
          />
        </label>

        {folderSupported && (
          <>
            <Button variant="outline" onClick={() => folderInputRef.current?.click()} disabled={disabled} fullWidth>
              <FolderUp className="size-4" aria-hidden="true" />
              Send a folder
            </Button>
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              aria-label="Choose a folder to send"
              onChange={onChange}
              disabled={disabled}
              {...FOLDER_INPUT_PROPS}
            />
          </>
        )}

        {children}
      </div>

      {selectedSize !== null && (
        <div className="space-y-2 rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-fg-muted">{several ? 'Files:' : 'Name:'}</span>
            <span className="max-w-45 truncate font-semibold text-fg-soft">{selectedLabel}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-fg-muted">Size:</span>
            <span className="font-mono text-fg-soft">{formatFileSize(selectedSize)}</span>
          </div>
        </div>
      )}
    </>
  );
}
