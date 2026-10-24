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

// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../../tests/utils/axe';
import { SendControls, type SendControlsProps } from './SendControls';

/** Renders the controls with spy handlers. */
function renderControls(overrides: Partial<SendControlsProps> = {}) {
  const props: SendControlsProps = {
    running: false,
    paused: false,
    checking: false,
    hidden: false,
    describedBy: undefined,
    onStart: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
  return { ...render(<SendControls {...props} />), props };
}

describe('SendControls', () => {
  it('offers Start before a stream, and waits while the first frame is checked', async () => {
    const { container, props, rerender } = renderControls({ describedBy: 'notice' });
    const start = screen.getByRole('button', { name: 'Start file transfer' });
    expect(start).toHaveAttribute('aria-describedby', 'notice');
    fireEvent.click(start);
    expect(props.onStart).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();

    rerender(<SendControls {...props} checking />);
    expect(screen.getByRole('button', { name: 'Start file transfer' })).toBeDisabled();
    expect(screen.getByText('Checking QR…')).toBeInTheDocument();
  });

  it('pauses, resumes and stops a running stream', async () => {
    const { container, props, rerender } = renderControls({ running: true });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(props.onPause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-keyshortcuts', 'Escape');
    expect(await axe(container)).toHaveNoViolations();

    rerender(<SendControls {...props} paused />);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(props.onResume).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop file transfer' }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
  });

  it('pauses on Escape only while a stream plays, and lets the key go on unmount', () => {
    const { props, rerender, unmount } = renderControls({ running: true });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onPause).toHaveBeenCalledTimes(1);

    rerender(<SendControls {...props} paused />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onPause).toHaveBeenCalledTimes(1);

    rerender(<SendControls {...props} />);
    unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(props.onPause).toHaveBeenCalledTimes(1);
  });

  it('stays in the page but hidden until a file is chosen', () => {
    const { container } = renderControls({ hidden: true });
    expect(container.firstElementChild).toHaveClass('hidden');
  });
});
