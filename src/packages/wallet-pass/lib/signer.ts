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

import { issuedBy, NAME_OIDS, readCertificate, type CertificateInfo } from './certificate';
import { wasmCmsSign, wasmRsaSign } from './crypto';
import { WalletPassError } from './errors';
import { certificatesFromFile, privateKeyToPkcs8 } from './pem';

const RSA_SHA256 = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

/** The files a person loads to sign Apple passes. Nothing here is stored. */
export interface ApplePassKeys {
  /**
   * The certificate files, in any order: the Pass Type ID certificate and Apple's WWDR
   * intermediate, each PEM (one or more certificates) or DER (`.cer`).
   */
  certificateFiles: readonly Uint8Array[];
  /** The certificate's private key (PEM, PKCS#8 or PKCS#1, without a password). */
  privateKeyPem: string;
}

/** Signs `manifest.json` for one pass type, with keys held only in memory. */
export interface PassSigner {
  /** The Pass Type ID from the certificate, for example `pass.com.example.menu`. */
  passTypeIdentifier: string;
  /** The Apple Developer Team ID from the certificate. */
  teamIdentifier: string;
  /** The certificate holder's organization, a sensible default for `organizationName`. */
  organizationName: string;
  /** When the certificate stops working. */
  expires: Date;
  /** Returns the detached CMS signature of `manifest`. */
  sign(manifest: Uint8Array, signingTime?: Date): Promise<Uint8Array>;
}

/** Validates and parses an RSA private key PEM using WebAssembly kernel. */
export async function importRsaSigningKey(pem: string): Promise<CryptoKey> {
  try {
    const pkcs8 = privateKeyToPkcs8(pem);
    return await crypto.subtle.importKey('pkcs8', pkcs8 as BufferSource, RSA_SHA256, false, ['sign']);
  } catch (err) {
    if (err instanceof WalletPassError) throw err;
    throw new WalletPassError('This private key could not be loaded. Use an RSA private key in PEM form.');
  }
}

/** Checks that the private key belongs to the certificate by signing and verifying a probe using WASM. */
async function assertKeyMatchesPem(pem: string, certificate: CertificateInfo): Promise<void> {
  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey('spki', certificate.publicKeyInfo as BufferSource, RSA_SHA256, false, ['verify']);
  } catch {
    throw new WalletPassError('This certificate does not have an RSA key. Apple Pass Type ID certificates use RSA.');
  }
  const probe = crypto.getRandomValues(new Uint8Array(32));
  const signature = await wasmRsaSign(pem, probe);
  if (!(await crypto.subtle.verify(RSA_SHA256, publicKey, signature as BufferSource, probe as BufferSource))) {
    throw new WalletPassError('This private key does not belong to the certificate. Choose the key that was made with this certificate.');
  }
}

/**
 * Loads an Apple Pass Type ID certificate, its private key and Apple's WWDR intermediate, and
 * checks them: the certificate names a Pass Type ID and Team ID, is valid now, was issued by the
 * intermediate, and the key matches it.
 * @param keys - The person's certificate and key files.
 * @param now - The time to check validity against.
 * @throws WalletPassError with a message that says what to fix.
 */
export async function createPassSigner(keys: ApplePassKeys, now: Date = new Date()): Promise<PassSigner> {
  const certificates = keys.certificateFiles.flatMap(certificatesFromFile).map(readCertificate);
  const signer = certificates.find((cert) => cert.subjectAttributes[NAME_OIDS.userId]?.startsWith('pass.'));
  if (!signer) {
    throw new WalletPassError('No Pass Type ID certificate was found. Its subject starts with "Pass Type ID:" and holds an identifier such as pass.com.example.menu.');
  }
  const teamIdentifier = signer.subjectAttributes[NAME_OIDS.organizationalUnit];
  if (!teamIdentifier) throw new WalletPassError('The certificate has no Team ID (its organizational unit).');
  if (now < signer.notBefore || now > signer.notAfter) {
    throw new WalletPassError(`This certificate is valid from ${signer.notBefore.toISOString().slice(0, 10)} to ${signer.notAfter.toISOString().slice(0, 10)}, so it cannot sign passes now.`);
  }
  const intermediate = certificates.find((cert) => cert !== signer && issuedBy(signer, cert));
  if (!intermediate) {
    throw new WalletPassError("Apple's WWDR intermediate certificate is missing, or it is not the one that issued this certificate. Download the matching one from apple.com/certificateauthority and add it.");
  }
  if (now > intermediate.notAfter) {
    throw new WalletPassError(`The WWDR intermediate certificate expired on ${intermediate.notAfter.toISOString().slice(0, 10)}. Download the current one from apple.com/certificateauthority.`);
  }
  // Validate key format and check match against certificate using WASM
  await importRsaSigningKey(keys.privateKeyPem);
  await assertKeyMatchesPem(keys.privateKeyPem, signer);

  return {
    passTypeIdentifier: signer.subjectAttributes[NAME_OIDS.userId],
    teamIdentifier,
    organizationName: signer.subjectAttributes[NAME_OIDS.organization] ?? '',
    expires: signer.notAfter,
    sign: (manifest, signingTime = new Date()) =>
      wasmCmsSign(manifest, signer.der, [intermediate.der], keys.privateKeyPem, signingTime),
  };
}
