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

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { useDebounce, useLeadingDebounce } from './useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 500));
    expect(result.current).toBe('initial');
  });

  it('should debounce value updates', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 500 } }
    );

    // Update value
    rerender({ value: 'updated', delay: 500 });

    // Should still be initial
    expect(result.current).toBe('initial');

    // Advance time by 200ms (less than delay)
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('initial');

    // Advance time by 300ms (total 500ms)
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('updated');
  });

  it('should reset timer if value changes before delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 500 } }
    );

    // First update
    rerender({ value: 'update1', delay: 500 });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('initial');

    // Second update before timeout
    rerender({ value: 'update2', delay: 500 });

    act(() => {
      vi.advanceTimersByTime(300); // Total 600ms from start, but only 300ms from second update
    });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(200); // Total 500ms from second update
    });
    expect(result.current).toBe('update2');
  });
});

describe('useLeadingDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies a change that follows a quiet spell in the same render', () => {
    const { result, rerender } = renderHook(({ value }) => useLeadingDebounce(value, 100), {
      initialProps: { value: 'a' },
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    rerender({ value: 'b' });
    expect(result.current).toBe('b');
  });

  it('holds back a burst of changes until it pauses', () => {
    const { result, rerender } = renderHook(({ value }) => useLeadingDebounce(value, 100), {
      initialProps: { value: 0 },
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    rerender({ value: 1 });
    expect(result.current).toBe(1);

    // Two quick changes in a row: only the last one lands, after the delay.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    rerender({ value: 2 });
    act(() => {
      vi.advanceTimersByTime(20);
    });
    rerender({ value: 3 });
    act(() => {
      vi.advanceTimersByTime(99);
    });
    expect(result.current).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(3);
  });
});
