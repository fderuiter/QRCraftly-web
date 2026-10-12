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

import { childAt, DerError, readChildren, readDerAll, readOid, readString, readTime, TAG, type DerNode } from './der';
import { WalletPassError } from './errors';

/** Subject attribute OIDs a pass certificate uses. */
export const NAME_OIDS = {
  commonName: '2.5.4.3',
  country: '2.5.4.6',
  organization: '2.5.4.10',
  organizationalUnit: '2.5.4.11',
  userId: '0.9.2342.19200300.100.1.1',
} as const;

/** The parts of an X.509 certificate that signing a pass needs. */
export interface CertificateInfo {
  /** The whole certificate, DER encoded. */
  der: Uint8Array;
  /** The serial number's INTEGER contents. */
  serialNumber: Uint8Array;
  /** The issuer Name, DER encoded, exactly as in the certificate. */
  issuer: Uint8Array;
  /** The subject Name, DER encoded. */
  subject: Uint8Array;
  /** Subject attributes by OID (the first value of each). */
  subjectAttributes: Record<string, string>;
  notBefore: Date;
  notAfter: Date;
  /** The SubjectPublicKeyInfo, DER encoded, for WebCrypto `importKey('spki')`. */
  publicKeyInfo: Uint8Array;
}

function readName(node: DerNode): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const rdn of readChildren(node)) {
    for (const pair of readChildren(rdn)) {
      const key = readOid(childAt(pair, 0, TAG.OID));
      if (!(key in attributes)) attributes[key] = readString(childAt(pair, 1));
    }
  }
  return attributes;
}

/** Reads a DER certificate. */
export function readCertificate(der: Uint8Array): CertificateInfo {
  try {
    const certificate = readDerAll(der);
    const tbs = childAt(certificate, 0, TAG.SEQUENCE);
    const fields = readChildren(tbs);
    // The version is an optional explicit [0]; when present every other field moves along by one.
    const at = fields[0]?.tag === 0xa0 ? 1 : 0;
    const serial = fields[at];
    const issuer = fields[at + 2];
    const validity = fields[at + 3];
    const subject = fields[at + 4];
    const spki = fields[at + 5];
    if (serial?.tag !== TAG.INTEGER || issuer?.tag !== TAG.SEQUENCE || validity?.tag !== TAG.SEQUENCE || subject?.tag !== TAG.SEQUENCE || spki?.tag !== TAG.SEQUENCE) {
      throw new DerError('Unexpected certificate layout.');
    }
    return {
      der,
      serialNumber: serial.value,
      issuer: issuer.bytes,
      subject: subject.bytes,
      subjectAttributes: readName(subject),
      notBefore: readTime(childAt(validity, 0)),
      notAfter: readTime(childAt(validity, 1)),
      publicKeyInfo: spki.bytes,
    };
  } catch (err) {
    if (err instanceof DerError) throw new WalletPassError('This file is not a certificate QRCraftly can read. Choose the PEM certificate file.');
    throw err;
  }
}

/** Whether `issuer` is the certificate authority named as `subject`'s issuer. */
export function issuedBy(subject: CertificateInfo, issuer: CertificateInfo): boolean {
  return subject.issuer.length === issuer.subject.length && subject.issuer.every((byte, i) => byte === issuer.subject[i]);
}
