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
import type { PaymentData } from '@/packages/qr-payload';
import { Skeleton } from '../ui/Skeleton';
import { CONTAINER_SPACING_CLASSES } from '../ui/styles';

const PaymentInput = React.lazy(() =>
  import('./PaymentInput').then((module) => ({ default: module.PaymentInput }))
);

const Placeholder = () => (
  <div className={CONTAINER_SPACING_CLASSES}>
    <Skeleton className="h-10 w-full rounded-lg" />
    <Skeleton className="h-10 w-full rounded-lg" />
    <Skeleton className="h-10 w-full rounded-lg" />
  </div>
);

interface LazyPaymentInputProps {
  data: PaymentData;
  onChange: (updates: Partial<PaymentData>) => void;
}

/**
 * Registry entry for the Payment type. Code-splits the PaymentInput component
 * so every other page keeps its JavaScript budget.
 */
export const LazyPaymentInput: React.FC<LazyPaymentInputProps> = (props) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return <Placeholder />;
  return (
    <Suspense fallback={<Placeholder />}>
      <PaymentInput {...props} />
    </Suspense>
  );
};
