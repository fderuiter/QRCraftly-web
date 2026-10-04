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

import { useId } from 'react';
import { Progress } from '@/components/ui/Progress';

/** Most dots drawn; larger transfers group several chunks into one dot. */
const MAX_DOTS = 360;
const DOT_PITCH = 10;

interface ChunkConstellationProps {
  /** Number of chunks (or blocks) in the transfer. */
  total: number;
  /** How many have arrived, or which ones (legacy transfers know each index). */
  received: number | ReadonlySet<number>;
  /** Estimated seconds left, or null/undefined while unknown. */
  etaSeconds: number | null;
  /** Formats the ETA for display. */
  formatEta: (seconds: number | null) => string;
  /** What the dots are, for the accessible name: "Blocks decoded", "Parts received". */
  label: string;
}

/**
 * The transfer as a field of dots, one per chunk, that light up as chunks arrive so the file is
 * seen assembling. A big percentage and the time left sit beside it. Screen readers get a
 * progress bar and a status line that changes only at 25% steps, so they are not flooded.
 * @param props - Component properties.
 * @param props.total - Number of chunks.
 * @param props.received - Count received, or the set of received indices.
 * @param props.etaSeconds - Estimated seconds left.
 * @param props.formatEta - ETA formatter.
 * @param props.label - Accessible name of the progress.
 * @returns The constellation.
 */
export function ChunkConstellation({ total, received, etaSeconds, formatEta, label }: ChunkConstellationProps) {
  const labelId = useId();
  const count = typeof received === 'number' ? received : received.size;
  const safeTotal = Math.max(1, total);
  const percent = Math.min(100, Math.floor((count / safeTotal) * 100));
  const dots = Math.min(safeTotal, MAX_DOTS);
  const perDot = safeTotal / dots;
  const columns = Math.max(1, Math.ceil(Math.sqrt(dots * 2)));
  const rows = Math.ceil(dots / columns);
  const announced = Math.min(100, Math.floor(percent / 25) * 25);

  const lit = (dot: number): boolean => {
    if (typeof received === 'number') return dot < Math.round(received / perDot);
    // Legacy transfers know which parts arrived: a dot lights once every part it stands for is in.
    const first = Math.floor(dot * perDot);
    const last = Math.max(first, Math.ceil((dot + 1) * perDot) - 1);
    for (let index = first; index <= last; index++) if (!received.has(index)) return false;
    return true;
  };

  return (
    <div className="space-y-3" data-testid="chunk-constellation">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p id={labelId} className="text-xs font-medium text-fg-muted">
            {label}
          </p>
          <p className="font-mono text-4xl leading-none font-bold text-fg" data-testid="constellation-percent">
            {percent}%
          </p>
        </div>
        <p className="text-right text-xs text-fg-muted">
          Time left
          <span className="block font-mono text-sm font-semibold text-fg-soft" data-testid="constellation-eta">
            {formatEta(etaSeconds)}
          </span>
        </p>
      </div>
      <svg viewBox={`0 0 ${columns * DOT_PITCH} ${rows * DOT_PITCH}`} className="w-full rounded-lg bg-surface-sunken p-2" aria-hidden="true" data-testid="constellation-dots">
        {Array.from({ length: dots }, (_, dot) => (
          <circle
            key={dot}
            cx={(dot % columns) * DOT_PITCH + DOT_PITCH / 2}
            cy={Math.floor(dot / columns) * DOT_PITCH + DOT_PITCH / 2}
            r={3}
            data-lit={lit(dot) || undefined}
            className={lit(dot) ? 'fill-accent motion-safe:transition-colors' : 'fill-line'}
          />
        ))}
      </svg>
      <Progress size="sm" labelledBy={labelId} value={count} max={safeTotal} />
      <p role="status" className="sr-only">
        {announced > 0 ? `${label}: ${announced}%` : ''}
      </p>
    </div>
  );
}
