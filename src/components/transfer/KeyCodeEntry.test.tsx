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
import { axe } from '../../../tests/utils/axe';
import { KeyCodeEntry } from './KeyCodeEntry';

const field = () => screen.getByLabelText('Key code');
const status = () => screen.getByTestId('key-code-status');

describe('KeyCodeEntry', () => {
  it('announces nothing while a partial key is typed', async () => {
    const onSubmit = vi.fn();
    const { container } = render(<KeyCodeEntry onSubmit={onSubmit} accepted={null} />);
    for (const partial of ['o', 'oak-', 'oak-river-st']) {
      fireEvent.change(field(), { target: { value: partial } });
      expect(status()).toHaveTextContent('');
    }
    expect(onSubmit).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps Unlock off and submits nothing for blank or whitespace input', () => {
    const onSubmit = vi.fn();
    render(<KeyCodeEntry onSubmit={onSubmit} accepted={null} />);
    const unlock = screen.getByRole('button', { name: 'Unlock' });
    expect(unlock).toBeDisabled();
    fireEvent.change(field(), { target: { value: '   ' } });
    expect(unlock).toBeDisabled();
    fireEvent.submit(unlock.closest('form') ?? unlock);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the typed code and reports whether it was readable', async () => {
    const onSubmit = vi.fn();
    const { container, rerender } = render(<KeyCodeEntry onSubmit={onSubmit} accepted={null} />);
    fireEvent.change(field(), { target: { value: 'oak-river' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(onSubmit).toHaveBeenCalledWith('oak-river');
    rerender(<KeyCodeEntry onSubmit={onSubmit} accepted={false} />);
    expect(status()).toHaveTextContent('That is not a key code.');
    rerender(<KeyCodeEntry onSubmit={onSubmit} accepted />);
    expect(status()).toHaveTextContent('Key code accepted. Keep scanning.');
    expect(await axe(container)).toHaveNoViolations();
  });
});
