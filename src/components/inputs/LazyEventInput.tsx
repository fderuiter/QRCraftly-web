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
import type { EventData } from '../../types';
import { Skeleton } from '../ui/Skeleton';
import { CONTAINER_SPACING_CLASSES } from '../ui/styles';

const EventInput = React.lazy(() =>
  import('./EventInput').then((module) => ({ default: module.EventInput }))
);

const Placeholder = () => (
  <div className={CONTAINER_SPACING_CLASSES}>
    <Skeleton className="h-10 w-full rounded-lg" />
    <Skeleton className="h-10 w-full rounded-lg" />
    <Skeleton className="h-6 w-32 rounded-lg" />
    <Skeleton className="h-10 w-full rounded-lg" />
    <Skeleton className="h-10 w-full rounded-lg" />
  </div>
);

interface LazyEventInputProps {
  data: EventData;
  onChange: (updates: Partial<EventData>) => void;
}

/**
 * Registry entry for the Event type. Code-splits the EventInput component
 * so every other page keeps its JavaScript budget.
 */
export const LazyEventInput: React.FC<LazyEventInputProps> = (props) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return <Placeholder />;
  return (
    <Suspense fallback={<Placeholder />}>
      <EventInput {...props} />
    </Suspense>
  );
};
