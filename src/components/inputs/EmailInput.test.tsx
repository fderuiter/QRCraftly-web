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
import type { EmailData } from '@/packages/qr-payload';
import { hydrateEmailData } from '@/packages/qr-payload';

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

    expect(await axe(container)).toHaveNoViolations();
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

  it('displays validation error naming bad entry for invalid recipient email', () => {
    const data: EmailData = { ...defaultData, email: 'invalid-email' };
    render(<EmailInput data={data} onChange={mockOnChange} />);

    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('"invalid-email" is not an email address. Separate several addresses with commas.');
  });

  it('displays validation error for invalid CC email', () => {
    const data: EmailData = { ...defaultData, email: 'valid@example.com', cc: 'invalid-cc' };
    render(<EmailInput data={data} onChange={mockOnChange} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('"invalid-cc" is not an email address. Separate several addresses with commas.');
  });

  it('displays validation error for invalid BCC email in address list', () => {
    const data: EmailData = { ...defaultData, email: 'valid@example.com', bcc: 'valid@example.com, invalid-bcc' };
    render(<EmailInput data={data} onChange={mockOnChange} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('"invalid-bcc" is not an email address. Separate several addresses with commas.');
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

  it('handles whitespace-only fields without error when no other fields are filled', () => {
    const data: EmailData = {
      email: '   ',
      cc: '   ',
      bcc: '   ',
      subject: '   ',
      body: '   ',
    };
    render(<EmailInput data={data} onChange={mockOnChange} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error on To field when To is blank but Subject or Body is filled', () => {
    const data: EmailData = {
      email: '   ',
      cc: '',
      bcc: '',
      subject: 'Important Subject',
      body: '',
    };
    render(<EmailInput data={data} onChange={mockOnChange} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Add at least one recipient address.');
  });

  it('allows trailing commas in address lists as valid', () => {
    const data: EmailData = {
      email: 'a@b.co,',
      cc: 'cc@example.com,',
      bcc: '',
      subject: '',
      body: '',
    };
    render(<EmailInput data={data} onChange={mockOnChange} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows error for semicolon-separated lists', () => {
    const data: EmailData = {
      email: 'a@b.co; c@d.co',
      cc: '',
      bcc: '',
      subject: '',
      body: '',
    };
    render(<EmailInput data={data} onChange={mockOnChange} />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('"a@b.co; c@d.co" is not an email address. Separate several addresses with commas.');
  });

  it('renders a form hydrated from an existing mailto: value', () => {
    const mailto = 'mailto:user@example.com?cc=cc%40example.com&subject=Hello&body=World';
    const hydrated = hydrateEmailData(mailto);
    render(<EmailInput data={hydrated} onChange={mockOnChange} />);

    expect((screen.getByLabelText('Email Address') as HTMLInputElement).value).toBe('user@example.com');
    expect((screen.getByLabelText('CC') as HTMLInputElement).value).toBe('cc@example.com');
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toBe('Hello');
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe('World');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('passes accessibility check in error state and sets aria-invalid and aria-describedby', async () => {
    const data: EmailData = { ...defaultData, email: 'not-an-email' };
    const { container } = render(<EmailInput data={data} onChange={mockOnChange} />);

    const emailInput = screen.getByLabelText('Email Address') as HTMLInputElement;
    expect(emailInput).toHaveAttribute('aria-invalid', 'true');

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('"not-an-email" is not an email address. Separate several addresses with commas.');

    const errorId = alert.id;
    expect(errorId).toBeTruthy();
    expect(emailInput.getAttribute('aria-describedby')).toContain(errorId);

    expect(await axe(container)).toHaveNoViolations();
  });
});

