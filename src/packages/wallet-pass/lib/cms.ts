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

import { algorithm, concatBytes, contextTag, integer, octetString, oid, sequence, setOf, time } from './der';
import type { CertificateInfo } from './certificate';

/** Object identifiers for a detached CMS SignedData (RFC 5652) with SHA-256 and RSA. */
export const CMS_OIDS = {
  data: '1.2.840.113549.1.7.1',
  signedData: '1.2.840.113549.1.7.2',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5',
  sha256: '2.16.840.1.101.3.4.2.1',
  rsaEncryption: '1.2.840.113549.1.1.1',
} as const;

/** What a detached signature is made from. */
export interface DetachedSignatureInput {
  /** The signed bytes (for a pass, `manifest.json`). They are not embedded. */
  content: Uint8Array;
  /** The signer's certificate. */
  signer: CertificateInfo;
  /** Further certificates to include, such as Apple's WWDR intermediate. */
  chain: readonly CertificateInfo[];
  /** Signs the DER signed attributes with RSASSA-PKCS1-v1_5 over SHA-256. */
  sign: (data: Uint8Array) => Promise<Uint8Array>;
  /** The signing time attribute. */
  signingTime: Date;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

/** The signed attributes as a DER SET: what is actually signed (RFC 5652 section 5.4). */
export async function signedAttributes(content: Uint8Array, signingTime: Date): Promise<Uint8Array> {
  return setOf(
    sequence(oid(CMS_OIDS.contentType), setOf(oid(CMS_OIDS.data))),
    sequence(oid(CMS_OIDS.signingTime), setOf(time(signingTime))),
    sequence(oid(CMS_OIDS.messageDigest), setOf(octetString(await sha256(content))))
  );
}

/**
 * Builds a detached CMS SignedData, the `signature` file of a `.pkpass`: one SignerInfo
 * identified by issuer and serial number, signed attributes (content type, signing time and
 * message digest), and the signer's certificate plus the chain.
 * @returns The DER ContentInfo.
 */
export async function signDetached(input: DetachedSignatureInput): Promise<Uint8Array> {
  const attributes = await signedAttributes(input.content, input.signingTime);
  const signature = await input.sign(attributes);
  // In the SignerInfo the attributes are an IMPLICIT [0]: the same contents under tag 0xA0.
  const implicitAttributes = Uint8Array.from(attributes);
  implicitAttributes[0] = 0xa0;
  const signerInfo = sequence(
    integer(1),
    sequence(input.signer.issuer, integer(input.signer.serialNumber)),
    algorithm(CMS_OIDS.sha256),
    implicitAttributes,
    algorithm(CMS_OIDS.rsaEncryption),
    octetString(signature)
  );
  const signedData = sequence(
    integer(1),
    setOf(algorithm(CMS_OIDS.sha256)),
    sequence(oid(CMS_OIDS.data)),
    contextTag(0, concatBytes([input.signer.der, ...input.chain.map((cert) => cert.der)])),
    setOf(signerInfo)
  );
  return sequence(oid(CMS_OIDS.signedData), contextTag(0, signedData));
}
