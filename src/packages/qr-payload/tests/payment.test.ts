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
import {
  constructPaymentString,
  describeViolation,
  hydratePaymentData,
  identifyProtocol,
  PaymentContract,
  paymentRefusal,
} from '../index';
import { CryptoNetwork, type PaymentData } from '../index';
import { QRType } from '@/packages/core/types';

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
      expect(str).toBe('BCD\n002\n1\nSCT\nMIDLGB22\nJane Doe\nDE89370400440532013000\nEUR12.50\n\n\nInvoice 123');

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
      expect(str).toBe('BCD\n002\n1\nSCT\n\nJohn Smith\nFR7630006000011234567890189\n\n\n\nGift');

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

    it('generates payment payload even when IBAN checksum is invalid', () => {
      const sepaData = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'DE88370400440532013000', // Invalid checksum
        name: 'Jane Doe',
        amount: '10.00',
        label: '',
      };
      expect(constructPaymentString(sepaData)).toBe(
        'BCD\n002\n1\nSCT\n\nJane Doe\nDE88370400440532013000\nEUR10.00'
      );
    });

    it('returns empty payload when beneficiary name is missing', () => {
      const sepaData = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'DE89370400440532013000',
        name: '',
        amount: '10.00',
        label: '',
      };
      expect(constructPaymentString(sepaData)).toBe('');
    });

    it('returns empty payload when SEPA amount exceeds limit or decimal rules', () => {
      const invalidDecimal = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'DE89370400440532013000',
        name: 'Jane Doe',
        amount: '10.123',
        label: '',
      };
      expect(constructPaymentString(invalidDecimal)).toBe('');

      const exceedLimit = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'DE89370400440532013000',
        name: 'Jane Doe',
        amount: '1000000000.00',
        label: '',
      };
      expect(constructPaymentString(exceedLimit)).toBe('');
    });
  });

  describe('paymentRefusal', () => {
    it('returns null for empty or whitespace-only SEPA data', () => {
      const emptyData: PaymentData = {
        network: CryptoNetwork.EPC_SEPA,
        address: '   ',
        iban: '   ',
        name: '   ',
        amount: '   ',
        bic: '   ',
        label: '   ',
      };
      expect(paymentRefusal(emptyData)).toBeNull();
    });

    it('returns SEPA_NAME_VIOLATION when IBAN is present but name is missing', () => {
      const data: PaymentData = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'DE89370400440532013000',
        name: '',
        amount: '',
        label: '',
      };
      expect(paymentRefusal(data)).toBe('SEPA_NAME_VIOLATION');
    });

    it('returns SEPA_IBAN_VIOLATION when name is present but IBAN is missing', () => {
      const data: PaymentData = {
        network: CryptoNetwork.EPC_SEPA,
        address: '',
        name: 'Jane Doe',
        amount: '',
        label: '',
      };
      expect(paymentRefusal(data)).toBe('SEPA_IBAN_VIOLATION');
    });

    it('returns PAYMENT_AMOUNT_VIOLATION when amount is invalid', () => {
      const data: PaymentData = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'DE89370400440532013000',
        name: 'Jane Doe',
        amount: '10.123',
        label: '',
      };
      expect(paymentRefusal(data)).toBe('PAYMENT_AMOUNT_VIOLATION');
    });

    it('returns null when IBAN checksum is invalid but name and amount are valid', () => {
      const data: PaymentData = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'DE88370400440532013000', // Invalid checksum
        name: 'Jane Doe',
        amount: '10.00',
        label: '',
      };
      expect(paymentRefusal(data)).toBeNull();
    });

    it('returns null for complete valid SEPA data', () => {
      const data: PaymentData = {
        network: CryptoNetwork.EPC_SEPA,
        address: 'DE89370400440532013000',
        name: 'Jane Doe',
        amount: '10.00',
        label: '',
      };
      expect(paymentRefusal(data)).toBeNull();
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

describe('UPI payment preset (#1469)', () => {
  const upi = (overrides: Partial<PaymentData> = {}): PaymentData => ({
    network: CryptoNetwork.UPI,
    address: 'jane@okaxis',
    name: 'Jane Doe',
    amount: '',
    label: '',
    ...overrides,
  });

  describe('constructPaymentString', () => {
    it('builds a upi://pay link with a literal @, cu=INR and encoded name and note', () => {
      expect(
        constructPaymentString({
          network: CryptoNetwork.UPI,
          address: 'jane@okaxis',
          name: 'Jane Doe',
          amount: '250.50',
          label: 'Rent & bills',
        })
      ).toBe('upi://pay?pa=jane@okaxis&pn=Jane%20Doe&am=250.50&cu=INR&tn=Rent%20%26%20bills');
    });

    it('always includes cu=INR and leaves out a blank amount or note', () => {
      expect(constructPaymentString(upi())).toBe('upi://pay?pa=jane@okaxis&pn=Jane%20Doe&cu=INR');
      expect(constructPaymentString(upi({ amount: '', label: '' }))).toBe(
        'upi://pay?pa=jane@okaxis&pn=Jane%20Doe&cu=INR'
      );
    });

    it('leaves out a whitespace-only amount or note', () => {
      expect(constructPaymentString(upi({ amount: '   ', label: ' \t ' }))).toBe(
        'upi://pay?pa=jane@okaxis&pn=Jane%20Doe&cu=INR'
      );
    });

    it('accepts the boundary amounts with two decimal places and refuses a third', () => {
      expect(constructPaymentString(upi({ amount: '0.01' }))).toContain('&am=0.01&cu=INR');
      expect(constructPaymentString(upi({ amount: '12.34' }))).toContain('&am=12.34&cu=INR');
      expect(constructPaymentString(upi({ amount: '12.345' }))).toBe('');
      expect(paymentRefusal(upi({ amount: '12.345' }))).toBe('PAYMENT_AMOUNT_VIOLATION');
    });

    it('turns control characters in the name into spaces and trims them', () => {
      expect(constructPaymentString(upi({ name: 'Jane\nDoe' }))).toBe(
        'upi://pay?pa=jane@okaxis&pn=Jane%20Doe&cu=INR'
      );
      expect(constructPaymentString(upi({ name: '  Jane\u0000  ' }))).toBe(
        'upi://pay?pa=jane@okaxis&pn=Jane&cu=INR'
      );
    });

    it('turns control characters in the note into spaces and trims them', () => {
      expect(constructPaymentString(upi({ label: 'Rent\r\nMay\t' }))).toBe(
        'upi://pay?pa=jane@okaxis&pn=Jane%20Doe&cu=INR&tn=Rent%20May'
      );
    });

    it.each(['jane', 'jane@', '@okaxis', 'j@okaxis', 'jane@ok axis'])(
      'refuses the UPI ID %j',
      (address) => {
        expect(constructPaymentString(upi({ address }))).toBe('');
        expect(paymentRefusal(upi({ address }))).toBe('UPI_VPA_VIOLATION');
      }
    );

    it.each(['', '   ', '\n\t'])('refuses a blank payee name %j with a valid UPI ID', (name) => {
      expect(constructPaymentString(upi({ name }))).toBe('');
      expect(paymentRefusal(upi({ name }))).toBe('UPI_NAME_VIOLATION');
    });

    it('treats an all-blank or all-whitespace UPI form as empty, not refused', () => {
      const empty = upi({ address: '', name: '', amount: '', label: '' });
      const blank = upi({ address: '   ', name: '   ', amount: '   ', label: '   ' });
      expect(paymentRefusal(empty)).toBeNull();
      expect(paymentRefusal(blank)).toBeNull();
      expect(constructPaymentString(empty)).toBe('');
      expect(constructPaymentString(blank)).toBe('');
    });
  });

  describe('hydratePaymentData', () => {
    it('hydrates a full form back to the same data', () => {
      const data = upi({ amount: '250.50', label: 'Rent & bills' });
      expect(hydratePaymentData(constructPaymentString(data))).toEqual(data);
    });

    it('hydrates a form without amount or note back to the same data', () => {
      const data = upi({ amount: '', label: '' });
      expect(hydratePaymentData(constructPaymentString(data))).toEqual(data);
    });
  });

  describe('identifyProtocol', () => {
    it('identifies a link the form can rebuild byte for byte as PAYMENT', () => {
      expect(identifyProtocol('upi://pay?pa=jane@okaxis&pn=Jane&cu=INR')).toBe(QRType.PAYMENT);
      expect(identifyProtocol(constructPaymentString(upi({ amount: '250.50', label: 'Rent' })))).toBe(
        QRType.PAYMENT
      );
    });

    it.each([
      ['a currency other than INR', 'upi://pay?pa=jane@okaxis&pn=Jane&cu=USD'],
      ['a merchant code', 'upi://pay?pa=jane@okaxis&pn=Jane&cu=INR&mc=1234'],
      ['an encoded @ in the UPI ID', 'upi://pay?pa=jane%40okaxis&pn=Jane&cu=INR'],
      ['no payee name', 'upi://pay?pa=jane@okaxis&cu=INR'],
    ])('identifies a link with %s as TEXT', (_label, raw) => {
      expect(identifyProtocol(raw)).toBe(QRType.TEXT);
    });
  });

  describe('PaymentContract', () => {
    it('flags a UPI link without a payee name', () => {
      expect(PaymentContract.validate?.('upi://pay?pa=jane@okaxis&cu=INR')).toContain('UPI_NAME_VIOLATION');
    });

    it('raises no violation for a complete UPI link', () => {
      expect(PaymentContract.validate?.('upi://pay?pa=jane@okaxis&pn=Jane%20Doe&cu=INR')).toEqual([]);
    });
  });

  describe('describeViolation', () => {
    it.each(['UPI_VPA_VIOLATION', 'UPI_NAME_VIOLATION'])('describes %s as a sentence, not the raw code', (code) => {
      const message = describeViolation(code);
      expect(message).not.toBe(code);
      expect(message).toMatch(/\s/);
      expect(message).toMatch(/\.$/);
    });
  });
});
