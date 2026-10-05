/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { useState, useEffect } from 'react';

/**
 * A hook that returns a debounced value.
 * The value will only update after the specified delay has passed without the value changing.
 * @param value The value to debounce.
 * @param delay The delay in milliseconds.
 * @returns The debounced value.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set a timeout to update the debounced value after the delay
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Clear the timeout if the value changes (or the component unmounts)
    // This effectively resets the timer
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Like {@link useDebounce}, but a change that follows a quiet spell of at least `delay` ms is
 * applied in the same render, and only a burst of changes (a slider drag, fast typing) is held
 * back until it pauses. A single click shows its result without waiting a debounce period or a
 * task.
 * @param value The value to debounce.
 * @param delay The quiet time in milliseconds that ends a burst.
 * @returns The debounced value.
 */
export function useLeadingDebounce<T>(value: T, delay: number): T {
  // `holding` is set by a change and cleared once `delay` ms pass without another one.
  const [state, setState] = useState({ value, applied: value, holding: false });
  let current = state;
  if (!Object.is(value, state.value)) {
    // Adjusting state while rendering: React re-runs this render with the new state at once.
    current = { value, applied: state.holding ? state.applied : value, holding: true };
    setState(current);
  }

  useEffect(() => {
    const handler = setTimeout(() => {
      setState((latest) =>
        latest.holding || !Object.is(latest.applied, latest.value)
          ? { value: latest.value, applied: latest.value, holding: false }
          : latest
      );
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return current.applied;
}
