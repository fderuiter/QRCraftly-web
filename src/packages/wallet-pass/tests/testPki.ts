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

import { algorithm, bitString, contextTag, integer, oid, readChildren, readDerAll, sequence, setOf, time, utf8String } from '../index';

/**
 * A throwaway certificate authority for tests, made fresh with WebCrypto on every run so no
 * private key is ever committed. It mimics Apple's layout: a "WWDR" intermediate issuing a
 * Pass Type ID certificate whose subject holds the pass type (UID) and the Team ID (OU).
 */

const SHA256_WITH_RSA = '1.2.840.113549.1.1.11';
const RSA = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' } as const;

export const TEST_PASS_TYPE = 'pass.com.example.qrcraftly-test';
export const TEST_TEAM_ID = 'ABCDE12345';
export const TEST_ORGANIZATION = 'QRCraftly Test Team';

function name(attributes: [string, string][]): Uint8Array {
  return sequence(...attributes.map(([type, value]) => setOf(sequence(oid(type), utf8String(value)))));
}

function toPem(label: string, bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const body = btoa(binary).replace(/.{1,64}/g, '$&\n');
  return `-----BEGIN ${label}-----\n${body}-----END ${label}-----\n`;
}

async function certificate(options: { serial: number; issuer: Uint8Array; subject: Uint8Array; publicKey: CryptoKey; signingKey: CryptoKey; notBefore: Date; notAfter: Date }): Promise<Uint8Array> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', options.publicKey));
  const tbs = sequence(
    contextTag(0, integer(2)),
    integer(options.serial),
    algorithm(SHA256_WITH_RSA),
    options.issuer,
    sequence(time(options.notBefore), time(options.notAfter)),
    options.subject,
    spki
  );
  const signature = new Uint8Array(await crypto.subtle.sign(RSA, options.signingKey, tbs as BufferSource));
  return sequence(tbs, algorithm(SHA256_WITH_RSA), bitString(signature));
}

/** PEM files for a test Pass Type ID certificate. */
export interface TestPki {
  certificatePem: string;
  privateKeyPem: string;
  /** The same key as PKCS#1 ("BEGIN RSA PRIVATE KEY"), as older OpenSSL writes it. */
  pkcs1KeyPem: string;
  intermediatePem: string;
  /** A key that does not belong to the certificate. */
  otherKeyPem: string;
  /** The certificate's public key, for checking signatures. */
  publicKey: CryptoKey;
}

/** Makes a fresh test CA and Pass Type ID certificate. */
export async function makeTestPki(validity: { notBefore?: Date; notAfter?: Date } = {}): Promise<TestPki> {
  const notBefore = validity.notBefore ?? new Date(Date.UTC(2020, 0, 1));
  const notAfter = validity.notAfter ?? new Date(Date.UTC(2120, 0, 1));
  const [ca, leaf, other] = await Promise.all([1, 2, 3].map(() => crypto.subtle.generateKey(RSA, true, ['sign', 'verify'])));
  const caName = name([['2.5.4.3', 'QRCraftly Test WWDR'], ['2.5.4.11', 'G4'], ['2.5.4.10', 'QRCraftly Test Authority']]);
  const leafName = name([
    ['0.9.2342.19200300.100.1.1', TEST_PASS_TYPE],
    ['2.5.4.3', `Pass Type ID: ${TEST_PASS_TYPE}`],
    ['2.5.4.11', TEST_TEAM_ID],
    ['2.5.4.10', TEST_ORGANIZATION],
  ]);
  const caCert = await certificate({ serial: 1, issuer: caName, subject: caName, publicKey: ca.publicKey, signingKey: ca.privateKey, notBefore: new Date(Date.UTC(2020, 0, 1)), notAfter: new Date(Date.UTC(2120, 0, 1)) });
  const leafCert = await certificate({ serial: 0x8a5f01, issuer: caName, subject: leafName, publicKey: leaf.publicKey, signingKey: ca.privateKey, notBefore, notAfter });
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', leaf.privateKey));
  const pkcs1 = readChildren(readDerAll(pkcs8))[2].value;
  const otherPkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', other.privateKey));
  return {
    certificatePem: toPem('CERTIFICATE', leafCert),
    privateKeyPem: toPem('PRIVATE KEY', pkcs8),
    pkcs1KeyPem: toPem('RSA PRIVATE KEY', pkcs1),
    intermediatePem: toPem('CERTIFICATE', caCert),
    otherKeyPem: toPem('PRIVATE KEY', otherPkcs8),
    publicKey: leaf.publicKey,
  };
}

/** Reads the stored (uncompressed) entries of a ZIP archive by their local headers. */
export function readStoredZip(zip: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    files.set(new TextDecoder().decode(zip.subarray(offset + 30, offset + 30 + nameLength)), zip.subarray(start, start + size));
    offset = start + size;
  }
  return files;
}
