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

import { Cpu, ScanLine } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChunkConstellation } from '@/components/transfer/ChunkConstellation';
import { formatDuration, type FountainTelemetry, type PrismManifestInfo } from '@/packages/optical-transfer';
import { formatFileSize } from '@/utils/transferSpeed';

/** The announced transfer, with its first file and that file's sanitised name. */
export type AnnouncedTransfer = PrismManifestInfo & {
  file: PrismManifestInfo['files'][number] | null;
  safeName: string | null;
};

/**
 * What the sender announced, before any data is decoded, with the code to compare on both screens.
 * @returns The manifest card.
 */
function ManifestInfo({ announced }: { announced: AnnouncedTransfer }) {
  return (
    <div className="space-y-2 rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs" data-testid="manifest-info">
      <p className="text-fg-muted">The sender is sending</p>
      <p className="text-sm font-semibold break-all text-fg" data-testid="manifest-name">
        {announced.encrypted
          ? 'A private transfer'
          : announced.safeName ?? (announced.entryCount > 0 ? `${announced.entryCount} files` : 'Several files')}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-fg-muted">
        <dt>Size</dt>
        <dd className="font-mono text-fg-soft" data-testid="manifest-size">{announced.encrypted ? 'hidden' : formatFileSize(announced.totalSize)}</dd>
        <dt>Type</dt>
        <dd className="font-mono break-all text-fg-soft" data-testid="manifest-type">
          {announced.encrypted ? 'hidden' : announced.file ? announced.file.mimeType || 'unknown' : 'several files'}
        </dd>
        <dt>Transfer code</dt>
        <dd className="font-mono text-fg-soft" data-testid="manifest-fingerprint">{announced.fingerprint}</dd>
      </dl>
      <p className="text-fg-muted">The transfer code matches the one on the sender&apos;s screen. If it does not, you are reading someone else&apos;s stream.</p>
    </div>
  );
}

/**
 * The decode's numbers: blocks decoded, frames scanned, scan rate and time left.
 * @returns The telemetry card.
 */
function FountainStats({ stats }: { stats: FountainTelemetry }) {
  return (
    <div className="space-y-4 rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs" data-testid="fountain-telemetry">
      <ChunkConstellation total={stats.k} received={stats.rank} etaSeconds={stats.etaSeconds} formatEta={(seconds) => formatDuration(seconds, 'eta')} label="Blocks decoded" />

      <dl className="grid grid-cols-2 gap-4 pt-2">
        <div>
          <dt className="text-fg-muted">Frames scanned</dt>
          <dd className="font-mono text-sm font-semibold text-fg-soft" data-testid="fountain-droplets">
            {stats.dropletsReceived}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Blocks decoded</dt>
          <dd className="font-mono text-sm font-semibold text-fg-soft" data-testid="fountain-rank">
            {stats.rank} / {stats.k}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Scan rate</dt>
          <dd className="font-mono text-sm font-semibold text-fg-soft" data-testid="fountain-fps">
            {stats.fps.toFixed(1)} fps
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Time left</dt>
          <dd className="font-mono text-sm font-semibold text-fg-soft" data-testid="fountain-eta">
            {formatDuration(stats.etaSeconds, 'eta')}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export interface ReceiveTelemetryProps {
  /** What the file is being checked for, while it is. */
  compilationStatus: string | null;
  /** Parts seen of a wallet-style stream, while one is read. */
  bcurProgress: { received: number; total: number } | null;
  bcurDone: boolean;
  announced: AnnouncedTransfer | null;
  complete: boolean;
  fountainStats: FountainTelemetry | null;
}

/**
 * Section 2 of the receive page: the check in progress, a wallet stream's parts, what the sender
 * announced, and the decode's numbers, or the empty state before anything is in view.
 * @returns The progress section's body.
 */
export function ReceiveTelemetry({ compilationStatus, bcurProgress, bcurDone, announced, complete, fountainStats }: ReceiveTelemetryProps) {
  return (
    <>
      {compilationStatus && (
        <div className="flex items-center gap-2 rounded-xl border border-accent-line bg-accent-soft p-4 text-xs text-accent motion-safe:animate-pulse" data-testid="compilation-status">
          <Cpu className="size-4 text-accent motion-safe:animate-spin" />
          <span className="font-semibold">{compilationStatus}</span>
        </div>
      )}

      {bcurProgress && !bcurDone && (
        <p className="rounded-xl border border-line-subtle bg-surface-sunken p-4 text-xs text-fg-muted" role="status" data-testid="bcur-progress">
          Reading a wallet-style (BC-UR) stream: {bcurProgress.received} of {bcurProgress.total} parts seen.
        </p>
      )}

      {announced && !complete && <ManifestInfo announced={announced} />}

      {fountainStats ? (
        <FountainStats stats={fountainStats} />
      ) : !announced ? (
        <EmptyState
          illustration={<ScanLine className="size-6" />}
          title="Ready to scan"
          body="Start an animated QR file transfer from the sender."
        />
      ) : null}
    </>
  );
}
