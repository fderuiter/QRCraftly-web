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

import React, { Suspense, useEffect, useState } from 'react';
import type { BulkCsvInputProps } from './BulkCsvInput';
import { Skeleton } from '../ui/Skeleton';
import { BulkCsvDropZone } from './BulkCsvDropZone';

// Code-split: the CSV parser, ZIP writer and batch UI load only when the Bulk CSV
// type is opened, so every other page keeps its JavaScript budget.
const BulkCsvInput = React.lazy(() =>
  import('./BulkCsvInput').then((module) => ({ default: module.BulkCsvInput }))
);

// The drop zone itself, with a stand-in the size of its file picker: its text is the page's
// largest paint, so it is pre-rendered rather than drawn when the chunk arrives.
const Placeholder = () => (
  <div className="space-y-6">
    <BulkCsvDropZone>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <Skeleton className="h-9 w-32 rounded-lg" />
        <Skeleton className="h-9 w-48 rounded-lg" />
      </div>
    </BulkCsvDropZone>
  </div>
);

/**
 * Registry entry for the Bulk CSV Batch type. Renders a placeholder during
 * prerendering and hydration, then loads the batch generator chunk on the client.
 */
export const LazyBulkCsvInput: React.FC<BulkCsvInputProps> = (props) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return <Placeholder />;
  return (
    <Suspense fallback={<Placeholder />}>
      <BulkCsvInput {...props} />
    </Suspense>
  );
};
