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
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { SafetyGateModal } from './SafetyGateModal';

const props = () => ({ onFix: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn() });

describe('SafetyGateModal', () => {
  it('names the problem, applies its fix and closes', async () => {
    const handlers = props();
    render(<SafetyGateModal open advice={{ message: 'The contrast is too low.', fix: 'increase-contrast' }} {...handlers} />);
    expect(screen.getByRole('dialog', { name: 'This Code May Not Scan' })).toHaveTextContent('The contrast is too low.');
    await userEvent.click(screen.getByRole('button', { name: 'Use black on white' }));
    expect(handlers.onFix).toHaveBeenCalledWith('increase-contrast');
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });

  it('offers Go back when there is no one-tap fix, and Export anyway confirms', async () => {
    const handlers = props();
    render(<SafetyGateModal open advice={null} {...handlers} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Adjust the colors, pattern or margin, then try again.');
    await userEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(handlers.onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Export anyway' }));
    expect(handlers.onConfirm).toHaveBeenCalledTimes(1);
  });

  it('keeps focus inside the dialog and cancels on Escape', async () => {
    const handlers = props();
    render(<SafetyGateModal open advice={null} {...handlers} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 4; i += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard('{Escape}');
    expect(handlers.onCancel).toHaveBeenCalled();
    expect(handlers.onConfirm).not.toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    render(<SafetyGateModal open={false} advice={null} {...props()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    render(<SafetyGateModal open advice={{ message: 'The logo is too large.', fix: 'smaller-logo' }} {...props()} />);
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
  });
});
