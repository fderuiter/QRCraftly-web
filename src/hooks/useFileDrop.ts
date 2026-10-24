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

import { useRef, useState } from 'react';
import type React from 'react';

export interface FileDropOptions {
  /** Called with the dropped or picked files, never with an empty list. */
  onFiles: (files: File[]) => void;
  /** Types the file input offers, for example `video/*`. */
  accept?: string;
  /** Whether several files may be dropped or picked; otherwise only the first is taken. */
  multiple?: boolean;
  /** Ignores drops while true, for example during a transfer. */
  disabled?: boolean;
}

/**
 * Drag and drop plus a hidden file input for one drop zone. It owns the drag highlight, takes the
 * dropped or picked files, clears the input so the same file can be picked twice, and opens the
 * picker from a click or from Enter or Space.
 * @returns `isDragging`, the input's ref and props for the drop zone, the input and a browse button.
 */
export function useFileDrop({ onFiles, accept, multiple = false, disabled = false }: FileDropOptions) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const take = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? []);
    const picked = multiple ? files : files.slice(0, 1);
    if (picked.length > 0) onFiles(picked);
  };

  const onDragOver = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    event.dataTransfer.dropEffect = 'copy';
    setIsDragging(true);
  };

  const open = () => inputRef.current?.click();

  return {
    isDragging,
    inputRef,
    dropProps: {
      onDragEnter: onDragOver,
      onDragOver,
      onDragLeave: (event: React.DragEvent<HTMLElement>) => {
        // Moving onto a child fires dragleave on the zone itself; keep the highlight then.
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setIsDragging(false);
      },
      onDrop: (event: React.DragEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragging(false);
        if (disabled) return;
        if (inputRef.current) inputRef.current.value = '';
        take(event.dataTransfer.files);
      },
    },
    inputProps: {
      type: 'file',
      accept,
      multiple,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        take(event.target.files);
        // Cleared so picking the same file again still fires a change.
        event.target.value = '';
      },
    },
    browseProps: {
      role: 'button',
      tabIndex: 0,
      onClick: open,
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      },
    },
  };
}
