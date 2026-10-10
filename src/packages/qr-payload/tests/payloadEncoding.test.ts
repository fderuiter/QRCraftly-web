/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

/**
 * Table-driven regression tests for the payload encoding bugs in issue #974.
 * Each case checks the spec-mandated wire format and that it round-trips back
 * through the matching hydrate/parse path.
 */

import { describe, it, expect } from 'vitest';
import {
  constructPhoneString,
  hydratePhoneData,
  constructSmsString,
  hydrateSmsData,
  SmsContract,
  constructEmailString,
  hydrateEmailData,
  EmailContract,
  constructEventString,
  hydrateEventData,
  unescapeVCardEvent,
  escapeVCardEvent,
  constructVCardString,
  hydrateVCardData,
  constructUrlString,
  constructPaymentString,
  hydratePaymentData,
  constructWifiString,
  hydrateWifiData,
  parsePayload,
} from '../index';
import {
  CryptoNetwork,
  EventData,
  QRType,
  VCardData,
  WifiData,
  WifiEapMethod,
  WifiEapPhase2,
  WifiEncryption,
} from '@/types';
import { normalizeUrl, shouldNormalizeUrl } from '@/utils/url';

describe('#974 case 1: tel/sms percent-encode # as %23 (RFC 3966)', () => {
  const cases: Array<{ input: string; tel: string }> = [
    { input: '*#06#', tel: 'tel:*%2306%23' },
    { input: '#31#5551234', tel: 'tel:%2331%235551234' },
    { input: '+1 (555) 123-4567', tel: 'tel:+1(555)123-4567' },
  ];

  it.each(cases)('tel: $input -> $tel', ({ input, tel }) => {
    const payload = constructPhoneString({ number: input });
    expect(payload).toBe(tel);
    expect(payload).not.toContain('#');
    expect(hydratePhoneData(payload).number).toBe(input.replace(/\s/g, ''));
  });

  it.each(cases)('sms: $input round-trips and validates', ({ input }) => {
    const payload = constructSmsString({ number: input, message: 'Hi #1' });
    expect(payload.split('?')[0]).not.toContain('#');
    expect(payload).toContain('body=Hi%20%231');
    expect(SmsContract.validate?.(payload)).toEqual([]);
    expect(hydrateSmsData(payload)).toEqual({
      number: input.replace(/\s/g, ''),
      message: 'Hi #1',
    });
  });
});

describe('#974 case 2: mailto recipient is percent-encoded (RFC 6068)', () => {
  const cases: Array<{ email: string; path: string }> = [
    { email: 'a@b.com', path: 'mailto:a@b.com' },
    { email: 'first.last+tag@example.org', path: 'mailto:first.last+tag@example.org' },
    { email: 'a@b.com?bcc=spy@x.com&x=', path: 'mailto:a@b.com%3Fbcc%3Dspy@x.com%26x%3D' },
    { email: 'a@b.com#frag', path: 'mailto:a@b.com%23frag' },
  ];

  it.each(cases)('$email', ({ email, path }) => {
    const payload = constructEmailString({ email, subject: 'S', body: 'B' });
    expect(payload).toBe(`${path}?subject=S&body=B`);
    // Exactly one query delimiter, so no header can be injected
    expect(payload.split('?')).toHaveLength(2);
    expect(new URLSearchParams(payload.split('?')[1]).get('bcc')).toBeNull();
    expect(hydrateEmailData(payload)).toEqual({ email, cc: '', bcc: '', subject: 'S', body: 'B' });
  });

  it('keeps valid addresses valid and flags injected ones', () => {
    expect(EmailContract.validate?.(constructEmailString({ email: 'a@b.com', subject: '', body: '' }))).toEqual([]);
    expect(
      EmailContract.validate?.(constructEmailString({ email: 'a@b.com?bcc=spy@x.com', subject: '', body: '' }))
    ).toContain('EMAIL_STRUCTURE_VIOLATION');
  });
});

