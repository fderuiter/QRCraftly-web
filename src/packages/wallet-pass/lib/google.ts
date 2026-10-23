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

import { wasmRsaSign } from './crypto';
import { WalletPassError } from './errors';
import type { PassColors, PassContent } from './content';

/**
 * Google Wallet save links signed in the browser (#1411): a generic pass class and object carried
 * whole in a JWT ("fat" JWT), signed RS256 with the person's own service-account key, then opened
 * at pay.google.com. Google receives the content when the person saves the pass.
 */

/** Where a signed JWT is opened to save the pass. */
export const GOOGLE_SAVE_URL = 'https://pay.google.com/gp/v/save/';

/** The parts of a Google Cloud service-account key file that signing needs. */
export interface GoogleServiceAccount {
  /** The service account's address, the JWT issuer. */
  serviceAccountEmail: string;
  privateKeyPem: string;
}

/**
 * Reads a service-account key file (the JSON Google Cloud downloads).
 * @throws WalletPassError when it is not one.
 */
export function readServiceAccount(json: string): GoogleServiceAccount {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new WalletPassError('This file is not JSON. Choose the service-account key file Google Cloud downloaded.');
  }
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const [serviceAccountEmail, privateKeyPem] = [record['client_email'], record['private_key']];
  if (record.type !== 'service_account' || typeof serviceAccountEmail !== 'string' || typeof privateKeyPem !== 'string' || !serviceAccountEmail.includes('@')) {
    throw new WalletPassError('This is not a service-account key file. In Google Cloud, open the service account, then Keys, and add a JSON key.');
  }
  return { serviceAccountEmail, privateKeyPem };
}

/** A Google Wallet Issuer ID is a long number from the Google Pay & Wallet Console. */
export function isIssuerId(value: string): boolean {
  return /^\d{10,25}$/.test(value.trim());
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const encodeJson = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

/** Google object IDs allow letters, digits, `.`, `_` and `-` after the issuer ID. */
const safeId = (text: string) => text.replace(/[^\w.-]/g, '_');

const localized = (value: string) => ({ defaultValue: { language: 'en-US', value } });

/** What a Google Wallet pass is made from. */
export interface GoogleWalletInput {
  issuerId: string;
  content: PassContent;
  colors: PassColors;
  /** The name shown at the top of the pass (`cardTitle`). */
  issuerName: string;
  /** A unique part of the object ID; random when left out. */
  objectSuffix?: string;
  /** The signing time (`iat`). */
  now?: Date;
}

/** The generic class every QRCraftly pass of one issuer shares. It carries no content. */
export const googleClassId = (issuerId: string) => `${issuerId.trim()}.qrcraftly_generic`;

/** The JWT claims for a save link: one generic class and one generic object. */
export function googleSaveClaims(account: GoogleServiceAccount, input: GoogleWalletInput) {
  if (!isIssuerId(input.issuerId)) throw new WalletPassError('Enter your Issuer ID: the long number shown in the Google Pay & Wallet Console.');
  const issuerId = input.issuerId.trim();
  const { content } = input;
  const classId = googleClassId(issuerId);
  const genericObject = {
    id: `${issuerId}.${safeId(input.objectSuffix ?? crypto.randomUUID())}`,
    classId,
    state: 'ACTIVE',
    cardTitle: localized(input.issuerName.trim() || 'QRCraftly'),
    header: localized(content.title),
    ...(content.subtitle ? { subheader: localized(content.subtitle) } : {}),
    hexBackgroundColor: input.colors.background,
    barcode: { type: 'QR_CODE', value: content.message, ...(content.altText ? { alternateText: content.altText } : {}) },
    textModulesData: [...content.fields, ...content.backFields].map((field) => ({ id: safeId(field.key), header: field.label || ' ', body: field.value })),
  };
  return {
    iss: account.serviceAccountEmail,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor((input.now ?? new Date()).getTime() / 1000),
    origins: [] as string[],
    payload: { genericClasses: [{ id: classId }], genericObjects: [genericObject] },
  };
}

/** A signed save link. */
export interface GoogleSaveLink {
  url: string;
  jwt: string;
}

/**
 * Signs a save link with the service account's key, on the device.
 * @throws WalletPassError for a bad key, Issuer ID or content.
 */
export async function buildGoogleSaveLink(account: GoogleServiceAccount, input: GoogleWalletInput): Promise<GoogleSaveLink> {
  const claims = googleSaveClaims(account, input);
  const signingInput = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson(claims)}`;
  const signature = await wasmRsaSign(account.privateKeyPem, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64Url(signature)}`;
  return { url: `${GOOGLE_SAVE_URL}${jwt}`, jwt };
}
