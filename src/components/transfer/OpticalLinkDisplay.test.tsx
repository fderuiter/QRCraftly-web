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

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import type { LinkState } from '@/packages/optical-modem';
import { ANNOUNCE_GAP_MS, OpticalLinkDisplay } from './OpticalLinkDisplay';

const locked: LinkState = { lockedProfile: 3, bytesPerSecond: 37_400, cameraFps: 30, readableShare: 1, advice: 'none' };

describe('OpticalLinkDisplay', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('shows the lock level, the link line and what would raise it, with an experimental badge', () => {
    render(<OpticalLinkDisplay state={{ ...locked, advice: 'move-closer' }} />);
    expect(screen.getByTestId('optical-lock-level')).toHaveTextContent('Locked P3');
    expect(screen.getByTestId('optical-link-label')).toHaveTextContent('Optical link: 8-colour · 120×67 · 30 Hz · 37 KB/s');
    expect(screen.getByTestId('optical-link-advice')).toHaveTextContent(/move closer/i);
    expect(screen.getByText('Experimental')).toBeInTheDocument();
  });

  it('says so when nothing is locked yet', () => {
    render(<OpticalLinkDisplay state={{ lockedProfile: null, bytesPerSecond: 0, cameraFps: 30, readableShare: 0, advice: 'find-screen' }} />);
    expect(screen.getByTestId('optical-lock-level')).toHaveTextContent('No lock yet');
    expect(screen.getByTestId('optical-link-label')).toHaveTextContent('looking for the sender');
  });

  it('follows every update on screen but announces a change of lock at once and a change of advice at most every five seconds', () => {
    const { rerender } = render(<OpticalLinkDisplay state={locked} />);
    const announcement = screen.getByTestId('optical-link-announcement');
    expect(announcement).toHaveTextContent('Locked P3. This is the best the sender is offering.');
    // The data rate changes every second and is never announced.
    rerender(<OpticalLinkDisplay state={{ ...locked, bytesPerSecond: 41_000 }} />);
    expect(screen.getByTestId('optical-link-label')).toHaveTextContent('41 KB/s');
    expect(announcement).toHaveTextContent('Locked P3. This is the best');
    // Advice that changes straight away is held back.
    vi.setSystemTime(Date.now() + 1000);
    rerender(<OpticalLinkDisplay state={{ ...locked, advice: 'steady' }} />);
    expect(announcement).toHaveTextContent('This is the best');
    expect(screen.getByTestId('optical-link-advice')).toHaveTextContent(/hold steady/i);
    // Once the gap has passed, the next update reads it.
    vi.setSystemTime(Date.now() + ANNOUNCE_GAP_MS);
    rerender(<OpticalLinkDisplay state={{ ...locked, advice: 'steady', bytesPerSecond: 40_000 }} />);
    expect(announcement).toHaveTextContent('Hold steady, or prop the phone');
    // A change of lock is read at once.
    rerender(<OpticalLinkDisplay state={{ ...locked, lockedProfile: 4, advice: 'steady' }} />);
    expect(announcement).toHaveTextContent('Locked P4.');
  });

  it('has no accessibility violations and keeps live regions to the one announcement', async () => {
    const { container } = render(<OpticalLinkDisplay state={locked} />);
    expect(await axe(container)).toHaveNoViolations();
    expect(container.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
  });
});