describe('#974 case 3: iCal has UID and DTSTAMP and omits empty properties (RFC 5545)', () => {
  const now = new Date(Date.UTC(2026, 8, 29, 10, 11, 12));
  const base: EventData = {
    title: 'Launch',
    startDate: '2026-05-01T18:30',
    endDate: '',
    location: '',
    description: '',
  };

  const cases: Array<{ name: string; data: EventData; present: string[]; absent: string[] }> = [
    {
      name: 'no end date',
      data: base,
      present: ['SUMMARY:Launch', 'DTSTART:20260501T183000'],
      absent: ['DTEND', 'LOCATION', 'DESCRIPTION'],
    },
    {
      name: 'all fields',
      data: { ...base, endDate: '2026-05-01T20:00', location: 'Hall', description: 'Hi' },
      present: ['DTEND:20260501T200000', 'LOCATION:Hall', 'DESCRIPTION:Hi'],
      absent: [],
    },
    {
      name: 'no title',
      data: { ...base, title: '' },
      present: ['DTSTART:20260501T183000'],
      absent: ['SUMMARY'],
    },
  ];

  it.each(cases)('$name', ({ data, present, absent }) => {
    const payload = constructEventString(data, { now });
    const lines = payload.split(/\r?\n/);
    expect(lines).toContain('DTSTAMP:20260929T101112Z');
    expect(lines.some((l) => /^UID:[0-9a-f]{16}@qrcraftly\.com$/.test(l))).toBe(true);
    for (const p of present) expect(lines).toContain(p);
    for (const a of absent) expect(payload).not.toContain(a);
    // No property is ever emitted with an empty value
    expect(lines.filter((l) => /^[A-Z;=/_-]+:$/i.test(l))).toEqual([]);
    expect(hydrateEventData(payload)).toEqual(data);
  });

  it('derives a stable UID from the content and honours injected ids', () => {
    const a = constructEventString(base, { now });
    expect(constructEventString(base, { now })).toBe(a);
    expect(constructEventString({ ...base, title: 'Other' }, { now })).not.toBe(a);
    expect(constructEventString(base, { now, uid: 'fixed-id' })).toContain('UID:fixed-id');
  });

  it('builds the same payload twice without an injected clock', () => {
    expect(constructEventString(base)).toBe(constructEventString(base));
  });
});

describe('#974 case 4: single-pass vCard/iCal unescape', () => {
  const cases: Array<{ raw: string; escaped: string }> = [
    { raw: 'share\\new folder', escaped: 'share\\\\new folder' },
    { raw: 'a\\nb', escaped: 'a\\\\nb' },
    { raw: 'line1\nline2', escaped: 'line1\\nline2' },
    { raw: 'a;b,c', escaped: 'a\\;b\\,c' },
    { raw: 'trailing\\', escaped: 'trailing\\\\' },
  ];

  it.each(cases)('$escaped', ({ raw, escaped }) => {
    expect(escapeVCardEvent(raw)).toBe(escaped);
    expect(unescapeVCardEvent(escaped)).toBe(raw);
  });

  it('accepts uppercase \\N as a newline', () => {
    expect(unescapeVCardEvent('a\\Nb')).toBe('a\nb');
  });

  it('round-trips a backslash path through a vCard', () => {
    const data: VCardData = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '',
      email: '',
      website: '',
      organization: 'share\\new folder',
      title: '',
      street: '',
      city: '',
      zip: '',
      country: '',
    };
    expect(hydrateVCardData(constructVCardString(data)).organization).toBe('share\\new folder');
  });
});

