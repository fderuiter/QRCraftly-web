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

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LazyPaymentInput } from './LazyPaymentInput';
import { CryptoNetwork, type PaymentData } from '@/packages/qr-payload';

describe('LazyPaymentInput', () => {
  it('renders the payment input once mounted', async () => {
    const data: PaymentData = {
      network: CryptoNetwork.BITCOIN,
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      amount: '0.05',
      label: 'Satoshi',
    };
    const onChange = vi.fn();

    render(<LazyPaymentInput data={data} onChange={onChange} />);

    expect(await screen.findByDisplayValue('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBeInTheDocument();
  });
});
