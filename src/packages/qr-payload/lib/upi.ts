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

import { CryptoNetwork, type PaymentData } from './types';
import { REGEX_STRICT_CONTROL_CHARS } from '@/packages/core/security';
import { paymentAmountError } from './paymentAmount';

/**
 * A UPI ID (virtual payment address): a handle, `@`, and the payment app's handle, such as
 * `jane.doe@okaxis`. Only these characters occur in one, so a valid ID needs no percent-encoding.
 */
const VPA_PATTERN = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/;

/** Longest payee name the form takes. */
export const UPI_NAME_MAX_LENGTH = 70;

/** Removes control characters, which would break the `upi://pay` link (#1469). */
const upiText = (value: string | undefined): string =>
  (value || '').replace(REGEX_STRICT_CONTROL_CHARS, ' ').trim();

/**
 * Says what is wrong with a UPI ID.
 * @param vpa - The typed UPI ID.
 * @returns A sentence, or `null` when the ID is empty or has the `handle@bank` shape.
 */
export const upiVpaError = (vpa: string | undefined): string | null => {
  const value = (vpa || '').trim();
  if (!value || VPA_PATTERN.test(value)) return null;
  return 'Enter a UPI ID in the form name@bank, such as jane@okaxis.';
};

/**
 * Says why a UPI form cannot make a code. An all-blank form is empty, not refused.
 * @param data - Payment form data on the UPI network.
 * @returns A violation code, or `null` when the form is empty or makes a code.
 */
export const upiRefusal = (data: PaymentData): string | null => {
  const vpa = (data.address || '').trim();
  const name = upiText(data.name);
  if (!vpa && !name && !(data.amount || '').trim() && !upiText(data.label)) return null;
  if (!vpa || upiVpaError(vpa)) return 'UPI_VPA_VIOLATION';
  // Several UPI apps refuse a payment link without a payee name.
  if (!name) return 'UPI_NAME_VIOLATION';
  if (paymentAmountError(data.amount, CryptoNetwork.UPI)) return 'PAYMENT_AMOUNT_VIOLATION';
  return null;
};

/**
 * Builds a static `upi://pay` link in Indian rupees. `pa` keeps its `@` as typed, because some
 * UPI apps do not decode `%40`; the name and note are percent-encoded.
 * @param data - Payment form data on the UPI network.
 * @returns The link, or an empty string when the form is empty or refused.
 */
export const buildUpiPayload = (data: PaymentData): string => {
  const vpa = (data.address || '').trim();
  if (!vpa || upiRefusal(data) !== null) return '';
  const params = [`pa=${vpa}`, `pn=${encodeURIComponent(upiText(data.name))}`];
  const amount = (data.amount || '').trim();
  if (amount) params.push(`am=${amount}`);
  params.push('cu=INR');
  const note = upiText(data.label);
  if (note) params.push(`tn=${encodeURIComponent(note)}`);
  return `upi://pay?${params.join('&')}`;
};

/**
 * Reads a `upi://pay` link into the Payment form. The first of a repeated parameter wins.
 * @param raw - A decoded payload.
 * @returns The form data, or `null` when the payload is not a `upi://pay` link.
 */
export const parseUpiPayload = (raw: string): PaymentData | null => {
  if (!/^upi:\/\/pay\?/i.test(raw)) return null;
  const params = new Map<string, string>();
  new URLSearchParams(raw.slice(raw.indexOf('?') + 1)).forEach((value, key) => {
    if (!params.has(key.toLowerCase())) params.set(key.toLowerCase(), value);
  });
  return {
    network: CryptoNetwork.UPI,
    address: params.get('pa') || '',
    name: params.get('pn') || '',
    amount: params.get('am') || '',
    label: params.get('tn') || '',
  };
};

/**
 * Whether the Payment form can rebuild a `upi://pay` link byte for byte (#1450). Links with
 * other parameters (`mc`, `tr`, a currency other than INR) stay Text.
 * @param raw - A decoded payload.
 * @returns True when parsing and rebuilding the link gives the same string.
 */
export const isRebuildableUpiPayload = (raw: string): boolean => {
  const data = parseUpiPayload(raw);
  return data !== null && buildUpiPayload(data) === raw;
};