describe('#974 case 5: URL normalize handles host:port and defaults to https', () => {
  const cases: Array<{ input: string; expected: string }> = [
    { input: 'example.com', expected: 'https://example.com/' },
    { input: 'example.com:8080/path', expected: 'https://example.com:8080/path' },
    { input: 'localhost:3000', expected: 'https://localhost:3000/' },
    { input: 'localhost:3000/a?b=c', expected: 'https://localhost:3000/a?b=c' },
    { input: 'localhost', expected: 'https://localhost/' },
    { input: 'http://example.com', expected: 'http://example.com/' },
    { input: 'https://example.com/x', expected: 'https://example.com/x' },
    { input: 'mailto:a@b.com', expected: 'mailto:a@b.com' },
    { input: 'tel:+15551234', expected: 'tel:+15551234' },
  ];

  it.each(cases)('$input -> $expected', ({ input, expected }) => {
    expect(normalizeUrl(input)).toBe(expected);
    expect(constructUrlString({ url: input })).toBe(expected);
  });

  it('treats localhost forms as normalizable', () => {
    expect(shouldNormalizeUrl('localhost:3000')).toBe(true);
    expect(shouldNormalizeUrl('localhost')).toBe(true);
    expect(shouldNormalizeUrl('localhostfoo')).toBe(false);
  });
});

describe('#974 case 6: Ethereum uses EIP-681 value= in wei', () => {
  const address = '0xfb6916095ca1df60bb79Ce92ce3ea74c37c5d359';
  const cases: Array<{ amount: string; value: string | null }> = [
    { amount: '1', value: '1000000000000000000' },
    { amount: '1.5', value: '1500000000000000000' },
    { amount: '0.1', value: '100000000000000000' },
    { amount: '0.3', value: '300000000000000000' },
    { amount: '.5', value: '500000000000000000' },
    { amount: '0.000000000000000001', value: '1' },
    { amount: '123456789.123456789123456789', value: '123456789123456789123456789' },
    { amount: '0', value: '0' },
    { amount: '0.0000000000000000001', value: null },
    { amount: '1e3', value: null },
    { amount: '-1', value: null },
  ];

  it.each(cases)('$amount ETH -> value=$value', ({ amount, value }) => {
    const payload = constructPaymentString({
      network: CryptoNetwork.ETHEREUM,
      address,
      amount,
      label: '',
    });
    expect(payload).not.toContain('amount=');
    if (value === null) {
      // An amount wei cannot carry is refused rather than silently dropped (#1283).
      expect(payload).toBe('');
      return;
    }
    expect(payload).toBe(`ethereum:${address}?value=${value}`);
    const expectedAmount = amount.startsWith('.') ? `0${amount}` : amount;
    expect(hydratePaymentData(payload).amount).toBe(expectedAmount);
  });

  it('hydrates scientific-notation wei values from other wallets', () => {
    expect(hydratePaymentData(`ethereum:${address}?value=2.014e18`).amount).toBe('2.014');
    expect(hydratePaymentData(`ethereum:${address}?value=1.5e0`).amount).toBe('');
  });

  it('still hydrates legacy amount= payloads', () => {
    expect(hydratePaymentData(`ethereum:${address}?amount=1.5`).amount).toBe('1.5');
  });

  it('keeps BIP-21 amount= for Bitcoin', () => {
    expect(
      constructPaymentString({ network: CryptoNetwork.BITCOIN, address: 'bc1qxyz', amount: '0.1', label: '' })
    ).toBe('bitcoin:bc1qxyz?amount=0.1');
  });

  const injections: Array<{ address: string; encoded: string }> = [
    { address: '0xabc&value=999', encoded: '0xabc%26value%3D999' },
    { address: '0xabc#frag', encoded: '0xabc%23frag' },
    { address: '0xabc@1', encoded: '0xabc@1' },
  ];

  it.each(injections)('encodes address $address', ({ address: addr, encoded }) => {
    const payload = constructPaymentString({
      network: CryptoNetwork.ETHEREUM,
      address: addr,
      amount: '1',
      label: '',
    });
    expect(payload).toBe(`ethereum:${encoded}?value=1000000000000000000`);
    expect(new URLSearchParams(payload.split('?')[1]).getAll('value')).toEqual(['1000000000000000000']);
    expect(hydratePaymentData(payload).address).toBe(addr);
  });
});

