import { useEffect } from 'react';

/** How many scroll locks are active, and the overflow the page had before the first one (#1589). */
let activeLocks = 0;
let originalOverflow = '';

/**
 * Hook to lock scrolling of the background document.
 * Locks are counted, so stacked modals can close in any order: the first lock saves the page's
 * overflow and only the last unlock restores it.
 * @param isActive Boolean indicating if the scroll lock is active.
 */
export function useScrollLock(isActive: boolean) {
  useEffect(() => {
    if (!isActive) return;

    if (activeLocks === 0) originalOverflow = document.body.style.overflow;
    activeLocks += 1;
    document.body.style.overflow = 'hidden';

    return () => {
      activeLocks -= 1;
      if (activeLocks === 0) document.body.style.overflow = originalOverflow;
    };
  }, [isActive]);
}
