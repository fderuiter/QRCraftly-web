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

import React, { Suspense } from 'react';
import type { SocialData } from '@/packages/qr-payload';
import { Skeleton } from '../ui/Skeleton';
import { CONTAINER_SPACING_CLASSES } from '../ui/styles';

const SocialInput = React.lazy(() =>
  import('./SocialInput').then((module) => ({ default: module.SocialInput }))
);

const Placeholder = () => (
  <div className={CONTAINER_SPACING_CLASSES}>
    <Skeleton className="h-10 w-full rounded-lg" />
    <Skeleton className="h-10 w-full rounded-lg" />
  </div>
);

interface LazySocialInputProps {
  data: SocialData;
  onChange: (updates: Partial<SocialData>) => void;
}

export const LazySocialInput: React.FC<LazySocialInputProps> = (props) => {
  return (
    <Suspense fallback={<Placeholder />}>
      <SocialInput {...props} />
    </Suspense>
  );
};
