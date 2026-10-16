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
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ArcadeCockpit } from './ArcadeCockpit';

interface ArcadeSkeletonProps {
  /** Target settings panel element (or null to render a skeleton settings panel). */
  settings?: React.ReactNode;
}

/**
 * Responsive loading skeleton for the Arcade Studio that matches the dimensions
 * of ArcadeCockpit to prevent layout shifts while the QR encoder WASM module loads.
 */
export function ArcadeSkeleton({ settings }: ArcadeSkeletonProps) {
  return (
    <ArcadeCockpit
      settings={
        settings ?? (
          <Card variant="control" className="h-64">
            <Skeleton className="size-full" />
          </Card>
        )
      }
      arsenal={
        <Card variant="control" className="space-y-3">
          <Skeleton className="h-5 w-32" shape="text" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-8 w-full" />
        </Card>
      }
      arena={
        <div className="mx-auto w-full max-w-[min(100%,34rem)] rounded-2xl border-2 border-line bg-surface p-2">
          <div className="flex aspect-[5/6] w-full flex-col items-center justify-center gap-4 rounded-lg bg-surface-hover/30 p-6">
            <div className="grid aspect-square w-full max-w-80 grid-cols-5 gap-2 rounded-xl border border-line bg-surface p-4">
              {Array.from({ length: 25 }).map((_, i) => (
                <Skeleton key={i} className="size-full rounded-md" />
              ))}
            </div>
            <Skeleton className="h-4 w-48" shape="text" />
          </div>
        </div>
      }
      quickBar={<Skeleton className="h-12 w-full" />}
      hints={<Skeleton className="mx-auto h-4 w-64" shape="text" />}
      hud={
        <Card variant="control" className="space-y-3">
          <Skeleton className="h-6 w-36" shape="text" />
          <Skeleton className="h-16 w-full" />
        </Card>
      }
      actions={
        <Card variant="control" className="space-y-3">
          <Skeleton className="h-5 w-28" shape="text" />
          <Skeleton className="h-3 w-full" shape="text" />
          <Skeleton className="h-10 w-full" />
        </Card>
      }
      telemetry={
        <Card variant="control" className="space-y-3">
          <Skeleton className="h-5 w-20" shape="text" />
          <Skeleton className="h-16 w-full" />
        </Card>
      }
    />
  );
}
