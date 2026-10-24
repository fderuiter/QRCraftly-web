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

import { CryptoNetwork } from './types';

/** Number of wei in one ether (10^18), as used by EIP-681 `value=`. */
export const WEI_DECIMALS = 18;

/** Decimal places each network's amount can carry (BIP-21 and EIP-681 amounts, EPC euro cents, UPI paise). */
const AMOUNT_DECIMALS: Partial<Record<CryptoNetwork, number>> = {
  [CryptoNetwork.BITCOIN]: 8,
  [CryptoNetwork.LITECOIN]: 8,
  [CryptoNetwork.SOLANA]: 9,
  [CryptoNetwork.ETHEREUM]: WEI_DECIMALS,
  [CryptoNetwork.EPC_SEPA]: 2,
  [CryptoNetwork.UPI]: 2,
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
