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

import { createPublicKey, verify } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { QRType } from '@/packages/core/types';
import { buildGoogleSaveLink, describePassContent, googleSaveClaims, isIssuerId, passColorsFrom, readServiceAccount, WalletPassError, type GoogleServiceAccount } from '../index';
import { makeTestPki, type TestPki } from './testPki';

const ISSUER = '3388000000012345678';
let pki: TestPki;
let account: GoogleServiceAccount;

beforeAll(async () => {
  pki = await makeTestPki();
  account = readServiceAccount(JSON.stringify({ type: 'service_account', client_email: 'wallet@example.iam.gserviceaccount.com', private_key: pki.privateKeyPem, private_key_id: 'x' }));
}, 30_000);

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

function input() {
  return {
    issuerId: ISSUER,
    content: describePassContent({ type: QRType.WIFI, value: 'WIFI:T:WPA;S:Cafe;P:hunter2;;' }, { title: 'Cafe WiFi', subtitle: 'Ask staff for help' }),
    colors: passColorsFrom({ fgColor: '#123456', bgColor: '#ffffff' }),
    issuerName: 'Corner Cafe',
    objectSuffix: 'abc-123',
    now: new Date(Date.UTC(2026, 9, 12, 20, 0, 0)),
  };
}

describe('wallet-pass: Google Wallet save links signed in the browser (#1411)', () => {
  it('signs an RS256 JWT that Node verifies with the key', async () => {
    const { url, jwt } = await buildGoogleSaveLink(account, input());
    expect(url).toBe(`https://pay.google.com/gp/v/save/${jwt}`);
    const [header, claims, signature] = jwt.split('.');
    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(claims)).toEqual(googleSaveClaims(account, input()));
    const publicKey = createPublicKey(pki.certificatePem);
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${claims}x`), publicKey, Buffer.from(signature, 'base64url'))).toBe(false);
  });

  it('carries one generic class and object with the code, title and fields', () => {
    const claims = googleSaveClaims(account, input());
    expect(claims).toMatchObject({ iss: 'wallet@example.iam.gserviceaccount.com', aud: 'google', typ: 'savetowallet', iat: 1791835200 });
    expect(claims.payload.genericClasses).toEqual([{ id: `${ISSUER}.qrcraftly_generic` }]);
    const [object] = claims.payload.genericObjects;
    expect(object).toMatchObject({
      id: `${ISSUER}.abc-123`,
      classId: `${ISSUER}.qrcraftly_generic`,
      state: 'ACTIVE',
      cardTitle: { defaultValue: { language: 'en-US', value: 'Corner Cafe' } },
      header: { defaultValue: { language: 'en-US', value: 'Cafe WiFi' } },
      subheader: { defaultValue: { language: 'en-US', value: 'Ask staff for help' } },
      hexBackgroundColor: '#123456',
      barcode: { type: 'QR_CODE', value: 'WIFI:T:WPA;S:Cafe;P:hunter2;;' },
    });
    expect(object.textModulesData.map((m) => m.header)).toEqual(['Network', 'Security', 'Password', 'Made with']);
    // No image URLs: Google would fetch them, and a person's logo is not on the web.
    expect(JSON.stringify(claims)).not.toMatch(/https?:\/\//);
  });

  it('makes object IDs Google accepts and a random one when none is given', () => {
    expect(googleSaveClaims(account, { ...input(), objectSuffix: 'a b/c' }).payload.genericObjects[0].id).toBe(`${ISSUER}.a_b_c`);
    expect(googleSaveClaims(account, { ...input(), objectSuffix: undefined }).payload.genericObjects[0].id).toMatch(new RegExp(`^${ISSUER}\\.[0-9a-f-]{36}$`));
  });

  it('checks the key file and the Issuer ID', () => {
    expect(() => readServiceAccount('not json')).toThrow(/not JSON/);
    expect(() => readServiceAccount(JSON.stringify({ type: 'authorized_user', client_email: 'a@b' }))).toThrow(/service-account key file/);
    expect(isIssuerId(ISSUER)).toBe(true);
    expect(isIssuerId('pass.com.example')).toBe(false);
    expect(() => googleSaveClaims(account, { ...input(), issuerId: '12' })).toThrow(WalletPassError);
  });

  it('refuses a key that is not an RSA private key', async () => {
    await expect(buildGoogleSaveLink({ ...account, privateKeyPem: 'nope' }, input())).rejects.toThrow(/No private key/);
  });
});
