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

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { TextInput } from './TextInput';

describe('TextInput', () => {
  it('reports each edit and has no axe violations', async () => {
    const onChange = vi.fn();
    const { container } = render(<TextInput data={{ text: '' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'Hello' } });
    expect(onChange).toHaveBeenCalledWith({ text: 'Hello' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows no error for blank or whitespace-only text', () => {
    render(<TextInput data={{ text: '   ' }} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Content')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('explains why a script link is refused', () => {
    render(<TextInput data={{ text: 'javascript:alert(1)' }} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Content')).toHaveAttribute('aria-invalid', 'true');
  });
});
