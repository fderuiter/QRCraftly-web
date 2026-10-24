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

import type React from 'react';
import { useRef } from 'react';
import { Camera, Play, Upload } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LockOnBrackets } from '@/components/transfer/LockOnBrackets';
import type { useFileDrop } from '@/hooks/useFileDrop';
import type { ScanCorners } from '@/packages/optical-scanner/client';

/**
 * The preview's drop target in video mode, before a video is chosen.
 * @returns The drop zone.
 */
function VideoDropTarget({ drop }: { drop: ReturnType<typeof useFileDrop> }) {
  const { isDragging, dropProps, browseProps } = drop;
  return (
    <div
      {...browseProps}
      {...dropProps}
      className={`flex size-full cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed p-6 text-center transition-colors ${
        isDragging
          ? 'border-teal-500 bg-teal-950/40 text-teal-300'
          : 'border-slate-800 text-slate-400 hover:border-teal-500 hover:text-slate-300'
      }`}
      data-testid="viewport-dropzone"
    >
      <Upload className="size-12 text-teal-500 opacity-50" />
      <div>
        <p className="text-sm font-semibold text-slate-200">Drop pre-recorded video here</p>
        <p className="mt-1 text-xs text-slate-400">or click to browse video files (MP4, WebM)</p>
      </div>
    </div>
  );
}

/**
 * Camera mode before the camera starts: a start button inside viewfinder corners.
 * @returns The empty state.
 */
function CameraOffState({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative size-full" data-testid="camera-empty-state">
      <EmptyState
        className="size-full"
        illustration={<Camera className="size-6" />}
        title="Camera is off"
        body="Start the camera, then point it at the animated QR on the sending screen."
        action={
          <Button variant="primary" onClick={onStart}>
            <Play className="size-4" aria-hidden="true" />
            Start camera
          </Button>
        }
      />
      {/* Viewfinder corners. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-6">
        <div className="absolute top-0 left-0 size-8 rounded-tl-lg border-t-4 border-l-4 border-accent" />
        <div className="absolute top-0 right-0 size-8 rounded-tr-lg border-t-4 border-r-4 border-accent" />
        <div className="absolute bottom-0 left-0 size-8 rounded-bl-lg border-b-4 border-l-4 border-accent" />
        <div className="absolute right-0 bottom-0 size-8 rounded-br-lg border-r-4 border-b-4 border-accent" />
      </div>
    </div>
  );
}

/**
 * The guide drawn over the video while scanning.
 * @returns The target overlay.
 */
function ScanTarget() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative size-64 rounded-3xl border-2 border-dashed border-teal-500/80 bg-transparent shadow-spotlight">
        <div className="absolute top-0 left-0 size-6 -translate-1 rounded-tl-lg border-t-4 border-l-4 border-teal-400" />
        <div className="absolute top-0 right-0 size-6 translate-x-1 -translate-y-1 rounded-tr-lg border-t-4 border-r-4 border-teal-400" />
        <div className="absolute bottom-0 left-0 size-6 -translate-x-1 translate-y-1 rounded-bl-lg border-b-4 border-l-4 border-teal-400" />
        <div className="absolute right-0 bottom-0 size-6 translate-1 rounded-br-lg border-r-4 border-b-4 border-teal-400" />
      </div>
    </div>
  );
}

export interface ReceiveViewportProps {
  receiverMode: 'camera' | 'file';
  scanning: boolean;
  /** A file or bundle is complete: the box grows to fit its view. */
  complete: boolean;
  /** The completion view, or null while nothing is finished. */
  completion: React.ReactNode;
  videoFile: File | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Corners of the code the camera read a moment ago, for the lock-on brackets. */
  lockOn: ScanCorners | null;
  drop: ReturnType<typeof useFileDrop>;
  onStartCamera: () => void;
}

/**
 * The receive page's viewport: a finished transfer, the video with its lock-on brackets while
 * scanning, the video drop target, or the camera that is off.
 * @returns The viewport box.
 */
export function ReceiveViewport({ receiverMode, scanning, complete, completion, videoFile, videoRef, lockOn, drop, onStartCamera }: ReceiveViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const live = scanning || (receiverMode === 'file' && videoFile);
  return (
    <div ref={viewportRef} className={`relative w-full overflow-hidden rounded-2xl ${receiverMode === 'camera' && !scanning && !complete ? '' : 'border border-line-subtle bg-slate-950'} ${complete ? '' : 'aspect-square'}`}>
      {completion ?? (live ? (
        <>
          <video
            ref={videoRef}
            className="size-full object-cover"
            playsInline
            muted
            loop
          />
          <LockOnBrackets containerRef={viewportRef} videoRef={videoRef} active={scanning} corners={lockOn} />
        </>
      ) : receiverMode === 'file' ? (
        <VideoDropTarget drop={drop} />
      ) : (
        <CameraOffState onStart={onStartCamera} />
      ))}

      {/* Target Frame Overlay */}
      {scanning && <ScanTarget />}
    </div>
  );
}
