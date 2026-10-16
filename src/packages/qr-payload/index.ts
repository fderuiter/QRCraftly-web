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

// High-level polymorphic API seam
export {
  formatPayload,
  parsePayload,
  validatePayload,
  QR_GENERATORS,
  type QRPayloadDataMap,
} from './lib/registry';

// Config validation & sanitization
export {
  validateConfig,
  sanitizeConfig,
} from './lib/validators';

// Plain-language messages for violation codes
export { describeViolation } from './lib/violations';

// Type-aware sample fallback payloads
export {
  getSamplePayload,
  SAMPLE_PAYLOADS,
} from './lib/samplePayloads';

// Protocol & containment profiles
export {
  identifyProtocol,
  canHydrate,
  parseProtocol,
  CONTAINMENT_PROFILES,
} from './lib/protocol';

// RFC escaping & datetime utilities
export {
  escapeVCardEvent,
  unescapeVCardEvent,
  foldString,
  unfoldString,
  splitCompoundField,
  formatEventDateTime,
  parseEventDateTime,
} from './lib/rfcHelper';

// Concrete generator contracts & individual helpers
export { WifiContract, constructWifiString, hydrateWifiData } from './lib/generators/wifi';
export { EmailContract, constructEmailString, hydrateEmailData } from './lib/generators/email';
export { VCardContract, constructVCardString, hydrateVCardData } from './lib/generators/vcard';
export { constructPhoneString, hydratePhoneData, droppedPhoneCharacters } from './lib/generators/phone';
export { SmsContract, constructSmsString, hydrateSmsData } from './lib/generators/sms';
export { PaymentContract, constructPaymentString, hydratePaymentData, paymentAmountError } from './lib/generators/payment';
export { EventContract, constructEventString, hydrateEventData } from './lib/generators/event';
export { UrlContract, constructUrlString } from './lib/generators/url';
export { constructTextString, hydrateTextData } from './lib/generators/text';
export { constructLocationString, hydrateLocationData, coordinateError } from './lib/generators/location';
export { MeetingContract, constructMeetingString, hydrateMeetingData } from './lib/generators/meeting';
export { constructSocialString, hydrateSocialData } from './lib/generators/social';
export { BulkCsvContract, constructBulkCsvString, hydrateBulkCsvData } from './lib/generators/bulkCsv';

// Wallet address checksums (Base58Check, bech32/bech32m, EIP-55)
export { checkCryptoAddress, type AddressCheck } from './lib/cryptoAddress';

// IBAN validation (ISO 13616 mod-97)
export { isValidIban } from './lib/iban';
