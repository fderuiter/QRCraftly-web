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
import { vibrate } from './feedback';

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

  /** A fresh copy of the module, so each test starts with no shared audio context. */
  const freshFeedback = async () => {
    vi.resetModules();
    return import('./feedback');
  };

  const fakeAudio = () => {
    const start = vi.fn();
    const oscillators: unknown[] = [];
    const created: FakeContext[] = [];
    class FakeContext {
      currentTime = 0;
      destination = {};
      state: AudioContextState = 'suspended';
      resume = vi.fn(() => {
        this.state = 'running';
        return Promise.resolve();
      });
      constructor() {
        created.push(this);
      }
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
    Object.defineProperty(window, 'AudioContext', { value: FakeContext, configurable: true });
    return { start, oscillators, created };
  };

  it('plays two generated notes and never needs a file', async () => {
    const { playChime: chime } = await freshFeedback();
    const { start, oscillators } = fakeAudio();
    chime();
    expect(oscillators).toHaveLength(2);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('builds one audio context in the sound toggle and reuses it for every chime (#1481)', async () => {
    const { playChime: chime, unlockChime } = await freshFeedback();
    const { created, oscillators } = fakeAudio();
    unlockChime();
    expect(created).toHaveLength(1);
    expect(created[0].resume).toHaveBeenCalledTimes(1);

    chime();
    chime();
    expect(created).toHaveLength(1);
    expect(oscillators).toHaveLength(4);
    expect(created[0].close).not.toHaveBeenCalled();
  });

  it('survives a missing audio API', async () => {
    const { playChime: chime, unlockChime } = await freshFeedback();
    Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
    expect(() => unlockChime()).not.toThrow();
    expect(() => chime()).not.toThrow();
  });
});
