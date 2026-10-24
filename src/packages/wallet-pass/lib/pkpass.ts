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

import { createZip } from '@/packages/core/zip';
import { cleanPassText, type PassColors, type PassContent, type PassField } from './content';
import { WalletPassError } from './errors';
import type { PassSigner } from './signer';

/** Image files a generic pass may carry. `icon.png` is required by Apple. */
export const PASS_IMAGE_NAMES = ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'logo@3x.png', 'thumbnail.png', 'thumbnail@2x.png', 'thumbnail@3x.png'] as const;
export type PassImageName = (typeof PASS_IMAGE_NAMES)[number];

/** What a pass is made from, besides the signer. */
export interface ApplePassInput {
  content: PassContent;
  colors: PassColors;
  /** Shown as the pass's issuer; defaults to the certificate's organization. */
  organizationName?: string;
  /** Read by VoiceOver and shown in notifications, for example "WiFi for Home". */
  description: string;
  /** PNG images by file name. `icon.png` is required. */
  images: Partial<Record<PassImageName, Uint8Array>>;
  /** When the pass greys out by itself. */
  expirationDate?: Date;
  /** A unique serial number; a random UUID when left out. */
  serialNumber?: string;
}

/** The `pass.json` QRCraftly writes: a generic pass with one QR barcode and no web service. */
export interface PassJson {
  formatVersion: 1;
  passTypeIdentifier: string;
  teamIdentifier: string;
  serialNumber: string;
  organizationName: string;
  description: string;
  foregroundColor: string;
  backgroundColor: string;
  labelColor: string;
  generic: {
    primaryFields: PassField[];
    secondaryFields: PassField[];
    auxiliaryFields: PassField[];
    backFields: PassField[];
  };
  barcodes: { format: 'PKBarcodeFormatQR'; message: string; messageEncoding: 'iso-8859-1' | 'utf-8'; altText?: string }[];
  expirationDate?: string;
}

function rgb(hex: string): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff})`;
}

/**
 * The barcode's text encoding. Apple recommends ISO-8859-1, which can only hold Latin-1, so other
 * text is encoded as UTF-8, matching the bytes the generator puts in its own code.
 */
export function messageEncodingFor(message: string): 'iso-8859-1' | 'utf-8' {
  return /^[\u0000-ÿ]*$/.test(message) ? 'iso-8859-1' : 'utf-8';
}

/** Writes `pass.json` for a signer and input. There is never a `webServiceURL`, so a pass cannot change after it is made. */
export function buildPassJson(signer: Pick<PassSigner, 'passTypeIdentifier' | 'teamIdentifier' | 'organizationName'>, input: ApplePassInput): PassJson {
  const { content, colors } = input;
  const organizationName = cleanPassText(input.organizationName || signer.organizationName, 64) || 'QRCraftly';
  const description = cleanPassText(input.description, 120) || content.title;
  const passJson: PassJson = {
    formatVersion: 1,
    passTypeIdentifier: signer.passTypeIdentifier,
    teamIdentifier: signer.teamIdentifier,
    serialNumber: input.serialNumber ?? crypto.randomUUID(),
    organizationName,
    description,
    foregroundColor: rgb(colors.foreground),
    backgroundColor: rgb(colors.background),
    labelColor: rgb(colors.label),
    generic: {
      // The subtitle is the primary field's label, the small line above the title.
      primaryFields: [{ key: 'title', label: content.subtitle ?? '', value: content.title }],
      secondaryFields: content.fields.slice(0, 2),
      auxiliaryFields: content.fields.slice(2, 4),
      backFields: content.backFields,
    },
    barcodes: [{ format: 'PKBarcodeFormatQR', message: content.message, messageEncoding: messageEncodingFor(content.message), ...(content.altText ? { altText: content.altText } : {}) }],
  };
  if (input.expirationDate) passJson.expirationDate = input.expirationDate.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return passJson;
}

async function sha1Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data as BufferSource));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A finished, signed pass. */
export interface ApplePass {
  /** The `.pkpass` archive. */
  bytes: Uint8Array;
  passJson: PassJson;
}

/**
 * Builds and signs a `.pkpass`: `pass.json`, the images, `manifest.json` (the SHA-1 of every
 * file, as Apple requires) and `signature` (a detached CMS signature of the manifest), stored in
 * a ZIP archive. Everything happens on the device.
 */
export async function buildApplePass(signer: PassSigner, input: ApplePassInput, signingTime: Date = new Date()): Promise<ApplePass> {
  if (!input.images['icon.png']) throw new WalletPassError('A pass needs an icon.');
  const passJson = buildPassJson(signer, input);
  const files: [string, Uint8Array][] = [['pass.json', new TextEncoder().encode(JSON.stringify(passJson, null, 2))]];
  for (const name of PASS_IMAGE_NAMES) {
    const image = input.images[name];
    if (image) files.push([name, image]);
  }
  const manifest: Record<string, string> = {};
  for (const [name, data] of files) manifest[name] = await sha1Hex(data);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  const signature = await signer.sign(manifestBytes, signingTime);
  const entries = [...files, ['manifest.json', manifestBytes] as [string, Uint8Array], ['signature', signature] as [string, Uint8Array]];
  return { bytes: createZip(entries.map(([name, data]) => ({ name, data })), { date: signingTime }), passJson };
}
