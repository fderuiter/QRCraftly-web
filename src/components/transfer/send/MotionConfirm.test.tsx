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
import { REDUCED_MOTION_CONFIRM_TITLE } from '@/utils/photosensitivity';
import { MotionConfirm } from './MotionConfirm';

describe('MotionConfirm', () => {
  it('is a named group that takes focus on its confirm button', async () => {
    const { container } = render(<MotionConfirm onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('group', { name: REDUCED_MOTION_CONFIRM_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start anyway' })).toHaveFocus();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('starts or cancels', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<MotionConfirm onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
