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
import { Activity, Cpu } from 'lucide-react';
import { Progress } from '@/components/ui/Progress';

export interface TransferStatsProps {
  /** Percent of the first pass, or of the frames, shown so far. */
  percent: number;
  /** A fountain stream: frames count against the typical number a receiver needs. */
  fountain: boolean;
  currentFrameIndex: number;
  framesNeeded: number;
  totalFrames: number;
  currentPass: number;
  frameBufferMemory: string;
  /** The key panel of a private transfer, shown after the counters. */
  keyPanel?: React.ReactNode;
  /** The four words both screens show, or null. */
  fingerprint: string | null;
  /** What the back channel is doing, or null while it is off. */
  steerStatus: string | null;
}

/**
 * The running stream's numbers: progress, frames shown, the frame buffer, the transfer code and
 * what steering is doing.
 * @returns The stats panel.
 */
export function TransferStats({ percent, fountain, currentFrameIndex, framesNeeded, totalFrames, currentPass, frameBufferMemory, keyPanel, fingerprint, steerStatus }: TransferStatsProps) {
  return (
    <div className="mb-4 space-y-3 rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs" data-testid="sender-progress">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 font-medium text-fg-muted">
          <Activity className="size-3.5 text-accent" aria-hidden="true" /> {fountain ? 'First pass:' : 'Progress:'}
        </span>
        <span className="font-mono font-bold text-fg">{percent}%</span>
      </div>
      
      <Progress size="sm" label="Transfer progress" value={percent} />

      <div className="grid grid-cols-2 gap-4 pt-2">
        <div>
          <div className="text-fg-muted">{fountain ? 'Frames shown' : `Current QR (Pass ${currentPass})`}</div>
          <div className="font-mono text-sm font-semibold text-fg-soft" data-testid="sender-frames">
            {fountain ? `${currentFrameIndex} of ~${framesNeeded}` : `${currentFrameIndex} / ${totalFrames}`}
            {!fountain && (
              <span className="ml-1 text-xs text-accent">
                {currentPass === 1 ? '(Seq)' : '(Shuffled)'}
              </span>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-fg-muted">
            <Cpu className="size-3 text-accent" aria-hidden="true" /> Frame buffer
          </div>
          <div className="font-mono text-sm font-semibold text-fg-soft">{frameBufferMemory}</div>
        </div>
      </div>
      {keyPanel}
      {fingerprint !== null && (
        <p className="text-fg-muted" data-testid="sender-fingerprint">
          Transfer code <span className="font-mono font-semibold text-fg-soft">{fingerprint}</span>. The receiver shows the same four words once it has read the transfer details. If they differ, it is reading another device.
        </p>
      )}
      {steerStatus !== null && (
        <p className="text-fg-muted" role="status" data-testid="steer-status">
          {steerStatus}
        </p>
      )}
      {fountain && (
        <p className="text-fg-muted">
          The stream keeps going after the first pass so a receiver can join late or miss frames. Stop once the receiver shows Transfer Complete.
        </p>
      )}
    </div>
  );
}
