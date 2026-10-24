import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useScrollLock } from './useScrollLock';

describe('useScrollLock', () => {
  beforeEach(() => {
    document.body.style.overflow = 'scroll';
  });

  it('locks while active and restores the page overflow after', () => {
    const { rerender, unmount } = renderHook(({ active }) => useScrollLock(active), { initialProps: { active: false } });
    expect(document.body.style.overflow).toBe('scroll');
    rerender({ active: true });
    expect(document.body.style.overflow).toBe('hidden');
    rerender({ active: false });
    expect(document.body.style.overflow).toBe('scroll');
    unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });

  it.each([
    ['the first', 'first'],
    ['the last', 'second'],
  ] as const)('restores the page overflow when %s modal to open closes first (#1589)', (_label, closesFirst) => {
    const first = renderHook(() => useScrollLock(true));
    const second = renderHook(() => useScrollLock(true));
    const [early, late] = closesFirst === 'first' ? [first, second] : [second, first];

    early.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    late.unmount();
    expect(document.body.style.overflow).toBe('scroll');
  });
});
