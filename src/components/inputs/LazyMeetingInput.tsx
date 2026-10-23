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
import type { MeetingInputProps } from './MeetingInput';
import { Skeleton } from '../ui/Skeleton';

const MeetingInput = React.lazy(() =>
  import('./MeetingInput').then((module) => ({ default: module.MeetingInput }))
);

const Placeholder = () => (
  <div className="space-y-4">
    <Skeleton className="h-10 w-full rounded-lg" />
  </div>
);

/**
 * Registry entry for the Meeting link input component.
 */
export const LazyMeetingInput: React.FC<MeetingInputProps> = (props) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return <Placeholder />;
  return (
    <Suspense fallback={<Placeholder />}>
      <MeetingInput {...props} />
    </Suspense>
  );
};
