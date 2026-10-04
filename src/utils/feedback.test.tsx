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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { playChime, vibrate } from './feedback';

const motion = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reduce && query.includes('reduce'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));

describe('feedback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('vibrates where supported', () => {
    const spy = vi.fn();
    motion(false);
    Object.defineProperty(navigator, 'vibrate', { value: spy, configurable: true });
    vibrate(30);
    expect(spy).toHaveBeenCalledWith(30);
  });

  it('stays still under reduced motion', () => {
    const spy = vi.fn();
    motion(true);
    Object.defineProperty(navigator, 'vibrate', { value: spy, configurable: true });
    vibrate(30);
    expect(spy).not.toHaveBeenCalled();
  });

  it('does nothing when the browser cannot vibrate', () => {
    motion(false);
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    expect(() => vibrate([10, 20])).not.toThrow();
  });

  it('plays two generated notes and never needs a file', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const oscillators: unknown[] = [];
    class FakeContext {
      currentTime = 0;
      destination = {};
      createOscillator() {
        const node = { type: '', frequency: { value: 0 }, connect: (next: unknown) => next, start, stop: vi.fn() };
        oscillators.push(node);
        return node;
      }
      createGain() {
        return { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: (next: unknown) => next };
      }
      close = vi.fn(() => Promise.resolve());
    }
    vi.stubGlobal('AudioContext', FakeContext);
    Object.defineProperty(window, 'AudioContext', { value: FakeContext, configurable: true });
    playChime();
    expect(oscillators).toHaveLength(2);
    expect(start).toHaveBeenCalledTimes(2);
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('survives a missing audio API', () => {
    Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
    expect(() => playChime()).not.toThrow();
  });
});
