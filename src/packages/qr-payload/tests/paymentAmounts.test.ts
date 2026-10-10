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


import { describe, it, expect } from 'vitest';
import { CryptoNetwork, PaymentData, QRType } from '@/types';
import { constructPaymentString, hydratePaymentData, paymentAmountError, validatePayload } from '../index';

const BTC = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq';
const ETH = '0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359';
const IBAN = 'DE89370400440532013000';

const pay = (network: CryptoNetwork, address: string, amount: string): PaymentData => ({ network, address, amount, label: '' });

describe('Payment amounts (#1283)', () => {
  it.each([
    [CryptoNetwork.BITCOIN, BTC, '-1'],
    [CryptoNetwork.BITCOIN, BTC, '1e-8'],
    [CryptoNetwork.BITCOIN, BTC, '0.123456789'],
    [CryptoNetwork.BITCOIN, BTC, '.'],
    [CryptoNetwork.ETHEREUM, ETH, '-1'],
    [CryptoNetwork.ETHEREUM, ETH, '1e3'],
    [CryptoNetwork.SOLANA, 'So11111111111111111111111111111111111111112', '0.0000000001'],
    [CryptoNetwork.PAYPAL, 'jane', '12.345'],
  ])('%s refuses %s %s', (network, address, amount) => {
    expect(paymentAmountError(amount, network)).not.toBeNull();
    expect(constructPaymentString(pay(network, address, amount))).toBe('');
  });

  it.each([
    [CryptoNetwork.BITCOIN, BTC, '0.00000001', `bitcoin:${BTC}?amount=0.00000001`],
    [CryptoNetwork.LITECOIN, 'ltc1qg82tyn7xl6x5q0ekxzrm6ucfzp6e2xnx8f2u7r', '1.5', 'litecoin:ltc1qg82tyn7xl6x5q0ekxzrm6ucfzp6e2xnx8f2u7r?amount=1.5'],
    [CryptoNetwork.SOLANA, 'So11111111111111111111111111111111111111112', '0.000000001', 'solana:So11111111111111111111111111111111111111112?amount=0.000000001'],
    [CryptoNetwork.ETHEREUM, ETH, '0.000000000000000001', `ethereum:${ETH}?value=1`],
  ])('%s keeps a valid amount at full precision', (network, address, amount, expected) => {
    expect(paymentAmountError(amount, network)).toBeNull();
    expect(constructPaymentString(pay(network, address, amount))).toBe(expected);
  });

  it('reports a bad amount in a scanned code', () => {
    expect(validatePayload(`bitcoin:${BTC}?amount=-1`, QRType.PAYMENT)).toContain('PAYMENT_AMOUNT_VIOLATION');
    expect(validatePayload(`bitcoin:${BTC}?amount=0.01`, QRType.PAYMENT)).toEqual([]);
  });

  it('hydrates upper-case BIP-21 URIs as Bitcoin', () => {
    const data = hydratePaymentData(`BITCOIN:${BTC.toUpperCase()}?AMOUNT=0.01&LABEL=Tip`);
    expect(data).toMatchObject({ network: CryptoNetwork.BITCOIN, address: BTC.toUpperCase(), amount: '0.01', label: 'Tip' });
  });
});

describe('EPC/SEPA output (#1367)', () => {
  const sepa = (overrides: Partial<PaymentData>): PaymentData => ({
    network: CryptoNetwork.EPC_SEPA,
    address: IBAN,
    iban: IBAN,
    name: 'Jane Doe',
    amount: '',
    label: '',
    ...overrides,
  });

  it('keeps ? and & in the beneficiary name and note', () => {
    const raw = constructPaymentString(sepa({ name: 'A? B & Co', label: 'Invoice #12? yes & no' }));
    expect(raw.split(/\r?\n/)[5]).toBe('A? B & Co');
    expect(raw.split(/\r?\n/)[10]).toBe('Invoice #12? yes & no');
  });

  it('requires the beneficiary name', () => {
    expect(constructPaymentString(sepa({ name: '  ' }))).toBe('');
  });

  it('refuses a bad amount and normalises a good one', () => {
    expect(constructPaymentString(sepa({ amount: '-1.005' }))).toBe('');
    expect(constructPaymentString(sepa({ amount: '1.005' }))).toBe('');
    expect(constructPaymentString(sepa({ amount: '1000000000' }))).toBe('');
    expect(constructPaymentString(sepa({ amount: '12.50' })).split(/\r?\n/)[7]).toBe('EUR12.50');
  });

  it('does not end in a line break, and round-trips', () => {
    const data = sepa({ amount: '12.50', label: 'Rent' });
    const raw = constructPaymentString(data);
    expect(raw.endsWith('\n')).toBe(false);
    expect(raw).toBe(`BCD\n002\n1\nSCT\n\nJane Doe\n${IBAN}\nEUR12.50\n\n\nRent`);
    expect(hydratePaymentData(raw)).toMatchObject({ iban: IBAN, name: 'Jane Doe', amount: '12.50', label: 'Rent' });
    expect(constructPaymentString(sepa({})).endsWith(IBAN)).toBe(true);
  });

  it('turns a line break in the name into a space', () => {
    expect(constructPaymentString(sepa({ name: 'Jane\nDoe' })).split(/\r?\n/)[5]).toBe('Jane Doe');
  });
});
