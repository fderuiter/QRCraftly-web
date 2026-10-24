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

import { Upload } from 'lucide-react';
import type { useFileDrop } from '@/hooks/useFileDrop';
import { Button } from '@/components/ui/Button';
import { formatFileSize } from '@/utils/transferSpeed';
import { ClearProgressButton } from './ClearProgressButton';

export interface VideoPanelProps {
  videoFile: File | null;
  /** The drop zone, the click, Enter or Space to browse, and the file input, from `useFileDrop`. */
  drop: ReturnType<typeof useFileDrop>;
  /** Something was received or loaded, so Clear is offered. */
  canClear: boolean;
  onClear: () => void;
}

/**
 * Video mode's controls: the drop zone, the file picker and clear.
 * @returns The video controls.
 */
export function VideoPanel({ videoFile, drop, canClear, onClear }: VideoPanelProps) {
  const { isDragging, dropProps, browseProps, inputProps, inputRef } = drop;
  return (
    <div className="space-y-3">
      <div
        {...browseProps}
        {...dropProps}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
          isDragging
            ? 'border-accent bg-accent-soft'
            : 'border-line hover:border-accent'
        }`}
        data-testid="sidebar-dropzone"
      >
        <Upload className="mb-2 size-6 text-accent" />
        <p className="text-xs font-semibold text-fg-soft">
          {videoFile ? videoFile.name : 'Drop video file here or click to browse'}
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          {videoFile ? formatFileSize(videoFile.size) : 'MP4, WebM, MOV, etc.'}
        </p>
        <input
          {...inputProps}
          ref={inputRef}
          className="hidden"
          data-testid="video-file-input"
        />
      </div>

      <div className="flex gap-2">
        <Button
          variant="outline"
          fullWidth
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" />
          {videoFile ? 'Replace Video' : 'Select Video File'}
        </Button>
        {canClear && <ClearProgressButton onClear={onClear} />}
      </div>
    </div>
  );
}
