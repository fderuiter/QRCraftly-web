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

import { PaymentData, CryptoNetwork, QRType, QRGeneratorContract } from '@/types';
import { isDangerousUrl, sanitizeInput, REGEX_STRICT_CONTROL_CHARS } from '@/utils/security';
import { identifyProtocol, safeDecodeURIComponent } from '../protocol';

/** Number of wei in one ether (10^18), as used by EIP-681 `value=`. */
const WEI_DECIMALS = 18;

/**
 * Converts a decimal ether amount to an integer wei string using exact string
 * arithmetic (no floating point), e.g. "0.1" -> "100000000000000000".
 * @param amount - The decimal ether amount entered by the user.
 * @returns The wei amount, or null when the input is not a plain non-negative
 * decimal or has more than 18 fractional digits.
 */
const etherToWei = (amount: string): string | null => {
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: the digit runs are separated by a literal '.' and anchored.
  const match = /^(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  if (!match) return null;
  const whole = match[1] || '';
  const fraction = match[2] || '';
  if (!whole && !fraction) return null;
  if (fraction.length > WEI_DECIMALS) return null;
  const digits = (whole + fraction.padEnd(WEI_DECIMALS, '0')).replace(/^0+/, '');
  return digits || '0';
};

/**
 * Converts an EIP-681 `value=` (integer wei, optionally in scientific notation such
 * as `2.014e18`) back to a decimal ether amount using exact string arithmetic.
 * @param value - The raw `value` parameter.
 * @returns The ether amount without trailing zeros, or null when it is not a valid integer amount.
 */
const weiToEther = (value: string): string | null => {
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: digit runs are separated by literal '.' / 'e' and anchored.
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]\+?(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const intPart = match[1];
  const fracPart = match[2] || '';
  const exponent = match[3] ? parseInt(match[3], 10) : 0;
  if (fracPart.length > exponent) return null; // not a whole number of wei
  const wei = (intPart + fracPart.padEnd(exponent, '0')).replace(/^0+/, '') || '0';
  const padded = wei.padStart(WEI_DECIMALS + 1, '0');
  const whole = padded.slice(0, padded.length - WEI_DECIMALS);
  const fraction = padded.slice(padded.length - WEI_DECIMALS).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
};

/**
 * Percent-encodes a wallet address so `&`, `#`, `%` or whitespace cannot inject
 * URI parameters. `@` is kept for EIP-681 chain ids (`address@chainId`).
 */
const encodeAddress = (address: string): string => {
  return encodeURIComponent(address.trim()).replace(/%40/g, '@');
};

const cleanIban = (iban: string): string => {
  return iban.replace(/\s+/g, '').toUpperCase();
};

const cleanPayPalHandle = (handle: string): string => {
  let clean = handle.trim();
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: non-overlapping optional scheme and domain prefix.
  clean = clean.replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '');
  clean = clean.replace(/^@/, '');
  return clean;
};

const cleanVenmoHandle = (handle: string): string => {
  let clean = handle.trim();
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: non-overlapping optional scheme and domain prefix.
  clean = clean.replace(/^(https?:\/\/)?(www\.)?venmo\.com\/(u\/)?/i, '');
  clean = clean.replace(/^@/, '');
  return clean;
};

