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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageContextClient } from 'vike/types';
import onBeforeRenderClient from './+onBeforeRenderClient';

/** Builds the one field the hook reads. */
const pageContext = (isHydration: boolean) => ({ isHydration }) as unknown as PageContextClient;

describe('onBeforeRenderClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders a client-side navigation at once', async () => {
    const frame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', frame);
    await onBeforeRenderClient(pageContext(false));
    expect(frame).not.toHaveBeenCalled();
  });

  it('hydrates only after the next frame has been painted', async () => {
    let paint: FrameRequestCallback = () => undefined;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      paint = callback;
      return 1;
    });
    let done = false;
    const waiting = onBeforeRenderClient(pageContext(true)).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(done).toBe(false);
    paint(performance.now());
    await vi.advanceTimersByTimeAsync(0);
    await waiting;
    expect(done).toBe(true);
  });

  it('does not wait for a frame a hidden tab never draws', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    const waiting = onBeforeRenderClient(pageContext(true));
    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toBeUndefined();
  });
});