describe('#974 case 7: WPA2-EAP emits E: and PH2:', () => {
  const base: WifiData = {
    ssid: 'Corp',
    password: 'p@ss;word',
    encryption: WifiEncryption.WPA2_EAP,
    hidden: false,
    eapIdentity: 'user@corp.com',
  };

  const cases: Array<{ name: string; data: WifiData; expected: string }> = [
    {
      name: 'defaults to PEAP / MSCHAPV2',
      data: base,
      expected: 'WIFI:T:WPA2-EAP;S:Corp;E:PEAP;PH2:MSCHAPV2;I:user@corp.com;P:p@ss\\;word;;',
    },
    {
      name: 'TTLS / PAP',
      data: { ...base, eapMethod: WifiEapMethod.TTLS, eapPhase2: WifiEapPhase2.PAP },
      expected: 'WIFI:T:WPA2-EAP;S:Corp;E:TTLS;PH2:PAP;I:user@corp.com;P:p@ss\\;word;;',
    },
    {
      name: 'TLS has no phase 2',
      data: { ...base, eapMethod: WifiEapMethod.TLS, eapPhase2: WifiEapPhase2.MSCHAPV2 },
      expected: 'WIFI:T:WPA2-EAP;S:Corp;E:TLS;I:user@corp.com;P:p@ss\\;word;;',
    },
    {
      name: 'PEAP with phase 2 None',
      data: { ...base, eapMethod: WifiEapMethod.PEAP, eapPhase2: WifiEapPhase2.NONE },
      expected: 'WIFI:T:WPA2-EAP;S:Corp;E:PEAP;I:user@corp.com;P:p@ss\\;word;;',
    },
  ];

  it.each(cases)('$name', ({ data, expected }) => {
    const payload = constructWifiString(data);
    expect(payload).toBe(expected);
    const hydrated = hydrateWifiData(payload);
    expect(hydrated.eapMethod).toBe(data.eapMethod ?? WifiEapMethod.PEAP);
    expect(hydrated.eapIdentity).toBe(base.eapIdentity);
    expect(hydrated.password).toBe(base.password);
  });

  it('does not emit E: for non-enterprise networks', () => {
    const payload = constructWifiString({ ...base, encryption: WifiEncryption.WPA, eapMethod: WifiEapMethod.TTLS });
    expect(payload).not.toContain('E:');
    expect(payload).not.toContain('PH2:');
  });

  it('ignores unknown EAP method and phase 2 values when hydrating', () => {
    const hydrated = hydrateWifiData('WIFI:T:WPA2-EAP;S:X;E:BOGUS;PH2:NOPE;I:u;P:p;;');
    expect(hydrated.eapMethod).toBeUndefined();
    expect(hydrated.eapPhase2).toBeUndefined();
  });

  it('parses scanned enterprise payloads through the registry', () => {
    const parsed = parsePayload('WIFI:T:WPA2-EAP;S:X;E:ttls;PH2:gtc;I:u;P:p;;');
    expect(parsed.type).toBe(QRType.WIFI);
    expect(parsed.data).toMatchObject({
      eapMethod: WifiEapMethod.TTLS,
      eapPhase2: WifiEapPhase2.GTC,
      eapIdentity: 'u',
    });
  });

  it('round-trips tel:, mailto: and ethereum: through parsePayload', () => {
    expect(parsePayload(QRType.PHONE, constructPhoneString({ number: '*#06#' }))).toEqual({ number: '*#06#' });
    expect(parsePayload('mailto:a@b.com%3Fx?subject=&body=').data.email).toBe('a@b.com?x');
    expect(parsePayload('ethereum:0xabc?value=250000000000000000').data.amount).toBe('0.25');
  });
});
