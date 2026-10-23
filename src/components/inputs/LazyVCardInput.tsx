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
import type { VCardData } from '../../types';
import { Skeleton } from '../ui/Skeleton';
import { CONTAINER_SPACING_CLASSES } from '../ui/styles';

const VCardInput = React.lazy(() =>
  import('./VCardInput').then((module) => ({ default: module.VCardInput }))
);

const Placeholder = () => (
  <div className={CONTAINER_SPACING_CLASSES}>
    <Skeleton className="h-10 w-full rounded-lg" />
    <Skeleton className="h-10 w-full rounded-lg" />
    <Skeleton className="h-24 w-full rounded-lg" />
  </div>
);

export interface LazyVCardInputProps {
  data: VCardData;
  onChange: (updates: Partial<VCardData>) => void;
}

/**
 * Registry entry for the vCard contact type. Renders a placeholder during
 * prerendering and hydration, then loads the vCard generator chunk on the client.
 */
export const LazyVCardInput: React.FC<LazyVCardInputProps> = (props) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return <Placeholder />;
  return (
    <Suspense fallback={<Placeholder />}>
      <VCardInput {...props} />
    </Suspense>
  );
};
