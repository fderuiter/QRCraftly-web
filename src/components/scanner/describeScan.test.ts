import { describe, expect, it } from 'vitest';
import { QRType } from '@/types';
import { describeScan, scanHeadline } from './describeScan';

describe('describeScan', () => {
  it('reads a web address with its real host', () => {
    const scan = describeScan('https://www.example.com/a?b=c');
    expect(scan.type).toBe(QRType.URL);
    expect(scan.blocked).toBe(false);
    expect(scan.link).toMatchObject({ host: 'www.example.com', secure: true, international: false, mixedScripts: false });
    expect(scanHeadline(scan)).toBe('URL, www.example.com');
  });

  it('decodes and flags a lookalike host', () => {
    const scan = describeScan('http://xn--pple-43d.com');
    expect(scan.link).toMatchObject({ host: 'аpple.com', asciiHost: 'xn--pple-43d.com', secure: false, international: true, mixedScripts: true });
  });

  it('offers and checks the address the browser will open', () => {
    const spaced = describeScan('https://paypa1.com/signin?ref= home');
    expect(spaced.link?.href).toBe('https://paypa1.com/signin?ref=%20home');
    expect(spaced.link?.findings.map((finding) => finding.code)).toEqual(['lookalike']);
    const broken = describeScan('https://pay\npa1.com/sign\tin');
    expect(broken.link).toMatchObject({ href: 'https://paypa1.com/signin', host: 'paypa1.com' });
    expect(broken.link?.findings.map((finding) => finding.code)).toEqual(['lookalike']);
  });

  it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)', ' java\tscript:alert(1)'])(
    'blocks %s with no link or summary',
    (payload) => {
      const scan = describeScan(payload);
      expect(scan.blocked).toBe(true);
      expect(scan.link).toBeNull();
      expect(scan.summary).toEqual([]);
      expect(scanHeadline(scan)).toBe('blocked script link');
    }
  );

  it('summarises WiFi, contact, event and phone codes', () => {
    expect(describeScan('WIFI:T:nopass;S:Lobby;;').summary).toEqual([
      { label: 'Network', value: 'Lobby' },
      { label: 'Security', value: 'None (open network)' },
    ]);
    const card = describeScan('BEGIN:VCARD\nVERSION:3.0\nN:Lovelace;Ada\nFN:Ada Lovelace\nORG:Engines\nEND:VCARD');
    expect(card.type).toBe(QRType.VCARD);
    expect(card.summary).toEqual(expect.arrayContaining([{ label: 'Name', value: 'Ada Lovelace' }]));
    expect(card.typeLabel).toBe('vCard contact');
    const event = describeScan('BEGIN:VEVENT\nSUMMARY:Launch\nDTSTART:20261003T100000Z\nEND:VEVENT');
    expect(event.type).toBe(QRType.EVENT);
    expect(event.summary[0]).toEqual({ label: 'Event', value: 'Launch' });
    expect(describeScan('tel:+15551234567').summary).toEqual([{ label: 'Number', value: '+15551234567' }]);
  });

  it('treats plain text as text with no link', () => {
    const scan = describeScan('Hello there');
    expect(scan.type).toBe(QRType.TEXT);
    expect(scan.link).toBeNull();
    expect(scanHeadline(scan)).toBe('Text');
  });
});
