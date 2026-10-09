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

import { describe, it, expect } from 'vitest';
import {
  formatPayload,
  parsePayload,
  validatePayload,
  validateConfig,
  sanitizeConfig,
  identifyProtocol,
  canHydrate,
  QR_GENERATORS,
} from '../index';
import {
  QRType,
  QRConfig,
  QRErrorCorrectionLevel,
  QRStyle,
  SocialFormat,
  TemplateStyle,
  WifiEncryption,
  CryptoNetwork,
  SocialPlatform,
} from '@/types';

const getBaseConfig = (): QRConfig => ({
  type: QRType.TEXT,
  value: 'hello world',
  fgColor: '#000000',
  bgColor: '#FFFFFF',
  eyeColor: '#000000',
  errorCorrectionLevel: QRErrorCorrectionLevel.M,
  logoUrl: '',
  logoSize: 0.2,
  logoPadding: 0,
  logoPaddingStyle: 'square',
  logoBackgroundColor: '#FFFFFF',
  style: QRStyle.STANDARD,
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
  isBorderEnabled: false,
  borderSize: 0.05,
  borderStyle: 'solid',
  borderColor: '#000000',
  borderText: '',
  borderTextColor: '#000000',
  borderLogoUrl: null,
  borderTextPosition: 'bottom-center',
  borderLogoPosition: 'bottom-center',
});

