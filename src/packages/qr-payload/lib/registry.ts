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

import { QRType, type QRGeneratorContract } from '@/types';
import { isDangerousUrl } from '@/utils/security';
import { identifyProtocol, CONTAINMENT_PROFILES } from './protocol';
import { WifiContract } from './generators/wifi';
import { EmailContract } from './generators/email';
import { VCardContract } from './generators/vcard';
import { PhoneContract } from './generators/phone';
import { SmsContract } from './generators/sms';
import { PaymentContract } from './generators/payment';
import { EventContract } from './generators/event';
import { UrlContract } from './generators/url';
import { TextContract } from './generators/text';
import { LocationContract } from './generators/location';
import { MeetingContract } from './generators/meeting';
import { SocialContract } from './generators/social';
import { BulkCsvContract } from './generators/bulkCsv';

const GENERATOR_CONTRACTS = {
  [QRType.WIFI]: WifiContract,
  [QRType.EMAIL]: EmailContract,
  [QRType.VCARD]: VCardContract,
  [QRType.PHONE]: PhoneContract,
  [QRType.SMS]: SmsContract,
  [QRType.PAYMENT]: PaymentContract,
  [QRType.EVENT]: EventContract,
  [QRType.URL]: UrlContract,
  [QRType.TEXT]: TextContract,
  [QRType.LOCATION]: LocationContract,
  [QRType.MEETING]: MeetingContract,
  [QRType.SOCIAL]: SocialContract,
  [QRType.BULK_CSV]: BulkCsvContract,
};

type ContractData<C> = C extends QRGeneratorContract<infer T> ? T : never;

/** The structured payload data type of each QR type (e.g. `WifiData` for `QRType.WIFI`). */
export type QRPayloadDataMap = { [K in QRType]: ContractData<(typeof GENERATOR_CONTRACTS)[K]> };

/**
 * Pure, statically initialized dictionary of all 12 QR code generator contracts, keyed by type.
 * Free from side-effects or dynamic runtime mutations.
 */
export const QR_GENERATORS: { readonly [K in QRType]: QRGeneratorContract<QRPayloadDataMap[K]> } = GENERATOR_CONTRACTS;

/**
 * Looks up a contract for a runtime `type`. The union of contracts collapses to a contract over
 * `unknown` data; payload shape is validated by the contract itself.
 * @param type - The QR type, which may come from untrusted input.
 * @returns The contract, or undefined for an unknown type.
 */
function getGenerator(type: QRType): QRGeneratorContract<unknown> | undefined {
  return Object.prototype.hasOwnProperty.call(QR_GENERATORS, type) ? QR_GENERATORS[type] : undefined;
}

/**
 * Formats structured payload data into an RFC-compliant QR string according to type.
 *
 * @param type - The target QRType.
 * @param data - The type-specific payload data structure.
 * @returns The constructed QR payload string.
 */
export function formatPayload(type: QRType, data: unknown): string {
  const generator = getGenerator(type);
  if (!generator) {
    throw new Error(`Unsupported QR type: ${type}`);
  }
  if (!data) {
    throw new TypeError(`Payload data is required for QR type: ${type}`);
  }
  return generator.construct(data);
}

/**
 * Parses and hydrates a raw QR payload string into its structured data representation.
 */
// The overloads return loosely typed data: callers (the package tests) read type-specific fields
// without narrowing. Use `QR_GENERATORS[type].hydrate` for a typed result.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function parsePayload(type: QRType, raw: string): any;
export function parsePayload(raw: string): { type: QRType; data: any };
/* eslint-enable @typescript-eslint/no-explicit-any */
export function parsePayload(typeOrRaw: QRType | string, maybeRaw?: string): unknown {
  if (arguments.length >= 2) {
    const type = typeOrRaw as QRType;
    const raw = typeof maybeRaw === 'string' ? maybeRaw : (maybeRaw == null ? '' : String(maybeRaw));
    const generator = getGenerator(type);
    if (!generator) return null;
    try {
      return generator.hydrate(raw);
    } catch (_e) {
      return null;
    }
  }

  const raw = typeof typeOrRaw === 'string' ? typeOrRaw : (typeOrRaw == null ? '' : String(typeOrRaw));
  const type = identifyProtocol(raw) || QRType.TEXT;
  const generator = getGenerator(type);

  let data: unknown;
  if (generator) {
    try {
      data = generator.hydrate(raw);
    } catch (_e) {
      data = { text: raw };
    }
  } else {
    data = { text: raw };
  }

  return {
    type,
    data,
  };
}

/**
 * Validates a raw QR payload string, returning an array of security or structural violation codes.
 *
 * @param raw - The raw payload string to validate.
 * @param type - Optional explicit QRType. If omitted, protocol identification is used.
 * @returns An array of violation codes/messages. Empty array if valid.
 */
export function validatePayload(raw: string, type?: QRType): string[] {
  if (!raw || typeof raw !== 'string') return [];
  const violations: string[] = [];
  const effectiveType = type || identifyProtocol(raw) || QRType.TEXT;

  // Use stateless non-global regex to prevent lastIndex state leakage across validation calls
  const hiddenChars =
    effectiveType === QRType.WIFI ? CONTAINMENT_PROFILES.STRICT_NO_CONTROL : CONTAINMENT_PROFILES.TEXT_NO_CONTROL;
  if (hiddenChars.test(raw)) {
    violations.push('Payload contains invalid control or zero-width characters');
  }

  // Text-direction controls are refused where real text never needs them (#1160).
  if (
    (effectiveType === QRType.WIFI || effectiveType === QRType.PHONE || effectiveType === QRType.SMS) &&
    CONTAINMENT_PROFILES.BIDI_CONTROL.test(raw)
  ) {
    violations.push('Payload contains hidden text-direction characters');
  }

  // Every type, not only link types: a Text, Phone or Wi-Fi payload that opens with a script or
  // data scheme is refused too. The check is the starts-with-after-normalisation rule, so prose
  // that merely mentions "javascript:" mid-sentence still passes.
  if (isDangerousUrl(raw)) {
    violations.push('URI_INJECTION_VIOLATION');
  }

  const generator = getGenerator(effectiveType);

  if (generator && typeof generator.validate === 'function') {
    try {
      violations.push(...generator.validate(raw));
    } catch (_e) {
      // Proactive resilience: capture generator validation errors gracefully
    }
  }

  return Array.from(new Set(violations));
}
