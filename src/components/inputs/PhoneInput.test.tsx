/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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
import { describe, it, expect, vi } from 'vitest';
import { PhoneInput } from './PhoneInput';
import { smsNumberNotes } from './SmsInput';

describe('PhoneInput dropped characters (#1277)', () => {
  it('says which typed characters the code leaves out', () => {
    render(<PhoneInput data={{ number: '+1 555 CALL' }} onChange={vi.fn()} />);
    expect(screen.getByText(/leaves out "C", "A", "L"/)).toBeInTheDocument();
  });

  it('says nothing for a number with an extension', () => {
    render(<PhoneInput data={{ number: '+1 555 123 4567 ext. 89' }} onChange={vi.fn()} />);
    expect(screen.queryByTestId('field-hints')).not.toBeInTheDocument();
  });

  it('notes letters in an SMS number', () => {
    expect(smsNumberNotes('+15551234567 x89').some((note) => note.includes('"x"'))).toBe(true);
    expect(smsNumberNotes('+15551234567;+15557654321')).toEqual(['Anyone who scans this will text 2 numbers at once.']);
  });
});