describe('qr-payload Package Seam', () => {
  describe('formatPayload', () => {
    it('formats WiFi payload', () => {
      const formatted = formatPayload(QRType.WIFI, {
        ssid: 'HomeNet',
        password: 'secretPassword',
        encryption: WifiEncryption.WPA,
        hidden: false,
        eapIdentity: '',
      });
      expect(formatted).toBe('WIFI:T:WPA;S:HomeNet;P:secretPassword;;');
    });

    it('formats URL payload', () => {
      const formatted = formatPayload(QRType.URL, { url: 'https://example.com' });
      expect(formatted).toBe('https://example.com/');
    });

    it('formats plain text payload', () => {
      const formatted = formatPayload(QRType.TEXT, { text: 'Hello, World!' });
      expect(formatted).toBe('Hello, World!');
    });

    it('formats Email payload', () => {
      const formatted = formatPayload(QRType.EMAIL, {
        email: 'test@example.com',
        subject: 'Hello',
        body: 'World',
      });
      expect(formatted).toBe('mailto:test@example.com?subject=Hello&body=World');
    });

    it('formats Phone payload', () => {
      const formatted = formatPayload(QRType.PHONE, { number: '+1 (555) 123-4567' });
      expect(formatted).toBe('tel:+1(555)123-4567');
    });

    it('formats SMS payload', () => {
      const formatted = formatPayload(QRType.SMS, {
        number: '+15551234567',
        message: 'Hey there',
      });
      expect(formatted).toBe('sms:+15551234567?body=Hey%20there');
    });

    it('formats Crypto Payment payload', () => {
      const formatted = formatPayload(QRType.PAYMENT, {
        network: CryptoNetwork.BITCOIN,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        amount: '0.05',
        label: 'Coffee',
      });
      expect(formatted).toBe(
        'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.05&label=Coffee'
      );
    });

    it('formats Location payload', () => {
      const formatted = formatPayload(QRType.LOCATION, {
        latitude: '37.7749',
        longitude: '-122.4194',
      });
      expect(formatted).toBe('geo:37.7749,-122.4194');
    });

    it('formats Meeting payload', () => {
      const formatted = formatPayload(QRType.MEETING, {
        url: 'https://zoom.us/j/123456789',
      });
      expect(formatted).toBe('https://zoom.us/j/123456789');
    });

    it('formats Social payload', () => {
      const formatted = formatPayload(QRType.SOCIAL, {
        platform: SocialPlatform.TWITTER,
        handle: 'qrcraftly',
      });
      expect(formatted).toBe('https://x.com/qrcraftly');
    });

    it('throws error for unknown/unsupported QRType', () => {
      expect(() => formatPayload('NONEXISTENT' as any, {})).toThrow(
        'Unsupported QR type: NONEXISTENT'
      );
    });

    it('throws TypeError when data is null or undefined', () => {
      expect(() => formatPayload(QRType.URL, null as any)).toThrow(
        'Payload data is required for QR type: URL'
      );
      expect(() => formatPayload(QRType.WIFI, undefined as any)).toThrow(
        'Payload data is required for QR type: WIFI'
      );
    });
  });

  describe('parsePayload', () => {
    it('parses with explicit QRType', () => {
      const wifi = parsePayload(
        QRType.WIFI,
        'WIFI:T:WPA;S:MyNetwork;P:myPassword;;'
      );
      expect(wifi.ssid).toBe('MyNetwork');
      expect(wifi.password).toBe('myPassword');
      expect(wifi.encryption).toBe(WifiEncryption.WPA);
    });

    it('disambiguates 2-argument overload when second arg is undefined or empty', () => {
      const wifi = parsePayload(QRType.WIFI, undefined as any);
      expect(wifi).toBeDefined();
      expect(wifi.ssid).toBe('');

      const nullWifi = parsePayload(QRType.WIFI, null as any);
      expect(nullWifi).toBeDefined();
      expect(nullWifi.ssid).toBe('');
    });

    it('recovers gracefully if hydration throws an error in polymorphic mode', () => {
      const controlWifi = 'WIFI:S:Test\x00;P:pass;;';
      const parsed = parsePayload(controlWifi);
      expect(parsed.type).toBe(QRType.WIFI);
      expect(parsed.data).toEqual({ text: controlWifi });
    });

    it('parses polymorphically by detecting protocol from raw string', () => {
      const parsed = parsePayload('WIFI:T:WPA;S:MyNetwork;P:myPassword;;');
      expect(parsed.type).toBe(QRType.WIFI);
      expect(parsed.data.ssid).toBe('MyNetwork');

      const parsedGeo = parsePayload('geo:37.7749,-122.4194');
      expect(parsedGeo.type).toBe(QRType.LOCATION);
      expect(parsedGeo.data.latitude).toBe('37.7749');
      expect(parsedGeo.data.longitude).toBe('-122.4194');

      const parsedUrl = parsePayload('https://qrcraftly.com');
      expect(parsedUrl.type).toBe(QRType.URL);
      expect(parsedUrl.data.url).toBe('https://qrcraftly.com');

      const parsedText = parsePayload('Just some plain text');
      expect(parsedText.type).toBe(QRType.TEXT);
      expect(parsedText.data.text).toBe('Just some plain text');
    });

    it('returns null when explicit type generator is missing', () => {
      const result = parsePayload('INVALID_TYPE' as any, 'some text');
      expect(result).toBeNull();
    });
  });

  describe('validatePayload', () => {
    it('returns empty array for valid payload', () => {
      const violations = validatePayload('https://qrcraftly.com', QRType.URL);
      expect(violations).toHaveLength(0);
    });

    it('detects dangerous URL protocol in URL payload', () => {
      const violations = validatePayload('javascript:alert(1)', QRType.URL);
      expect(violations).toContain('URI_INJECTION_VIOLATION');
    });

    it('detects strict control characters in text payloads', () => {
      const violations = validatePayload('Hello\u200BWorld', QRType.TEXT);
      expect(violations).toContain(
        'Payload contains invalid control or zero-width characters'
      );
    });

    it('allows newlines in VCARD and EVENT payloads', () => {
      const vcard =
        'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;John;;;\r\nFN:John Doe\r\nEND:VCARD';
      const violations = validatePayload(vcard, QRType.VCARD);
      expect(violations).toHaveLength(0);
    });

    it('maintains stateless control character validation across consecutive calls without lastIndex leakage', () => {
      // First call with a longer payload containing a control character at offset ~33
      const longWithControl =
        'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Test\x00;;;;\r\nEND:VCARD';
      const v1 = validatePayload(longWithControl, QRType.VCARD);
      expect(v1).toContain('Payload contains invalid control or zero-width characters');

      // Second call with a short payload containing a control character at index 6
      const shortWithControl = 'BEGIN:\x00';
      const v2 = validatePayload(shortWithControl, QRType.VCARD);
      expect(v2).toContain('Payload contains invalid control or zero-width characters');

      // Third call with clean string confirms clean state
      const clean = 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:John\r\nEND:VCARD';
      const v3 = validatePayload(clean, QRType.VCARD);
      expect(v3).toHaveLength(0);
    });

    it('detects zero-width characters in vcard and event payloads', () => {
      const vcardWithZw = 'BEGIN:VCARD\r\nFN:John\u200BDoe\r\nEND:VCARD';
      const violations = validatePayload(vcardWithZw, QRType.VCARD);
      expect(violations).toContain('Payload contains invalid control or zero-width characters');
    });

    it('detects out of bounds latitude/longitude in location payloads', () => {
      const violationsLat = validatePayload('geo:120,-74', QRType.LOCATION);
      expect(violationsLat).toContain('LATITUDE_OUT_OF_BOUNDS_VIOLATION');

      const violationsLng = validatePayload('geo:40,-200', QRType.LOCATION);
      expect(violationsLng).toContain('LONGITUDE_OUT_OF_BOUNDS_VIOLATION');
    });
  });

  describe('validateConfig & sanitizeConfig', () => {
    it('validates a clean config without violations', () => {
      const config = getBaseConfig();
      const violations = validateConfig(config);
      expect(violations).toHaveLength(0);
    });

    it('validates text sinks: borderText, templateHeadline, templateSubtext', () => {
      const config = getBaseConfig();
      config.borderText = 'Border\u200BText';
      config.templateHeadline = 'Headline\uFEFF';
      config.templateSubtext = 'Subtext\u2060'; // ZWJ and ZWNJ are allowed (#1271); a word joiner is not
      const violations = validateConfig(config);
      expect(violations).toContain(
        'Border Text contains invalid control or zero-width characters'
      );
      expect(violations).toContain(
        'Template Headline contains invalid control or zero-width characters'
      );
      expect(violations).toContain(
        'Template Subtext contains invalid control or zero-width characters'
      );
    });

    it('sanitizes control characters across sinks and payload', () => {
      const config = getBaseConfig();
      config.borderText = 'Clean\x00Me';
      config.templateHeadline = 'Head\x01line';
      config.value = 'Safe\x00Value';
      const sanitized = sanitizeConfig(config);
      expect(sanitized.borderText).toBe('CleanMe');
      expect(sanitized.templateHeadline).toBe('Headline');
      expect(sanitized.value).toBe('SafeValue');
    });

    it('safely handles malicious prototype property names as QRType without throwing', () => {
      const config = getBaseConfig();
      config.type = 'toString' as QRType;
      expect(() => {
        const violations = validateConfig(config);
        expect(violations).toBeDefined();
      }).not.toThrow();
    });
  });

  describe('identifyProtocol & canHydrate', () => {
    it('identifies protocols accurately', () => {
      expect(identifyProtocol('WIFI:S:test;;')).toBe(QRType.WIFI);
      expect(identifyProtocol('geo:10,20')).toBe(QRType.LOCATION);
      expect(identifyProtocol('BEGIN:VCARD\r\n...')).toBe(QRType.VCARD);
      expect(identifyProtocol('BEGIN:VEVENT\r\n...')).toBe(QRType.EVENT);
      expect(identifyProtocol('bitcoin:12345')).toBe(QRType.PAYMENT);
      expect(identifyProtocol('mailto:user@test.com')).toBe(QRType.EMAIL);
      expect(identifyProtocol('tel:+123456789')).toBe(QRType.PHONE);
      expect(identifyProtocol('sms:+123456789')).toBe(QRType.SMS);
      expect(identifyProtocol('https://instagram.com/user')).toBe(QRType.SOCIAL);
      expect(identifyProtocol('https://meet.google.com/abc-def-ghi')).toBe(QRType.MEETING);
      expect(identifyProtocol('https://example.com')).toBe(QRType.URL);
      expect(identifyProtocol('simple text')).toBe(QRType.TEXT);
      expect(identifyProtocol('')).toBeNull();
    });

    it('handles leading and trailing whitespace across all protocols', () => {
      expect(identifyProtocol('   WIFI:S:test;;   ')).toBe(QRType.WIFI);
      expect(identifyProtocol('   geo:10,20   ')).toBe(QRType.LOCATION);
      expect(identifyProtocol('   bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa   ')).toBe(
        QRType.PAYMENT
      );
      expect(identifyProtocol('   https://example.com   ')).toBe(QRType.URL);
    });

    it('identifies case-insensitive begin blocks and schemes', () => {
      expect(identifyProtocol('begin:vcard\r\nfn:test\r\nend:vcard')).toBe(QRType.VCARD);
      expect(identifyProtocol('begin:vevent\r\nsummary:test\r\nend:vevent')).toBe(
        QRType.EVENT
      );
      expect(identifyProtocol('wifi:S:test;;')).toBe(QRType.WIFI);
      expect(identifyProtocol('BITCOIN:12345')).toBe(QRType.PAYMENT);
      expect(identifyProtocol('ETHEREUM:0x12345')).toBe(QRType.PAYMENT);
    });

    it('tests canHydrate correctly', () => {
      expect(canHydrate('WIFI:S:test;;', QRType.WIFI)).toBe(true);
      expect(canHydrate('https://example.com', QRType.URL)).toBe(true);
      expect(canHydrate('https://example.com', QRType.WIFI)).toBe(false);
      // Any text can hydrate into QRType.TEXT
      expect(canHydrate('https://example.com', QRType.TEXT)).toBe(true);
    });
  });

  describe('QR_GENERATORS registry completeness', () => {
    it('contains all 12 QR types', () => {
      const expectedTypes = [
        QRType.WIFI,
        QRType.EMAIL,
        QRType.VCARD,
        QRType.PHONE,
        QRType.SMS,
        QRType.PAYMENT,
        QRType.EVENT,
        QRType.URL,
        QRType.TEXT,
        QRType.LOCATION,
        QRType.MEETING,
        QRType.SOCIAL,
      ];
      for (const type of expectedTypes) {
        const contract = QR_GENERATORS[type];
        expect(contract).toBeDefined();
        expect(contract.type).toBe(type);
        expect(typeof contract.construct).toBe('function');
        expect(typeof contract.hydrate).toBe('function');
        expect(typeof contract.matches).toBe('function');
      }
    });

    it('provides null-safe hydration across all 12 generator contracts without throwing', () => {
      for (const type of Object.values(QRType)) {
        const contract = QR_GENERATORS[type];
        if (!contract) continue;
        expect(() => contract.hydrate(null as any)).not.toThrow();
        expect(() => contract.hydrate(undefined as any)).not.toThrow();
        expect(() => contract.hydrate('')).not.toThrow();
      }
    });

    it('matches correctly across contracts with whitespace and case variations', () => {
      expect(QR_GENERATORS[QRType.WIFI].matches('  WIFI:S:test;;  ')).toBe(true);
      expect(QR_GENERATORS[QRType.WIFI].matches('wifi:S:test;;')).toBe(true);
      expect(
        QR_GENERATORS[QRType.VCARD].matches('begin:vcard\r\nfn:test\r\nend:vcard')
      ).toBe(true);
      expect(
        QR_GENERATORS[QRType.EVENT].matches('begin:vevent\r\nsummary:test\r\nend:vevent')
      ).toBe(true);
      expect(
        QR_GENERATORS[QRType.LOCATION].matches('  geo:37.7749,-122.4194  ')
      ).toBe(true);
    });
  });
});
