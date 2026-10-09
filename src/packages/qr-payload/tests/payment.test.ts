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
import { constructPaymentString, hydratePaymentData, PaymentContract } from '../index';
import { CryptoNetwork, QRType } from '@/types';

describe('Payment generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
      network: CryptoNetwork.BITCOIN,
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      amount: '1.5',
      label: 'Donation',
    };
    const str = constructPaymentString(data);
    const hydrated = hydratePaymentData(str);
    expect(hydrated).toEqual(data);
  });

  it('hydrates without amount or label', () => {
    const data = {
      network: CryptoNetwork.BITCOIN,
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      amount: '',
      label: '',
    };
    const str = constructPaymentString(data);
    const hydrated = hydratePaymentData(str);
    expect(hydrated).toEqual(data);
  });

  it('handles unknown network', () => {
    const result = hydratePaymentData('unknown:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(result.network).toBe(CryptoNetwork.CUSTOM);
  });

  it('handles no colon', () => {
    const result = hydratePaymentData('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    expect(result.network).toBe(CryptoNetwork.CUSTOM);
    expect(result.address).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  });

  it('returns default state for http urls', () => {
    const expected = {
      network: CryptoNetwork.BITCOIN,
      address: '',
      amount: '',
      label: '',
    };
    expect(hydratePaymentData('https://example.com')).toEqual(expected);
    expect(hydratePaymentData('http://example.com')).toEqual(expected);
  });

  it('handles query parameters without amount or label', () => {
    const result = hydratePaymentData('bitcoin:1A1z?other=123');
    expect(result.amount).toBe('');
    expect(result.label).toBe('');
  });

  describe('EPC SEPA QR codes', () => {
    it('constructs and hydrates SEPA EPC QR payloads', () => {
      const sepaData = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'DE89370400440532013000',
        iban: 'DE89370400440532013000',
        name: 'Jane Doe',
        bic: 'MIDLGB22',
        amount: '12.50',
        label: 'Invoice 123',
      };
      const str = constructPaymentString(sepaData);
      expect(str).toBe('BCD\n002\n1\nSCT\nMIDLGB22\nJane Doe\nDE89370400440532013000\nEUR12.50\n\n\nInvoice 123\n');

      const hydrated = hydratePaymentData(str);
      expect(hydrated).toEqual(sepaData);
    });

    it('handles SEPA payload without BIC or amount', () => {
      const sepaData = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'FR7630006000011234567890189',
        iban: 'FR7630006000011234567890189',
        name: 'John Smith',
        bic: '',
        amount: '',
        label: 'Gift',
      };
      const str = constructPaymentString(sepaData);
      expect(str).toBe('BCD\n002\n1\nSCT\n\nJohn Smith\nFR7630006000011234567890189\n\n\n\nGift\n');

      const hydrated = hydratePaymentData(str);
      expect(hydrated.network).toBe(CryptoNetwork.EPC_SEPA);
      expect(hydrated.iban).toBe('FR7630006000011234567890189');
      expect(hydrated.name).toBe('John Smith');
      expect(hydrated.amount).toBe('');
      expect(hydrated.label).toBe('Gift');
    });

    it('enforces EPC069-12 character bounds by truncating name and label', () => {
      const longName = 'A'.repeat(100);
      const longLabel = 'B'.repeat(200);
      const sepaData = {
        network: CryptoNetwork.EPC_SEPA,
        address: ' de89 3704 0044 0532 0130 00 ',
        name: longName,
        label: longLabel,
        amount: '',
      };
      const str = constructPaymentString(sepaData);
      const lines = str.split(/\r?\n/);

      // IBAN stripped of spaces and uppercased
      expect(lines[6]).toBe('DE89370400440532013000');
      // Name truncated to 70 chars
      expect(lines[5]).toBe('A'.repeat(70));
      // Label truncated to 140 chars
      expect(lines[10]).toBe('B'.repeat(140));
    });
  });

  describe('PayPal payment preset', () => {
    it('constructs and hydrates PayPal link', () => {
      const paypalData = {
        network: CryptoNetwork.PAYPAL,
        address: 'johndoe',
        amount: '25',
        label: '',
      };
      const str = constructPaymentString(paypalData);
      expect(str).toBe('https://paypal.me/johndoe/25');

      const hydrated = hydratePaymentData(str);
      expect(hydrated.network).toBe(CryptoNetwork.PAYPAL);
      expect(hydrated.address).toBe('johndoe');
      expect(hydrated.amount).toBe('25');
    });

    it('cleans handle with full URL', () => {
      const str = constructPaymentString({
        network: CryptoNetwork.PAYPAL,
        address: 'https://paypal.me/johndoe',
        amount: '',
        label: '',
      });
      expect(str).toBe('https://paypal.me/johndoe');
    });
  });

  describe('Venmo payment preset', () => {
    it('constructs and hydrates Venmo link', () => {
      const venmoData = {
        network: CryptoNetwork.VENMO,
        address: '@johndoe',
        amount: '15.50',
        label: 'Lunch',
      };
      const str = constructPaymentString(venmoData);
      expect(str).toBe('https://venmo.com/u/johndoe?amount=15.50&note=Lunch&txn=pay');

      const hydrated = hydratePaymentData(str);
      expect(hydrated.network).toBe(CryptoNetwork.VENMO);
      expect(hydrated.address).toBe('johndoe');
      expect(hydrated.amount).toBe('15.50');
      expect(hydrated.label).toBe('Lunch');
    });
  });

  describe('Cash App payment preset', () => {
    it('constructs and hydrates Cash App link', () => {
      const cashData = {
        network: CryptoNetwork.CASH_APP,
        address: '$johndoe',
        amount: '50',
        label: '',
      };
      const str = constructPaymentString(cashData);
      expect(str).toBe('https://cash.app/$johndoe/50');

      const hydrated = hydratePaymentData(str);
      expect(hydrated.network).toBe(CryptoNetwork.CASH_APP);
      expect(hydrated.address).toBe('$johndoe');
      expect(hydrated.amount).toBe('50');
    });
  });

  it('implements PaymentContract correctly and validates raw strings', () => {
    expect(PaymentContract.type).toBe(QRType.PAYMENT);
    expect(PaymentContract.matches('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
    expect(PaymentContract.matches('BCD\n002\n1\nSCT\n\nJane Doe\nDE89370400440532013000\nEUR10\n\n\nInvoice\n')).toBe(true);
    expect(PaymentContract.matches('https://paypal.me/johndoe')).toBe(true);
    expect(PaymentContract.matches('https://cash.app/$johndoe')).toBe(true);
    expect(PaymentContract.matches('https://venmo.com/u/johndoe')).toBe(true);
    expect(PaymentContract.matches('random')).toBe(false);

    // Empty validation
    expect(PaymentContract.validate?.('')).toEqual([]);

    // Safe validation
    expect(PaymentContract.validate?.('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toEqual([]);

    // Dangerous validation
    expect(PaymentContract.validate?.('javascript:alert(1)')).toEqual(['URI_INJECTION_VIOLATION']);
  });
});
