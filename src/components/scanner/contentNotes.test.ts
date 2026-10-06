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

import { describe, expect, it } from 'vitest';
import { describeScan } from './describeScan';

const RLO = String.fromCharCode(0x202e);
const cautionsOf = (text: string) => describeScan(text).cautions.join(' | ');
const row = (text: string, label: string) => describeScan(text).summary.find((entry) => entry.label === label);

describe('scan summaries for codes that are not links (#1158)', () => {
  it('lists every mailto recipient and warns about Bcc, Cc and a prefilled body', () => {
    const scan = describeScan('mailto:a@example.com,b@example.com?cc=c@example.com&bcc=secret@example.com&subject=Hi&body=Wire%20money');
    expect(row(scan.text, 'To')?.value).toBe('a@example.com, b@example.com');
    expect(row(scan.text, 'Cc')?.value).toBe('c@example.com');
    expect(row(scan.text, 'Bcc')?.value).toBe('secret@example.com');
    expect(row(scan.text, 'Message')?.value).toBe('Wire money');
    expect(scan.cautions.join(' ')).toMatch(/hidden recipients \(Bcc\)/);
    expect(scan.cautions.join(' ')).toMatch(/addressed to 4 people/);
    expect(scan.cautions.join(' ')).toMatch(/filled in for you/);
  });

  it('reads mailto header names in any case and keeps every repeated recipient field', () => {
    const upper = describeScan('mailto:boss@example.com?BCC=x@attacker.example&Subject=Hi&BODY=Hello');
    expect(row(upper.text, 'Bcc')?.value).toBe('x@attacker.example');
    expect(row(upper.text, 'Subject')?.value).toBe('Hi');
    expect(upper.cautions.join(' ')).toMatch(/hidden recipients \(Bcc\)/);
    expect(upper.cautions.join(' ')).toMatch(/addressed to 2 people/);
    expect(upper.cautions.join(' ')).toMatch(/filled in for you/);

    const repeated = describeScan('mailto:a@example.com?bcc=one@example.com&Bcc=two@example.com&cc=c@example.com&CC=d@example.com');
    expect(row(repeated.text, 'Bcc')?.value).toBe('one@example.com, two@example.com');
    expect(row(repeated.text, 'Cc')?.value).toBe('c@example.com, d@example.com');
    expect(repeated.cautions.join(' ')).toMatch(/addressed to 5 people/);
  });

  it('adds no caution to a plain mailto', () => {
    expect(describeScan('mailto:hello@example.com?subject=Hi').cautions).toEqual([]);
  });

  it('flags a dialer (USSD) code but not a phone number', () => {
    expect(cautionsOf('tel:*21*5551234567%23')).toMatch(/dialer code \(USSD\)/);
    expect(cautionsOf('tel:%2A%2321%23')).toMatch(/dialer code/);
    expect(describeScan('tel:+15551234567').cautions).toEqual([]);
  });

  it('flags a text to several numbers and to a short number', () => {
    const scan = describeScan('sms:+15551230001,+15551230002?body=Hi');
    expect(row(scan.text, 'To (all of these)')?.value).toBe('+15551230001, +15551230002');
    expect(scan.cautions.join(' ')).toMatch(/2 numbers at once/);
    expect(cautionsOf('sms:72727?body=STOP')).toMatch(/paid service/);
    expect(describeScan('sms:+15551230001?body=Hi').cautions).toEqual([]);
  });

  it('hides the Wi-Fi password and warns about open and WEP networks', () => {
    const scan = describeScan('WIFI:T:WPA;S:Cafe;P:hunter2;;');
    expect(scan.hasSecret).toBe(true);
    expect(scan.summary.find((entry) => entry.label === 'Password')).toMatchObject({ value: 'hunter2', secret: true });
    expect(scan.displayText).not.toContain('hunter2');
    expect(scan.shareText).not.toContain('hunter2');
    expect(scan.shareText).toContain('S:Cafe');
    expect(scan.revealedText).toContain('hunter2');
    expect(scan.cautions).toEqual([]);
    expect(cautionsOf('WIFI:T:nopass;S:Lobby;;')).toMatch(/no password/);
    expect(cautionsOf('WIFI:T:WEP;S:Old;P:12345;;')).toMatch(/WEP/);
  });

  it('keeps an escaped semicolon inside a hidden Wi-Fi password', () => {
    const scan = describeScan('WIFI:T:WPA;S:Cafe;P:pa\;ss;H:true;;');
    expect(scan.displayText).not.toContain('pa');
    expect(scan.displayText).toContain('H:true');
  });

  it('hides an authenticator secret and warns', () => {
    const scan = describeScan('otpauth://totp/Acme:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme');
    expect(scan.typeLabel).toBe('Authenticator key');
    expect(scan.hasSecret).toBe(true);
    expect(scan.summary.find((entry) => entry.secret)).toMatchObject({ label: 'Secret key', value: 'JBSWY3DPEHPK3PXP' });
    expect(row(scan.text, 'Account')?.value).toBe('Acme:ada@example.com');
    expect(scan.displayText).not.toContain('JBSWY3DPEHPK3PXP');
    expect(scan.displayText).toContain('issuer=Acme');
    expect(scan.cautions[0]).toMatch(/never share it/);
  });

  it('checks crypto address checksums', () => {
    expect(row('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', 'Address check')?.value).toBe('Checksum matches');
    expect(describeScan('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2').cautions).toEqual([]);
    const bad = describeScan('bitcoin:1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3');
    expect(bad.cautions.join(' ')).toMatch(/typo or is not a real address/);
    expect(row(bad.text, 'Address check')?.value).toBe('Checksum does not match');
    expect(cautionsOf('ethereum:0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toMatch(/typo/);
    expect(describeScan('ethereum:0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed').cautions).toEqual([]);
  });

  it('spells out hidden direction characters instead of rendering them', () => {
    const scan = describeScan(`WIFI:T:WPA;S:Cafe${RLO}gpj;P:x;;`);
    expect(scan.displayText).toContain('[U+202E]');
    expect(scan.displayText).not.toContain(RLO);
    expect(scan.cautions.join(' ')).toMatch(/hidden characters/);
    expect(row(scan.text, 'Network')?.value).toBe('Cafe[U+202E]gpj');
  });
});
