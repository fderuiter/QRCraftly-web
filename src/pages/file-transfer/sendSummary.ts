/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { useMemo } from 'react';
import { estimateTransferFrames, neededSymbols, type OuterCode, type TransferDensity } from '@/packages/optical-transfer';
import type { SenderFountainInfo } from '@/packages/optical-transfer/client';

export interface SendSummaryInput {
  selectedFiles: File[];
  density: TransferDensity;
  outerCode: OuterCode;
  fps: number;
  fountainInfo: SenderFountainInfo | null;
  totalFrames: number;
  currentFrameIndex: number;
  progress: number;
}

/**
 * What the send page says about the chosen files and the running stream: the size and label,
 * the estimate, the frames a receiver needs and the percent shown.
 * @returns The page's derived numbers.
 */
export function useSendSummary({ selectedFiles, density, outerCode, fps, fountainInfo, totalFrames, currentFrameIndex, progress }: SendSummaryInput) {
  const selectedFile = selectedFiles[0] ?? null;
  // Upper bound before compression: text-like files usually need far fewer frames.
  const selectedSize = useMemo(() => selectedFiles.reduce((sum, item) => sum + item.size, 0), [selectedFiles]);
  const selectedLabel = selectedFiles.length > 1 ? `${selectedFiles.length} files` : (selectedFile?.name ?? '');
  const estimate = useMemo(() => {
    if (!selectedFile) return null;
    try {
      return estimateTransferFrames(selectedSize, density, outerCode);
    } catch {
      return null;
    }
  }, [selectedFile, selectedSize, density, outerCode]);
  // Fountain streams never end: show frames against the typical number a receiver needs.
  const framesNeeded = fountainInfo ? neededSymbols(fountainInfo.k, fountainInfo.outerCode) : totalFrames;
  const senderPercent = fountainInfo
    ? Math.min(100, Math.round((currentFrameIndex / Math.max(1, framesNeeded)) * 100))
    : progress;
  // Seconds the stream takes: the exact need once a fountain session exists, an upper bound before.
  const estimatedSeconds = fountainInfo ? (fountainInfo.k * 1.15) / fps : estimate ? estimate.frames / fps : null;
  return { selectedSize, selectedLabel, estimate, framesNeeded, senderPercent, estimatedSeconds };
}
