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

import { describe, it, expect } from 'vitest';
import { QRType } from '@/packages/core/types';
import { CryptoNetwork, getSamplePayload } from '@/packages/qr-payload';
import { INPUT_REGISTRY, constructInput, hydrateInput, validateInput } from './InputRegistry';

const TYPES = Object.values(QRType);

describe('INPUT_REGISTRY contract', () => {
  it('has an entry for every QR type', () => {
    expect(Object.keys(INPUT_REGISTRY).sort()).toEqual([...TYPES].sort());
  });

  it.each(TYPES)('accepts and constructs the %s starting state', (type) => {
    const initial = INPUT_REGISTRY[type].initialState;
    expect(validateInput(type, initial)).toBeNull();
    expect(typeof constructInput(type, initial)).toBe('string');
  });

  it.each(TYPES)('round trips the %s sample through hydrate and construct', (type) => {
    const sample = getSamplePayload(type);
    const hydrated = hydrateInput(type, sample);
    if (!hydrated) return;
    const constructed = constructInput(type, hydrated);
    expect(constructInput(type, hydrateInput(type, constructed) ?? INPUT_REGISTRY[type].initialState)).toBe(constructed);
  });

  it('reads nothing from a payload its type cannot hold', () => {
    expect(hydrateInput(QRType.WIFI, 'https://example.com')).toBeNull();
  });
});

describe('validate', () => {
  const wifi = INPUT_REGISTRY[QRType.WIFI].initialState;
  const email = INPUT_REGISTRY[QRType.EMAIL].initialState;
  const vcard = INPUT_REGISTRY[QRType.VCARD].initialState;
  const payment = INPUT_REGISTRY[QRType.PAYMENT].initialState;

  it.each([
    [QRType.URL, { url: '' }],
    [QRType.URL, { url: '   ' }],
    [QRType.URL, { url: 'https://example.com' }],
    [QRType.MEETING, { url: '   ' }],
    [QRType.TEXT, { text: '   \n' }],
  ] as const)('lets a blank, whitespace or ordinary %s value through', (type, data) => {
    expect(validateInput(type, data)).toBeNull();
  });

  it.each([QRType.URL, QRType.MEETING] as const)('refuses a script link in a %s field', (type) => {
    expect(validateInput(type, { url: 'javascript:alert(1)' })).toBe('URI_INJECTION_VIOLATION');
  });

  it('refuses a script link typed as text', () => {
    expect(validateInput(QRType.TEXT, { text: 'javascript:alert(1)' })).toBe('URI_INJECTION_VIOLATION');
  });

  it.each(['ssid', 'password', 'eapIdentity'] as const)('refuses a zero-width character in the WiFi %s', (field) => {
    expect(validateInput(QRType.WIFI, { ...wifi, [field]: 'Home​Net' })).not.toBeNull();
    expect(validateInput(QRType.WIFI, { ...wifi, [field]: '   ' })).toBeNull();
  });

  it('accepts an empty email form and refuses a malformed recipient once anything is filled', () => {
    expect(validateInput(QRType.EMAIL, { ...email, subject: '   ' })).toBeNull();
    expect(validateInput(QRType.EMAIL, { ...email, subject: 'Hi' })).toBe('Add at least one recipient address.');
    expect(validateInput(QRType.EMAIL, { ...email, email: 'a@example.com', cc: 'not an address' })).not.toBeNull();
    expect(validateInput(QRType.EMAIL, { ...email, email: 'a@example.com, b@example.com' })).toBeNull();
  });

  it('refuses a script link as a contact website and a control character in a name', () => {
    expect(validateInput(QRType.VCARD, { ...vcard, website: 'javascript:alert(1)' })).toBe('Unsafe URL scheme or malicious protocol detected.');
    expect(validateInput(QRType.VCARD, { ...vcard, firstName: 'Ann\u0007' })).toBe('Contains invalid control or zero-width characters.');
    expect(validateInput(QRType.VCARD, { ...vcard, firstName: '   ' })).toBeNull();
  });

  it('refuses a script link as a payment address', () => {
    expect(validateInput(QRType.PAYMENT, { ...payment, address: 'javascript:alert(1)' })).toBe('URI_INJECTION_VIOLATION');
  });

  it('holds payment amounts to the network limits', () => {
    expect(validateInput(QRType.PAYMENT, { ...payment, amount: '0.00000001' })).toBeNull();
    expect(validateInput(QRType.PAYMENT, { ...payment, amount: '0.000000001' })).toBe('PAYMENT_AMOUNT_VIOLATION');
    expect(validateInput(QRType.PAYMENT, { ...payment, amount: '-1' })).toBe('PAYMENT_AMOUNT_VIOLATION');
    expect(validateInput(QRType.PAYMENT, { ...payment, network: CryptoNetwork.EPC_SEPA, amount: '1000000000' })).toBe('PAYMENT_AMOUNT_VIOLATION');
  });
});
