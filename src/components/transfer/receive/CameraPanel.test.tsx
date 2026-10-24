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
import { CameraPanel } from './CameraPanel';

const handlers = () => ({ onStart: vi.fn(), onStop: vi.fn(), onClear: vi.fn() });

describe('CameraPanel', () => {
  it('activates the scanner, and offers Clear only once something was received', async () => {
    const on = handlers();
    const { container, rerender } = render(<CameraPanel scanning={false} canClear={false} {...on} />);
    fireEvent.click(screen.getByRole('button', { name: 'Activate camera scanner' }));
    expect(on.onStart).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Clear transfer progress' })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    rerender(<CameraPanel scanning={false} canClear {...on} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear transfer progress' }));
    expect(on.onClear).toHaveBeenCalledTimes(1);
  });

  it('deactivates while scanning', async () => {
    const on = handlers();
    const { container } = render(<CameraPanel scanning canClear {...on} />);
    expect(screen.queryByRole('button', { name: 'Activate camera scanner' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate camera scanner' }));
    expect(on.onStop).toHaveBeenCalledTimes(1);
    expect(await axe(container)).toHaveNoViolations();
  });
});
