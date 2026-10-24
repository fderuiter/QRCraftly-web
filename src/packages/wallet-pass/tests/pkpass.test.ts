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

import { X509Certificate, createPublicKey, verify } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { QRType } from '@/packages/core/types';
import {
  buildApplePass,
  buildPassJson,
  createPassSigner,
  describePassContent,
  messageEncodingFor,
  parsePem,
  passColorsFrom,
  passRefusalReason,
  readCertificate,
  WalletPassError,
  type PassSigner,
} from '../index';
import { childAt, readChildren, readDerAll, readOid } from '../index';
import { makeTestPki, readStoredZip, TEST_ORGANIZATION, TEST_PASS_TYPE, TEST_TEAM_ID, type TestPki } from './testPki';

const utf8 = (text: string) => new TextEncoder().encode(text);
const ICON = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 1, 2, 3);
const SIGNED_AT = new Date(Date.UTC(2026, 9, 12, 19, 30, 0));

let pki: TestPki;
let signer: PassSigner;

beforeAll(async () => {
  pki = await makeTestPki();
  signer = await createPassSigner({ certificateFiles: [utf8(pki.certificatePem), utf8(pki.intermediatePem)], privateKeyPem: pki.privateKeyPem });
}, 30_000);

async function sha(algorithm: 'SHA-1' | 'SHA-256', data: Uint8Array) {
  return new Uint8Array(await crypto.subtle.digest(algorithm, data as BufferSource));
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function wifiPass() {
  return {
    content: describePassContent({ type: QRType.WIFI, value: 'WIFI:T:WPA;S:Home Network;P:hunter2;;' }, { title: 'Home WiFi', subtitle: 'Guests welcome' }),
    colors: passColorsFrom({ fgColor: '#123456', bgColor: '#ffffff' }),
    description: 'WiFi for Home Network',
    images: { 'icon.png': ICON },
    serialNumber: 'serial-1',
  };
}

describe('wallet-pass: Apple passes signed in the browser (#1410)', () => {
  it('reads the Pass Type ID, Team ID and organization from the certificate', () => {
    expect(signer.passTypeIdentifier).toBe(TEST_PASS_TYPE);
    expect(signer.teamIdentifier).toBe(TEST_TEAM_ID);
    expect(signer.organizationName).toBe(TEST_ORGANIZATION);
    expect(signer.expires.getUTCFullYear()).toBe(2120);
    // Node's own X.509 parser agrees with ours.
    const node = new X509Certificate(pki.certificatePem);
    const ours = readCertificate(parsePem(pki.certificatePem)[0].bytes);
    expect(hex(ours.serialNumber).toUpperCase()).toBe(node.serialNumber.replace(/^0+/, '').padStart(hex(ours.serialNumber).length, '0'));
    expect(node.subject).toContain(`OU=${TEST_TEAM_ID}`);
  });

  it('builds a .pkpass whose manifest lists the SHA-1 of every file and whose signature verifies', async () => {
    const { bytes, passJson } = await buildApplePass(signer, wifiPass(), SIGNED_AT);
    const files = readStoredZip(bytes);
    expect([...files.keys()]).toEqual(['pass.json', 'icon.png', 'manifest.json', 'signature']);
    const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
    expect(Object.keys(manifest)).toEqual(['pass.json', 'icon.png']);
    for (const name of ['pass.json', 'icon.png']) expect(manifest[name]).toBe(hex(await sha('SHA-1', files.get(name)!)));
    expect(JSON.parse(new TextDecoder().decode(files.get('pass.json')))).toEqual(passJson);

    // Walk the CMS structure: ContentInfo > [0] SignedData > SignerInfo.
    const contentInfo = readDerAll(files.get('signature')!);
    expect(readOid(childAt(contentInfo, 0))).toBe('1.2.840.113549.1.7.2');
    const signedData = childAt(childAt(contentInfo, 1), 0);
    const [version, , encapsulated, certificates, signerInfos] = readChildren(signedData);
    expect(version.value).toEqual(Uint8Array.of(1));
    // Detached: the content type is data and there is no content.
    expect(readChildren(encapsulated)).toHaveLength(1);
    // The signer's certificate and the intermediate are both included.
    expect(readChildren(certificates)).toHaveLength(2);
    const signerInfo = readChildren(signerInfos)[0];
    const [, , , signedAttrs, , signature] = readChildren(signerInfo);
    expect(signedAttrs.tag).toBe(0xa0);

    const attributes = new Map(readChildren(signedAttrs).map((attr) => [readOid(childAt(attr, 0)), childAt(childAt(attr, 1), 0)]));
    expect(readOid(attributes.get('1.2.840.113549.1.9.3')!)).toBe('1.2.840.113549.1.7.1');
    expect(attributes.get('1.2.840.113549.1.9.4')!.value).toEqual(await sha('SHA-256', files.get('manifest.json')!));
    expect(new TextDecoder().decode(attributes.get('1.2.840.113549.1.9.5')!.value)).toBe('261012193000Z');

    // What is signed is the attributes re-tagged as a SET. Check it with Node's crypto, not ours.
    const signedBytes = Uint8Array.from(signedAttrs.bytes);
    signedBytes[0] = 0x31;
    const publicKey = createPublicKey(pki.certificatePem);
    expect(verify('sha256', signedBytes, publicKey, signature.value)).toBe(true);
    signedBytes[signedBytes.length - 1] ^= 1;
    expect(verify('sha256', signedBytes, publicKey, signature.value)).toBe(false);
  });

  it('writes a generic pass with one QR barcode, no web service and readable colours', () => {
    const json = buildPassJson(signer, wifiPass());
    expect(json).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: TEST_PASS_TYPE,
      teamIdentifier: TEST_TEAM_ID,
      serialNumber: 'serial-1',
      organizationName: TEST_ORGANIZATION,
      description: 'WiFi for Home Network',
      foregroundColor: 'rgb(255, 255, 255)',
      backgroundColor: 'rgb(18, 52, 86)',
      barcodes: [{ format: 'PKBarcodeFormatQR', message: 'WIFI:T:WPA;S:Home Network;P:hunter2;;', messageEncoding: 'iso-8859-1' }],
    });
    expect(json.generic.primaryFields).toEqual([{ key: 'title', label: 'Guests welcome', value: 'Home WiFi' }]);
    expect(json.generic.secondaryFields.map((f) => f.value)).toEqual(['Home Network', 'WPA/WPA2']);
    expect(json.generic.backFields.find((f) => f.key === 'password')?.value).toBe('hunter2');
    expect(json).not.toHaveProperty('webServiceURL');
    expect(json).not.toHaveProperty('authenticationToken');
    expect(buildPassJson(signer, { ...wifiPass(), serialNumber: undefined }).serialNumber).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('picks UTF-8 only for text Latin-1 cannot hold', () => {
    expect(messageEncodingFor('https://example.com/café')).toBe('iso-8859-1');
    expect(messageEncodingFor('Grüße ✓')).toBe('utf-8');
    expect(messageEncodingFor('日本')).toBe('utf-8');
  });

  it('falls back to black on white when the design colours are too close for text', () => {
    expect(passColorsFrom({ fgColor: '#777777', bgColor: '#888888' })).toEqual({ foreground: '#000000', background: '#ffffff', label: '#000000' });
    expect(passColorsFrom({ fgColor: 'not a colour', bgColor: '#ffffff' }).background).toBe('#ffffff');
  });

  it('puts links and other text on the back, and refuses payment codes', () => {
    const link = describePassContent({ type: QRType.URL, value: 'example.com/menu' }, { title: 'Menu' });
    expect(link.message).toBe('https://example.com/menu');
    expect(link.backFields[0]).toEqual({ key: 'link', label: 'Link', value: 'https://example.com/menu' });
    expect(describePassContent({ type: QRType.TEXT, value: 'hello' }, { title: 'Note' }).backFields[0].value).toBe('hello');
    expect(() => describePassContent({ type: QRType.PAYMENT, value: 'bitcoin:bc1q' }, { title: 'Pay' })).toThrow(/lock screen/);
    expect(() => describePassContent({ type: QRType.TEXT, value: ' ' }, { title: 'Empty' })).toThrow(WalletPassError);
    expect(() => describePassContent({ type: QRType.TEXT, value: 'x' }, { title: '  ' })).toThrow(/title/);
    expect(passRefusalReason(QRType.BULK_CSV)).not.toBeNull();
  });

  it('accepts a PKCS#1 key, one PEM file holding both certificates, and DER .cer files', async () => {
    const pkcs1 = await createPassSigner({ certificateFiles: [utf8(pki.intermediatePem + pki.certificatePem)], privateKeyPem: pki.pkcs1KeyPem });
    expect(pkcs1.passTypeIdentifier).toBe(TEST_PASS_TYPE);
    const der = await createPassSigner({ certificateFiles: [parsePem(pki.intermediatePem)[0].bytes, parsePem(pki.certificatePem)[0].bytes], privateKeyPem: pki.privateKeyPem });
    expect(der.teamIdentifier).toBe(TEST_TEAM_ID);
  });

  it('explains what is wrong with the files', async () => {
    const base = { certificateFiles: [utf8(pki.certificatePem), utf8(pki.intermediatePem)], privateKeyPem: pki.privateKeyPem };
    await expect(createPassSigner({ ...base, privateKeyPem: pki.otherKeyPem })).rejects.toThrow(/does not belong/);
    await expect(createPassSigner({ ...base, certificateFiles: [utf8(pki.certificatePem)] })).rejects.toThrow(/WWDR intermediate/);
    await expect(createPassSigner({ ...base, certificateFiles: [utf8(pki.intermediatePem)] })).rejects.toThrow(/No Pass Type ID certificate/);
    await expect(createPassSigner({ ...base, certificateFiles: [utf8('just text')] })).rejects.toThrow(/No Pass Type ID certificate/);
    await expect(createPassSigner({ ...base, privateKeyPem: 'nothing here' })).rejects.toThrow(/No private key/);
    const dashes = '-----';
    const encrypted = `${dashes}BEGIN ENCRYPTED PRIVATE KEY${dashes}\nAAAA\n${dashes}END ENCRYPTED PRIVATE KEY${dashes}`;
    await expect(createPassSigner({ ...base, privateKeyPem: encrypted })).rejects.toThrow(/password/);
    await expect(createPassSigner(base, new Date(Date.UTC(2019, 0, 1)))).rejects.toThrow(/valid from 2020-01-01/);
    await expect(createPassSigner({ ...base, certificateFiles: [utf8(`${dashes}BEGIN CERTIFICATE${dashes}\nAAAA\n${dashes}END CERTIFICATE${dashes}`)] })).rejects.toThrow(/not a certificate/);
    await expect(buildApplePass(signer, { ...wifiPass(), images: {} })).rejects.toThrow(/icon/);
  });
});
