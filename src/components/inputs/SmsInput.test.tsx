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
import { SmsInput, smsNumberNotes } from './SmsInput';

describe('SmsInput', () => {
  it('reports number and message edits and has no axe violations', async () => {
    const onChange = vi.fn();
    const { container } = render(<SmsInput data={{ number: '', message: '' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: '+15551234567' } });
    fireEvent.change(screen.getByLabelText('Pre-filled Message'), { target: { value: 'Hi' } });
    expect(onChange).toHaveBeenCalledWith({ number: '+15551234567' });
    expect(onChange).toHaveBeenCalledWith({ message: 'Hi' });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('notes nothing for a blank or whitespace-only number', () => {
    expect(smsNumberNotes('')).toEqual([]);
    expect(smsNumberNotes('   ')).toEqual([]);
  });

  it('warns about a short number that may be a paid service', () => {
    render(<SmsInput data={{ number: '12345', message: '' }} onChange={vi.fn()} />);
    expect(screen.getByText(/paid service/)).toBeInTheDocument();
  });
});
