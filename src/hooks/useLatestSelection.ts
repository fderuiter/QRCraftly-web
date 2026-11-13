import { useEffect, useMemo, useRef } from 'react';

/** Owns the latest of a series of async selections (a file pick, a drop) for one surface. */
export interface LatestSelection {
  /**
   * Starts a new selection and retires the one before it. Call it as the event arrives, before
   * any lazy import or file read.
   * @returns A check that stays true only while this selection is the current one.
   */
  begin: () => () => boolean;
  /** Retires the current selection, for example when a manual edit should win over it. */
  retire: () => void;
}

/**
 * Lets only the newest file selection publish its result (#1705). Reads can finish in any order,
 * so an older one that settles last must not replace a newer one. Unmount retires the current
 * selection too, so nothing publishes after the surface is gone.
 * @returns The surface's selection owner. It keeps the same identity for the component's life.
 */
export function useLatestSelection(): LatestSelection {
  const current = useRef(0);
  useEffect(
    () => () => {
      current.current += 1;
    },
    []
  );
  return useMemo(
    () => ({
      begin: () => {
        current.current += 1;
        const id = current.current;
        return () => current.current === id;
      },
      retire: () => {
        current.current += 1;
      },
    }),
    []
  );
}
