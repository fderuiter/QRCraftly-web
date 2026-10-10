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
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from '../../../tests/utils/axe';
import { CryptoNetwork, QRType, type MeetingData } from '@/types';
import { UrlInput } from './UrlInput';
import { MeetingInput } from './MeetingInput';
import { EventInput } from './EventInput';
import { PhoneInput } from './PhoneInput';
import { SmsInput } from './SmsInput';
import { PaymentInput } from './PaymentInput';
import { firstWebAddress } from './FieldHints';
import { findBlockingViolation } from './linkViolations';

const noop = () => undefined;

describe('generator hints (#1159)', () => {
  it('finds the first web address in free text', () => {
    expect(firstWebAddress('Join us at https://bit.ly/abc, bring snacks')).toBe('https://bit.ly/abc,');
    expect(firstWebAddress('Room 4')).toBe('');
  });

  it('hints about a lookalike URL after a pause, ties the hint to the field, and never blocks', async () => {
    const { container } = render(<UrlInput data={{ url: 'https://paypa1.com/login' }} onChange={noop} />);
    const field = screen.getByLabelText('Website URL');
    expect(screen.queryByTestId('field-hints')).not.toBeInTheDocument();
    const hints = await screen.findByTestId('field-hints');
    expect(hints).toHaveTextContent(/imitates paypal/);
    expect(field.getAttribute('aria-describedby')).toContain(hints.id);
    expect(field).toHaveAttribute('aria-invalid', 'false');
    expect(findBlockingViolation(QRType.URL, { url: 'https://paypa1.com/login' })).toBeFalsy();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows nothing for an ordinary address', async () => {
    render(<UrlInput data={{ url: 'https://example.com/menu' }} onChange={noop} />);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByTestId('field-hints')).not.toBeInTheDocument();
  });

  it('hints under the meeting link and the event location', async () => {
    const meeting: MeetingData = { url: 'https://bit.ly/standup' } as MeetingData;
    const first = render(<MeetingInput data={meeting} onChange={noop} />);
    expect(await first.findByTestId('field-hints')).toHaveTextContent(/shortened link/);
    first.unmount();
    render(
      <EventInput
        data={{ title: 'T', startDate: '', endDate: '', location: 'Come to https://user@192.168.0.5/map', description: '' }}
        onChange={noop}
      />
    );
    expect(await screen.findByTestId('field-hints')).toHaveTextContent(/number instead of a name/);
  });

  it('notes a dialer code under a phone number', () => {
    const { container, rerender } = render(<PhoneInput data={{ number: '*21*5551234567#' }} onChange={noop} />);
    expect(screen.getByTestId('field-hints')).toHaveTextContent(/dialer code \(USSD\)/);
    expect(screen.getByLabelText('Phone Number').getAttribute('aria-describedby')).toContain(screen.getByTestId('field-hints').id);
    rerender(<PhoneInput data={{ number: '+15551234567' }} onChange={noop} />);
    expect(screen.queryByTestId('field-hints')).not.toBeInTheDocument();
    expect(container).toBeTruthy();
  });

  it('notes a text sent to several numbers or a short number', async () => {
    const { container, rerender } = render(<SmsInput data={{ number: '+15551230001, +15551230002', message: '' }} onChange={noop} />);
    expect(screen.getByTestId('field-hints')).toHaveTextContent('text 2 numbers at once');
    expect(await axe(container)).toHaveNoViolations();
    rerender(<SmsInput data={{ number: '72727', message: '' }} onChange={noop} />);
    expect(screen.getByTestId('field-hints')).toHaveTextContent(/paid service/);
    rerender(<SmsInput data={{ number: '+15551230001', message: '' }} onChange={noop} />);
    expect(screen.queryByTestId('field-hints')).not.toBeInTheDocument();
  });

  it('flags a wallet address that fails its checksum but still allows it', () => {
    const data = { network: CryptoNetwork.BITCOIN, address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3', amount: '', label: '' };
    const { rerender } = render(<PaymentInput data={data} onChange={noop} />);
    expect(screen.getByText(/does not pass its built-in check/)).toBeInTheDocument();
    rerender(<PaymentInput data={{ ...data, address: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2' }} onChange={noop} />);
    expect(screen.queryByText(/does not pass its built-in check/)).not.toBeInTheDocument();
  });
});
