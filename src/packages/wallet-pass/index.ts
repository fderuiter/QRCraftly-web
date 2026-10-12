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

/**
 * Wallet passes made and signed in the browser (ADR 0048): Apple `.pkpass` files signed with the
 * person's own Pass Type ID certificate. Keys are imported as non-extractable WebCrypto keys and
 * live only in memory; nothing is sent anywhere.
 */
export { WalletPassError } from './lib/errors';
export {
  describePassContent,
  passColorsFrom,
  passRefusalReason,
  type PassColors,
  type PassContent,
  type PassField,
} from './lib/content';
export { createPassSigner, type ApplePassKeys, type PassSigner } from './lib/signer';
export {
  buildApplePass,
  buildPassJson,
  messageEncodingFor,
  type ApplePass,
  type ApplePassInput,
  type PassImageName,
  type PassJson,
} from './lib/pkpass';
export { readCertificate, type CertificateInfo } from './lib/certificate';
export { parsePem, type PemBlock } from './lib/pem';
// The minimal DER reader and writer behind the certificate and CMS code; the tests build their
// throwaway certificate authority with it, so no private key is ever committed.
export {
  algorithm,
  bitString,
  childAt,
  contextTag,
  integer,
  oid,
  readChildren,
  readDerAll,
  readOid,
  sequence,
  setOf,
  time,
  utf8String,
  type DerNode,
} from './lib/der';