const cleanCashAppHandle = (handle: string): string => {
  let clean = handle.trim();
  // eslint-disable-next-line security/detect-unsafe-regex -- linear: non-overlapping optional scheme and domain prefix.
  clean = clean.replace(/^(https?:\/\/)?(www\.)?cash\.app\//i, '');
  clean = clean.replace(/^\$/, '');
  return clean;
};

/** Decimal places each network's amount can carry (BIP-21 and EIP-681 amounts, EPC euro cents). */
const AMOUNT_DECIMALS: Partial<Record<CryptoNetwork, number>> = {
  [CryptoNetwork.BITCOIN]: 8,
  [CryptoNetwork.LITECOIN]: 8,
  [CryptoNetwork.SOLANA]: 9,
  [CryptoNetwork.ETHEREUM]: WEI_DECIMALS,
  [CryptoNetwork.EPC_SEPA]: 2,
  [CryptoNetwork.PAYPAL]: 2,
  [CryptoNetwork.VENMO]: 2,
  [CryptoNetwork.CASH_APP]: 2,
};

/** EPC069-12: at most EUR 999,999,999.99. */
const EPC_MAX_AMOUNT = 999999999.99;

/**
 * Says what is wrong with a payment amount, so it is refused instead of encoded as `-1` or
 * `1e3`, or silently dropped (#1283). Amounts are plain decimals (BIP-21 §`amount`) within the network's decimal places.
 * @param amount - The typed amount.
 * @param network - The payment network.
 * @returns A sentence, or `null` when the amount is empty or fine.
 */
export const paymentAmountError = (amount: string | undefined, network: CryptoNetwork): string | null => {
  const value = (amount || '').trim();
  const decimals = AMOUNT_DECIMALS[network];
  if (!value || decimals === undefined) return null;
  // The integer and fraction digits are split by a literal '.', so the match is linear.
  // eslint-disable-next-line security/detect-unsafe-regex
  const match = /^(\d{0,15})(?:\.(\d+))?$/.exec(value);
  if (!match || !/\d/.test(value)) {
    return 'Enter the amount as a plain number, such as 12.50.';
  }
  if ((match[2] || '').length > decimals) {
    return `This amount can have at most ${decimals} decimal place${decimals === 1 ? '' : 's'}.`;
  }
  if (network === CryptoNetwork.EPC_SEPA && Number(value) > EPC_MAX_AMOUNT) {
    return 'A SEPA transfer code can ask for at most EUR 999,999,999.99.';
  }
  return null;
};

/** Removes control characters (line breaks would shift every EPC field after them). */
const epcText = (value: string | undefined, maxLength: number): string =>
  (value || '').replace(REGEX_STRICT_CONTROL_CHARS, ' ').trim().slice(0, maxLength);

/**
 * Constructs the payment URI or payload string.
 */
export const constructPaymentString = (data: PaymentData): string => {
  if (!data) return '';

  if (data.network === CryptoNetwork.CUSTOM) {
    if (isDangerousUrl(data.address)) {
      return '';
    }
    return data.address;
  }

  // An amount the network cannot carry is refused, never encoded or silently dropped (#1283).
  if (data.network !== CryptoNetwork.EPC_SEPA && paymentAmountError(data.amount, data.network)) {
    return '';
  }

  if (data.network === CryptoNetwork.EPC_SEPA) {
    const iban = cleanIban(data.iban || data.address || '');
    // EPC fields are plain lines, so `?` and `&` are ordinary text here (`A? B & Co`).
    const name = epcText(data.name, 70);
    const bic = epcText(data.bic, 11).toUpperCase();
    const label = epcText(data.label, 140);
    const amount = (data.amount || '').trim().replace(/^EUR/i, '');
    // The beneficiary name and IBAN are mandatory (EPC069-12), and a bad amount is refused.
    if (!iban || !name || paymentAmountError(amount, CryptoNetwork.EPC_SEPA)) return '';
    const amountStr = amount ? `EUR${Number(amount).toFixed(2)}` : '';

    const lines = [
      'BCD',
      '002',
      '1',
      'SCT',
      bic,
      name,
      iban,
      amountStr,
      '', // Purpose
      '', // Remittance Reference
      label, // Remittance Text
      '', // Information
    ];
    // Trailing empty fields may be left out, and the payload must not end in a line break.
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  if (data.network === CryptoNetwork.PAYPAL) {
    const handle = cleanPayPalHandle(sanitizeInput(data.address || ''));
    if (!handle) return '';
    const parts = handle.split('/').filter(Boolean);
    const username = parts[0] ? encodeURIComponent(parts[0]) : '';
    if (!username) return '';
    const amount = data.amount ? data.amount.trim() : (parts[1] || '');
    let url = `https://paypal.me/${username}`;
    if (amount) {
      url += `/${encodeURIComponent(amount)}`;
    }
    if (isDangerousUrl(url)) return '';
    return url;
  }

  if (data.network === CryptoNetwork.VENMO) {
    const username = cleanVenmoHandle(sanitizeInput(data.address || ''));
    if (!username) return '';
    const encodedUser = encodeURIComponent(username);
    let url = `https://venmo.com/u/${encodedUser}`;
    const params: string[] = [];
    if (data.amount) {
      params.push(`amount=${encodeURIComponent(data.amount.trim())}`);
    }
    if (data.label) {
      params.push(`note=${encodeURIComponent(data.label.trim())}`);
    }
    if (params.length > 0) {
      params.push('txn=pay');
      url += `?${params.join('&')}`;
    }
    if (isDangerousUrl(url)) return '';
    return url;
  }

  if (data.network === CryptoNetwork.CASH_APP) {
    const cashtag = cleanCashAppHandle(sanitizeInput(data.address || ''));
    if (!cashtag) return '';
    let url = `https://cash.app/$${encodeURIComponent(cashtag)}`;
    if (data.amount) {
      url += `/${encodeURIComponent(data.amount.trim())}`;
    }
    if (isDangerousUrl(url)) return '';
    return url;
  }

  // Known crypto networks
  const validCryptoNetworks = [
    CryptoNetwork.BITCOIN,
    CryptoNetwork.ETHEREUM,
    CryptoNetwork.SOLANA,
    CryptoNetwork.LITECOIN,
  ];

  if (!validCryptoNetworks.includes(data.network)) {
    return '';
  }

  // Sanitize address to prevent parameter injection
  const safeAddress = encodeAddress(sanitizeInput(data.address || ''));
  let paymentString = `${data.network}:${safeAddress}`;
  const params: string[] = [];

  if (data.amount) {
    if (data.network === CryptoNetwork.ETHEREUM) {
      // EIP-681: the amount is `value=` in wei; wallets ignore `amount=`.
      const wei = etherToWei(data.amount);
      if (wei !== null) {
        params.push(`value=${wei}`);
      }
    } else {
      params.push(`amount=${encodeURIComponent(data.amount)}`);
    }
  }

  if (data.label) {
    params.push(`label=${encodeURIComponent(data.label)}`);
  }

  if (params.length > 0) {
    paymentString += `?${params.join('&')}`;
  }

  if (isDangerousUrl(paymentString)) return '';
  return paymentString;
};

/**
 * Hydrates PaymentData from a raw string.
 */
export const hydratePaymentData = (raw: string): PaymentData => {
  const result: PaymentData = {
    network: CryptoNetwork.BITCOIN,
    address: '',
    amount: '',
    label: '',
  };

  if (!raw || typeof raw !== 'string') return result;

  // 1. EPC SEPA QR parsing
  if (raw.startsWith('BCD\n') || raw.startsWith('BCD\r\n')) {
    const lines = raw.split(/\r?\n/);
    if (lines[0] === 'BCD') {
      const bic = lines[4] || '';
      const name = lines[5] || '';
      const iban = lines[6] || '';
      const rawAmount = lines[7] || '';
      const amount = rawAmount.toUpperCase().startsWith('EUR') ? rawAmount.slice(3) : rawAmount;
      const label = lines[10] || '';
      return {
        network: CryptoNetwork.EPC_SEPA,
        address: iban,
        iban,
        name,
        bic,
        amount,
        label,
      };
    }
  }

  // 2. Fiat Payment Links (PayPal, Venmo, Cash App)
  if (/paypal\.me\//i.test(raw)) {
    const idx = raw.toLowerCase().indexOf('paypal.me/');
    const path = raw.substring(idx + 10);
    const parts = path.split('?')[0].split('/').filter(Boolean);
    const address = safeDecodeURIComponent(parts[0] || '');
    const amount = parts[1] ? safeDecodeURIComponent(parts[1]) : '';
    return {
      network: CryptoNetwork.PAYPAL,
      address,
      amount,
      label: '',
    };
  }

  if (/venmo\.com\//i.test(raw)) {
    const idx = raw.toLowerCase().indexOf('venmo.com/');
    const pathAndQuery = raw.substring(idx + 10);
    const [path, query] = pathAndQuery.split('?');
    const cleanPath = path.replace(/^u\//i, '').replace(/\/$/, '');
    const address = safeDecodeURIComponent(cleanPath);
    const searchParams = new URLSearchParams(query || '');
    const amount = searchParams.get('amount') || '';
    const label = searchParams.get('note') || searchParams.get('label') || '';
    return {
      network: CryptoNetwork.VENMO,
      address,
      amount,
      label,
    };
  }

  if (/cash\.app\//i.test(raw)) {
    const idx = raw.toLowerCase().indexOf('cash.app/');
    const path = raw.substring(idx + 9);
    const parts = path.split('?')[0].split('/').filter(Boolean);
    let handle = safeDecodeURIComponent(parts[0] || '');
    if (handle && !handle.startsWith('$')) {
      handle = `$${handle}`;
    }
    const amount = parts[1] ? safeDecodeURIComponent(parts[1]) : '';
    return {
      network: CryptoNetwork.CASH_APP,
      address: handle,
      amount,
      label: '',
    };
  }

  // 3. Known crypto networks
  const validNetworks = [
    CryptoNetwork.BITCOIN,
    CryptoNetwork.ETHEREUM,
    CryptoNetwork.SOLANA,
    CryptoNetwork.LITECOIN,
  ];

  const colonIndex = raw.indexOf(':');
  if (colonIndex !== -1) {
    // Schemes are case-insensitive, and upper-case BIP-21 URIs make smaller QR codes.
    const networkPart = raw.substring(0, colonIndex).toLowerCase() as CryptoNetwork;
    if (validNetworks.includes(networkPart)) {
      result.network = networkPart;

      const rest = raw.substring(colonIndex + 1);
      const qIndex = rest.indexOf('?');
      if (qIndex !== -1) {
        result.address = safeDecodeURIComponent(rest.substring(0, qIndex));
        const query = rest.substring(qIndex + 1);
        const params = new Map<string, string>();
        new URLSearchParams(query).forEach((value, key) => {
          if (!params.has(key.toLowerCase())) params.set(key.toLowerCase(), value);
        });
        const weiValue = params.get('value');
        const ether =
          networkPart === CryptoNetwork.ETHEREUM && weiValue ? weiToEther(weiValue) : null;
        result.amount = ether ?? (params.get('amount') || '');
        result.label = params.get('label') || '';
      } else {
        result.address = safeDecodeURIComponent(rest);
      }
      return result;
    }
  }

  // If starts with http/https and wasn't matched above, fall back safely to default BITCOIN state
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return {
      network: CryptoNetwork.BITCOIN,
      address: '',
      amount: '',
      label: '',
    };
  }

  result.network = CryptoNetwork.CUSTOM;
  result.address = raw;
  return result;
};

export const PaymentContract: QRGeneratorContract<PaymentData> = {
  type: QRType.PAYMENT,
  construct: constructPaymentString,
  hydrate: hydratePaymentData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.PAYMENT,
  validate: (raw: string) => {
    const violations: string[] = [];
    if (raw && isDangerousUrl(raw)) {
      violations.push('URI_INJECTION_VIOLATION');
    }
    const data = hydratePaymentData(raw);
    if (paymentAmountError(data.amount, data.network)) {
      violations.push('PAYMENT_AMOUNT_VIOLATION');
    }
    return violations;
  },
};
