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

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { EmailInput } from './EmailInput';
import type { EmailData } from '../../types';

describe('EmailInput', () => {
  const mockOnChange = vi.fn();
  const defaultData: EmailData = {
    email: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with default data and passes accessibility check', async () => {
    const { container } = render(<EmailInput data={defaultData} onChange={mockOnChange} />);

    const emailInput = screen.getByLabelText('Email Address') as HTMLInputElement;
    expect(emailInput).toBeInTheDocument();
    expect(emailInput.value).toBe('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const results = await axe(container);
    expect(results.violations).toEqual([]);
  });

  it('calls onChange when user types in inputs', () => {
    render(<EmailInput data={defaultData} onChange={mockOnChange} />);

    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'user@example.com' } });
    expect(mockOnChange).toHaveBeenCalledWith({ email: 'user@example.com' });

    fireEvent.change(screen.getByLabelText('CC'), { target: { value: 'cc@example.com' } });
    expect(mockOnChange).toHaveBeenCalledWith({ cc: 'cc@example.com' });

    fireEvent.change(screen.getByLabelText('BCC'), { target: { value: 'bcc@example.com' } });
    expect(mockOnChange).toHaveBeenCalledWith({ bcc: 'bcc@example.com' });
  });

  it('displays validation error for invalid recipient email', () => {
    const data: EmailData = { ...defaultData, email: 'invalid-email' };
    render(<EmailInput data={data} onChange={mockOnChange} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Invalid email address structure.');
  });

  it('displays validation error for invalid CC email', () => {
    const data: EmailData = { ...defaultData, email: 'valid@example.com', cc: 'invalid-cc' };
    render(<EmailInput data={data} onChange={mockOnChange} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Invalid email address structure.');
  });

  it('displays validation error for invalid BCC email', () => {
    const data: EmailData = { ...defaultData, email: 'valid@example.com', bcc: 'valid@example.com, invalid-bcc' };
    render(<EmailInput data={data} onChange={mockOnChange} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Invalid email address structure.');
  });

  it('does not display errors for valid single and comma-separated email lists', () => {
    const data: EmailData = {
      email: 'user1@example.com, user2@example.com',
      cc: 'cc1@example.com, cc2@example.com',
      bcc: 'bcc@example.com',
      subject: 'Hello',
      body: 'World',
    };
    render(<EmailInput data={data} onChange={mockOnChange} />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears error messages when inputs become empty or are cleared', () => {
    const { rerender } = render(<EmailInput data={{ ...defaultData, email: 'bad' }} onChange={mockOnChange} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<EmailInput data={{ ...defaultData, email: '' }} onChange={mockOnChange} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
