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

import { wasmCertificatesFromFile, wasmPrivateKeyToPkcs8 } from './crypto';
import { TAG } from './der';
import { WalletPassError } from './errors';

/** One PEM block: its label (for example `CERTIFICATE`) and decoded bytes. */
export interface PemBlock {
  label: string;
  bytes: Uint8Array;
}

/** Decodes standard base64, ignoring whitespace. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 === 1) throw new WalletPassError('The file is not valid base64.');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Reads every PEM block in `text`. Text around the blocks (such as the "Bag Attributes" lines
 * OpenSSL writes) is ignored.
 */
export function parsePem(text: string): PemBlock[] {
  const blocks: PemBlock[] = [];
  const pattern = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    blocks.push({ label: match[1], bytes: base64ToBytes(match[2]) });
  }
  return blocks;
}

/**
 * Finds the private key in PEM text and returns it as PKCS#8.
 * Delegated to Rust WebAssembly kernel for zero-residue parsing.
 */
export function privateKeyToPkcs8(text: string): Uint8Array {
  return wasmPrivateKeyToPkcs8(text);
}

/** Returns every certificate in PEM text, in order. */
export function certificatesFromPem(text: string): Uint8Array[] {
  return parsePem(text)
    .filter((block) => block.label === 'CERTIFICATE')
    .map((block) => block.bytes);
}

/**
 * Reads the certificates in a file: PEM text with one or more certificates, or a single DER
 * certificate, which is how Apple's developer site downloads them (`.cer`).
 */
export function certificatesFromFile(bytes: Uint8Array): Uint8Array[] {
  try {
    return wasmCertificatesFromFile(bytes);
  } catch {
    const text = new TextDecoder().decode(bytes);
    if (text.includes('-----BEGIN')) return certificatesFromPem(text);
    return bytes.length > 0 && bytes[0] === TAG.SEQUENCE ? [bytes] : [];
  }
}
