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
*/

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { PaymentInput } from './PaymentInput';
import { CryptoNetwork, type PaymentData } from '../../types';

const UPI_ID_ERROR = 'Enter a UPI ID in the form name@bank, such as jane@okaxis.';
const PAYEE_NAME_ERROR = "A UPI payment code needs the payee's name.";

const upi = (overrides: Partial<PaymentData> = {}): PaymentData => ({
  network: CryptoNetwork.UPI,
  address: '',
  name: '',
  amount: '',
  label: '',
  ...overrides,
});

describe('PaymentInput UPI preset', () => {
  it('shows the UPI ID, a required Payee Name and Amount (INR) once UPI is chosen', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PaymentInput data={{ ...upi(), network: CryptoNetwork.BITCOIN }} onChange={onChange} />
    );
    expect(screen.queryByLabelText('Payee Name')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Currency / Network'), { target: { value: CryptoNetwork.UPI } });
    expect(onChange).toHaveBeenLastCalledWith({ network: CryptoNetwork.UPI });

    rerender(<PaymentInput data={upi()} onChange={onChange} />);
    expect(screen.getByLabelText('UPI ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Payee Name')).toHaveAttribute('required');
    expect(screen.getByLabelText(/^Amount \(INR\)/)).toBeInTheDocument();
  });

  it('reports UPI ID, payee name and amount changes', () => {
    const onChange = vi.fn();
    render(<PaymentInput data={upi()} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'jane@okaxis' } });
    expect(onChange).toHaveBeenLastCalledWith({ address: 'jane@okaxis' });

    fireEvent.change(screen.getByLabelText('Payee Name'), { target: { value: 'Jane Doe' } });
    expect(onChange).toHaveBeenLastCalledWith({ name: 'Jane Doe' });

    fireEvent.change(screen.getByLabelText(/^Amount \(INR\)/), { target: { value: '250.50' } });
    expect(onChange).toHaveBeenLastCalledWith({ amount: '250.50' });
  });

  it('does not show the UPI ID error while the ID is still being typed, but shows it after blur', () => {
    const { rerender } = render(<PaymentInput data={upi({ address: '' })} onChange={vi.fn()} />);

    rerender(<PaymentInput data={upi({ address: 'jane' })} onChange={vi.fn()} />);
    expect(screen.queryByText(UPI_ID_ERROR)).not.toBeInTheDocument();
    expect(screen.getByLabelText('UPI ID')).toHaveAttribute('aria-invalid', 'false');

    fireEvent.blur(screen.getByLabelText('UPI ID'));
    expect(screen.getByText(UPI_ID_ERROR)).toBeInTheDocument();
    expect(screen.getByLabelText('UPI ID')).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the UPI ID error once the ID has the name@bank shape', () => {
    const { rerender } = render(<PaymentInput data={upi({ address: 'jane' })} onChange={vi.fn()} />);
    fireEvent.blur(screen.getByLabelText('UPI ID'));
    expect(screen.getByText(UPI_ID_ERROR)).toBeInTheDocument();

    rerender(<PaymentInput data={upi({ address: 'jane@okaxis' })} onChange={vi.fn()} />);
    expect(screen.queryByText(UPI_ID_ERROR)).not.toBeInTheDocument();
    expect(screen.getByLabelText('UPI ID')).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows the payee name error only after the name field is blurred empty', () => {
    const { rerender } = render(<PaymentInput data={upi({ address: 'jane@okaxis' })} onChange={vi.fn()} />);
    expect(screen.queryByText(PAYEE_NAME_ERROR)).not.toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText('Payee Name'));
    expect(screen.getByText(PAYEE_NAME_ERROR)).toBeInTheDocument();
    expect(screen.getByLabelText('Payee Name')).toHaveAttribute('aria-invalid', 'true');

    rerender(<PaymentInput data={upi({ address: 'jane@okaxis', name: 'Jane' })} onChange={vi.fn()} />);
    expect(screen.queryByText(PAYEE_NAME_ERROR)).not.toBeInTheDocument();
  });

  it('treats a whitespace-only payee name as empty after blur', () => {
    render(<PaymentInput data={upi({ address: 'jane@okaxis', name: '   ' })} onChange={vi.fn()} />);
    fireEvent.blur(screen.getByLabelText('Payee Name'));
    expect(screen.getByText(PAYEE_NAME_ERROR)).toBeInTheDocument();
  });

  it('passes an axe check on the UPI form', async () => {
    const { container } = render(<PaymentInput data={upi({ address: 'jane@okaxis', name: 'Jane Doe' })} onChange={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('passes an axe check on the UPI form with its errors shown', async () => {
    const { container } = render(<PaymentInput data={upi({ address: 'jane' })} onChange={vi.fn()} />);
    fireEvent.blur(screen.getByLabelText('UPI ID'));
    fireEvent.blur(screen.getByLabelText('Payee Name'));
    expect(screen.getByText(UPI_ID_ERROR)).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });
});
