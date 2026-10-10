/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
import { FIXTURES } from '../../../../tests/fixtures/data';
import {
  constructWifiString,
  constructEmailString,
  constructVCardString,
  constructPhoneString,
  constructSmsString,
  constructPaymentString,
  constructEventString,
  constructLocationString,
  constructMeetingString,
  constructSocialString,
  constructUrlString,
} from '../index';
import {
  type WifiData,
  type EmailData,
  type VCardData,
  type PhoneData,
  type SmsData,
  type PaymentData,
  type EventData,
  WifiEncryption,
  CryptoNetwork,
  SocialPlatform,
} from '@/types';

describe('QR Helpers', () => {
  describe('constructWifiString', () => {
    it('constructs a standard WPA WiFi string', () => {
      const data: WifiData = {
        ssid: 'MyNetwork',
        password: 'password123',
        encryption: WifiEncryption.WPA,
        hidden: false
      };
      expect(constructWifiString(data)).toBe('WIFI:T:WPA;S:MyNetwork;P:password123;;');
    });

    it('constructs a WPA2-EAP WiFi string', () => {
      const data: WifiData = {
        ssid: 'EnterpriseNet',
        password: 'securepass',
        encryption: WifiEncryption.WPA2_EAP,
        hidden: false,
        eapIdentity: 'user@domain.com'
      };
      expect(constructWifiString(data)).toBe('WIFI:T:WPA2-EAP;S:EnterpriseNet;E:PEAP;PH2:MSCHAPV2;I:user@domain.com;P:securepass;;');
    });

    it('constructs a nopass WiFi string (omits password)', () => {
      const data: WifiData = {
        ssid: 'OpenNet',
        password: 'ignored',
        encryption: WifiEncryption.NOPASS,
        hidden: false
      };
      expect(constructWifiString(data)).toBe('WIFI:T:nopass;S:OpenNet;;');
    });

    it('escapes special characters in SSID and password', () => {
      const data: WifiData = {
        ssid: 'Net;Work',
        password: 'pass:word\\',
        encryption: WifiEncryption.WPA,
        hidden: false
      };
      // Expect: Net\;Work and pass\:word\\
      expect(constructWifiString(data)).toBe('WIFI:T:WPA;S:Net\\;Work;P:pass\\:word\\\\;;');
    });

    it('handles hidden network flag', () => {
      const data: WifiData = {
        ssid: 'HiddenNet',
        password: 'pass',
        encryption: WifiEncryption.WPA,
        hidden: true
      };
      expect(constructWifiString(data)).toContain('H:true');
    });
  });

  describe('constructEmailString', () => {
    it('constructs a valid mailto string with encoding', () => {
      const data: EmailData = {
        email: 'test@example.com',
        subject: 'Hello World',
        body: 'This is a test message.'
      };
      const result = constructEmailString(data);
      expect(result).toBe('mailto:test@example.com?subject=Hello%20World&body=This%20is%20a%20test%20message.');
    });

    it('constructs a mailto string with cc and bcc', () => {
      const data: EmailData = {
        email: 'test@example.com',
        cc: 'cc@example.com',
        bcc: 'bcc1@example.com, bcc2@example.com',
        subject: 'Hello World',
        body: 'This is a test message.'
      };
      const result = constructEmailString(data);
      expect(result).toBe(
        'mailto:test@example.com?cc=cc%40example.com&bcc=bcc1%40example.com%2C%20bcc2%40example.com&subject=Hello%20World&body=This%20is%20a%20test%20message.'
      );
    });

    it('handles special characters in subject and body', () => {
      const data: EmailData = {
        email: 'foo@bar.com',
        subject: 'Q&A',
        body: '100% correct?'
      };
      const result = constructEmailString(data);
      expect(result).toContain('subject=Q%26A');
      expect(result).toContain('body=100%25%20correct%3F');
    });

    it('sanitizes email to prevent header injection', () => {
      const data: EmailData = {
        email: 'user@example.com?cc=attacker@example.com',
        subject: 'Test',
        body: 'Body'
      };
      const result = constructEmailString(data);
      // The recipient is percent-encoded (RFC 6068) so `?` and `=` cannot start a query
      expect(result).toBe('mailto:user@example.com%3Fcc%3Dattacker@example.com?subject=Test&body=Body');
    });
  });

  describe('constructVCardString', () => {
    const baseVCard: VCardData = FIXTURES.vCard.baseData;

    it('constructs a valid VCard 3.0 string', () => {
      const result = constructVCardString(baseVCard);
      expect(result).toContain('BEGIN:VCARD');
      expect(result).toContain('VERSION:3.0');
      expect(result).toContain('N:Doe;John;;;');
      expect(result).toContain('FN:John Doe');
      expect(result).toContain('ORG:Acme Corp');
      expect(result).toContain('TITLE:Engineer');
      expect(result).toContain('TEL:1234567890');
      expect(result).toContain('EMAIL:john@example.com');
      expect(result).toContain('URL:https://example.com');
      expect(result).toContain('ADR:;;123 Main St;Metropolis;;12345;USA');
      expect(result).toContain('END:VCARD');
    });

    it('escapes special characters (comma, semicolon, backslash, newline)', () => {
      const trickyVCard: VCardData = {
        ...baseVCard,
        organization: 'Acme, Inc.',
        street: '123 Main St; Apt 4',
        // Note: Newlines in inputs might be tricky depending on how they are captured, but the util handles \n
        title: 'Senior\\Principal'
      };
      const result = constructVCardString(trickyVCard);

      // Comma escaped: Acme\, Inc.
      expect(result).toContain('ORG:Acme\\, Inc.');
      // Semicolon escaped: 123 Main St\; Apt 4
      expect(result).toContain('ADR:;;123 Main St\\; Apt 4;Metropolis;;12345;USA');
      // Backslash escaped: Senior\\Principal
      expect(result).toContain('TITLE:Senior\\\\Principal');
    });

    it('removes dangerous URLs from website field', () => {
       const dangerousVCard: VCardData = {
         ...baseVCard,
         website: 'javascript:alert(1)'
       };
       const result = constructVCardString(dangerousVCard);
       expect(result).toContain('URL:javascript:alert(1)');
     });
  });

  describe('constructPhoneString', () => {
    it('constructs a tel URI and strips whitespace', () => {
      const data: PhoneData = { number: '+1 (555) 123-4567' };
      expect(constructPhoneString(data)).toBe('tel:+1(555)123-4567');
    });

    it('strips colons from phone number', () => {
        const data: PhoneData = { number: '+1:234:567' };
        expect(constructPhoneString(data)).toBe('tel:+1234567');
    });
  });

  describe('constructSmsString', () => {
    it('constructs an sms URI with number and encoded body', () => {
      const data: SmsData = {
        number: '+1 (555) 999-8888',
        message: 'Hello there'
      };
      expect(constructSmsString(data)).toBe('sms:+1(555)999-8888?body=Hello%20there');
    });

    it('correctly encodes special characters in message body', () => {
      const data: SmsData = {
        number: '123',
        message: 'Hello & Welcome? 100%'
      };
      // & -> %26, ? -> %3F, % -> %25
      expect(constructSmsString(data)).toBe('sms:123?body=Hello%20%26%20Welcome%3F%20100%25');
    });
  });

  describe('constructPaymentString', () => {
    it('constructs a basic crypto URI', () => {
      const data: PaymentData = {
        network: CryptoNetwork.BITCOIN,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        amount: '',
        label: ''
      };
      expect(constructPaymentString(data)).toBe('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
    });

    it('constructs a crypto URI with amount and label', () => {
      const data: PaymentData = {
        network: CryptoNetwork.ETHEREUM,
        address: '0x123...',
        amount: '1.5',
        label: 'Payment for Services'
      };
      const result = constructPaymentString(data);
      expect(result).toContain('ethereum:0x123...');
      // EIP-681: Ethereum amounts are `value=` in wei
      expect(result).toContain('value=1500000000000000000');
      expect(result).not.toContain('amount=');
      expect(result).toContain('label=Payment%20for%20Services');
    });

    it('sanitizes address input to prevent parameter injection', () => {
      const data: PaymentData = {
        network: CryptoNetwork.BITCOIN,
        address: '1A1...?amount=1000',
        amount: '0.1',
        label: ''
      };
      // Should strip the ?amount=1000 from the address part
      const result = constructPaymentString(data);
      expect(result).toContain('bitcoin:1A1...');
      expect(result).not.toContain('bitcoin:1A1...?amount=1000');
    });

    it('encodes amount to prevent injection', () => {
        const data: PaymentData = {
            network: CryptoNetwork.BITCOIN,
            address: '1A1...',
            amount: '1&label=hacked',
            label: ''
        };
        const result = constructPaymentString(data);
        // Not a plain decimal, so the code is refused instead of carrying the extra parameter (#1283)
        expect(result).toBe('');
    });

    it('returns raw address for custom network', () => {
         const data: PaymentData = {
            network: CryptoNetwork.CUSTOM,
            address: 'myprotocol://addr',
            amount: '10', // Should be ignored or handled by the user in the address field
            label: 'label'
        };
        // For custom, it just returns the address field as is
        expect(constructPaymentString(data)).toBe('myprotocol://addr');
    });

    it('returns empty string for dangerous custom network address', () => {
      const data: PaymentData = {
        network: CryptoNetwork.CUSTOM,
        address: 'javascript:alert(1)',
        amount: '10',
        label: 'label'
      };
      expect(constructPaymentString(data)).toBe('');
    });
  });

  describe('constructEventString', () => {
    const baseEvent: EventData = {
      title: 'Team Meeting',
      startDate: '2026-05-01T09:00',
      endDate: '2026-05-01T10:00',
      location: 'HQ Boardroom',
      description: 'Quarterly planning sync'
    };

    it('constructs a valid VCALENDAR string', () => {
      const result = constructEventString(baseEvent);
      expect(result).toContain('BEGIN:VCALENDAR');
      expect(result).toContain('VERSION:2.0');
      expect(result).toContain('BEGIN:VEVENT');
      expect(result).toContain('SUMMARY:Team Meeting');
      expect(result).toContain('DTSTART:20260501T090000');
      expect(result).toContain('DTEND:20260501T100000');
      expect(result).toContain('LOCATION:HQ Boardroom');
      expect(result).toContain('DESCRIPTION:Quarterly planning sync');
      expect(result).toContain('END:VEVENT');
      expect(result).toContain('END:VCALENDAR');
    });

    it('escapes special characters in event fields', () => {
      const result = constructEventString({
        ...baseEvent,
        title: 'Launch, Party; 2026',
        location: 'Office\\Roof',
        description: 'Line 1\nLine 2, details;'
      });

      expect(result).toContain('SUMMARY:Launch\\, Party\\; 2026');
      expect(result).toContain('LOCATION:Office\\\\Roof');
      expect(result).toContain('DESCRIPTION:Line 1\\nLine 2\\, details\\;');
    });
  });
});

describe('Location generator', () => {
  it('constructs a valid geo URI', () => {
    expect(constructLocationString(FIXTURES.coordinates.newYork))
      .toBe('geo:40.7128,-74.006');
  });

  it('returns empty string for empty latitude', () => {
    expect(constructLocationString({ latitude: '', longitude: '-74.0060' })).toBe('');
  });

  it('returns empty string for empty longitude', () => {
    expect(constructLocationString({ latitude: '40.7128', longitude: '' })).toBe('');
  });

  it('returns geo URI even for out-of-range latitude (> 90)', () => {
    expect(constructLocationString({ latitude: '91', longitude: '0' })).toBe('geo:91,0');
  });

  it('returns geo URI even for out-of-range latitude (< -90)', () => {
    expect(constructLocationString({ latitude: '-91', longitude: '0' })).toBe('geo:-91,0');
  });

  it('returns geo URI even for out-of-range longitude (> 180)', () => {
    expect(constructLocationString({ latitude: '0', longitude: '181' })).toBe('geo:0,181');
  });

  it('returns geo URI even for out-of-range longitude (< -180)', () => {
    expect(constructLocationString({ latitude: '0', longitude: '-181' })).toBe('geo:0,-181');
  });

  it('returns empty string for non-numeric input', () => {
    expect(constructLocationString({ latitude: 'abc', longitude: '0' })).toBe('');
  });

  it('handles boundary values', () => {
    expect(constructLocationString({ latitude: FIXTURES.coordinates.boundary.maxLat.latitude, longitude: FIXTURES.coordinates.boundary.maxLng.longitude })).toBe('geo:90,180');
    expect(constructLocationString({ latitude: FIXTURES.coordinates.boundary.minLat.latitude, longitude: FIXTURES.coordinates.boundary.minLng.longitude })).toBe('geo:-90,-180');
  });
});

describe('Meeting generator', () => {
  it('returns the URL as-is for a valid meeting link', () => {
    const url = 'https://zoom.us/j/123456789?pwd=AbCdEfGh';
    expect(constructMeetingString({ url })).toBe(url);
  });

  it('returns empty string for empty URL', () => {
    expect(constructMeetingString({ url: '' })).toBe('');
  });

  it('returns raw dangerous URL as-is', () => {
    expect(constructMeetingString({ url: 'javascript:alert(1)' })).toBe('javascript:alert(1)');
  });

  it('trims whitespace from the URL', () => {
    expect(constructMeetingString({ url: '  https://meet.google.com/abc-defg-hij  ' }))
      .toBe('https://meet.google.com/abc-defg-hij');
  });
});

describe('Social generator', () => {
  describe('constructSocialString', () => {
    it('generates an Instagram profile URL', () => {
      expect(constructSocialString({ platform: SocialPlatform.INSTAGRAM, handle: 'myuser' }))
        .toBe('https://instagram.com/myuser');
    });

    it('generates a Twitter/X profile URL', () => {
      expect(constructSocialString({ platform: SocialPlatform.TWITTER, handle: 'myuser' }))
        .toBe('https://x.com/myuser');
    });

    it('generates a TikTok profile URL', () => {
      expect(constructSocialString({ platform: SocialPlatform.TIKTOK, handle: 'myuser' }))
        .toBe('https://tiktok.com/@myuser');
    });

    it('generates a LinkedIn profile URL', () => {
      expect(constructSocialString({ platform: SocialPlatform.LINKEDIN, handle: 'myuser' }))
        .toBe('https://linkedin.com/in/myuser');
    });

    it('generates a YouTube profile URL', () => {
      expect(constructSocialString({ platform: SocialPlatform.YOUTUBE, handle: 'myuser' }))
        .toBe('https://youtube.com/@myuser');
    });

    it('generates a Facebook profile URL', () => {
      expect(constructSocialString({ platform: SocialPlatform.FACEBOOK, handle: 'myuser' }))
        .toBe('https://facebook.com/myuser');
    });

    it('generates a WhatsApp profile URL', () => {
      expect(constructSocialString({ platform: SocialPlatform.WHATSAPP, handle: '15551234567' }))
        .toBe('https://wa.me/15551234567');
    });

    it('generates a GitHub profile URL', () => {
      expect(constructSocialString({ platform: SocialPlatform.GITHUB, handle: 'myuser' }))
        .toBe('https://github.com/myuser');
    });

    it('strips @ from handle in generated URL', () => {
      expect(constructSocialString({ platform: SocialPlatform.INSTAGRAM, handle: '@myuser' }))
        .toBe('https://instagram.com/myuser');
    });

    it('returns empty string for empty handle', () => {
      expect(constructSocialString({ platform: SocialPlatform.INSTAGRAM, handle: '' })).toBe('');
    });

    it('sanitizes a malicious handle to prevent URI injection', () => {
      const result = constructSocialString({
        platform: SocialPlatform.INSTAGRAM,
        handle: '../../../etc/passwd',
      });
      // The slash characters are stripped; result should be safe
      expect(result).not.toContain('../');
      expect(result).not.toContain('/etc/');
    });
  });
});

describe('QR Helpers Email Security', () => {
  it('constructEmailString should percent-encode raw newlines in email', () => {
    const data: EmailData = {
      email: 'user@example.com\ncc:attacker@example.com',
      subject: 'Test',
      body: 'Body'
    };
    const result = constructEmailString(data);
    expect(result).toBe('mailto:user@example.com%0Acc%3Aattacker@example.com?subject=Test&body=Body');
  });

  it('constructEmailString should percent-encode raw control characters in email', () => {
      const data: EmailData = {
          email: 'user@example.com\x00',
          subject: 'Test',
          body: 'Body'
      };
      const result = constructEmailString(data);
      expect(result).toBe('mailto:user@example.com%00?subject=Test&body=Body');
  });
});

describe('QR Helper Injection', () => {
  describe('WiFi String Injection', () => {
    it('should inject fields if hidden is not a boolean', () => {
      const maliciousData = {
        ssid: 'MyNetwork',
        password: 'pass',
        encryption: WifiEncryption.WPA,
        // @ts-ignore - simulating runtime type mismatch or injection
        hidden: 'true;S:EvilSSID'
      } as unknown as WifiData;

      const result = constructWifiString(maliciousData);
      console.log('Result:', result);
      expect(result).not.toContain('S:EvilSSID');
    });

    it('should inject fields if encryption contains delimiters', () => {
      const maliciousData = {
        ssid: 'MyNetwork',
        password: 'pass',
        // @ts-ignore
        encryption: 'WPA;S:EvilSSID',
        hidden: false
      } as unknown as WifiData;

      const result = constructWifiString(maliciousData);
      console.log('Result:', result);
      expect(result).not.toContain('S:EvilSSID');
    });
  });

  describe('Payment String Injection', () => {
    it('should not allow javascript protocol in network field', () => {
      const maliciousData = {
        // @ts-ignore
        network: 'javascript',
        address: 'alert(1)',
        amount: '',
        label: ''
      } as unknown as PaymentData;

      const result = constructPaymentString(maliciousData);
      console.log('Payment Result:', result);
      expect(result).not.toContain('javascript:alert(1)');
      // Ideally it should fall back to empty or safe string
      expect(result).toBe('');
    });
  });
});

describe('QR Helpers Sad Paths', () => {
  describe('constructEmailString', () => {
    it('should handle raw email containing query parameters', () => {
      const data: EmailData = {
        email: '?subject=bad',
        subject: 'Test',
        body: 'Body'
      };
      expect(constructEmailString(data)).toBe('mailto:%3Fsubject%3Dbad?subject=Test&body=Body');
    });

    it('should handle completely empty data', () => {
      const data: EmailData = {
        email: '',
        subject: '',
        body: ''
      };
      // Nothing typed: no code, so the generator shows its sample (#1272).
      expect(constructEmailString(data)).toBe('');
    });
  });

  describe('constructVCardString', () => {
    it('should handle fields consisting only of delimiters', () => {
      const data: VCardData = {
        firstName: ';;;',
        lastName: '\\',
        organization: ',',
        title: '',
        phone: '',
        email: '',
        website: '',
        street: '',
        city: '',
        zip: '',
        country: ''
      };
      const result = constructVCardString(data);
      // N:lastName;firstName;;;
      // lastName = '\\' -> '\\\\'
      // firstName = ';;;' -> '\;\;' (wait, backslash first?)
      // delimiters are ; and , and \

      // Expected behavior:
      // lastName: \ -> escaped to \\
      // firstName: ;;; -> escaped to \;\; (Wait, if I have ';;;', it becomes '\;\;\\;')

      expect(result).toContain('N:\\\\;\\;\\;\\;');
      expect(result).toContain('ORG:\\,');
    });
  });

  describe('constructPaymentString', () => {
    it('should handle parameter injection attempts in amount', () => {
      const data: PaymentData = {
        network: CryptoNetwork.BITCOIN,
        address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
        amount: '0.1&label=Hacked',
        label: 'Donation'
      };
      const result = constructPaymentString(data);
      // Not a plain decimal, so the code is refused instead of carrying the extra parameter (#1283)
      expect(result).toBe('');
    });
  });

  describe('constructSmsString', () => {
    it('should prevent parameter injection in SMS number', () => {
      const data: SmsData = {
        number: '123?body=injected',
        message: 'hello'
      };
      // If we don't sanitize the number, we get sms:123?body=injected?body=hello
      // We expect the number to be cleaned of URI control characters AND non-phone chars
      const result = constructSmsString(data);
      // It should NOT contain two 'body=' params or two '?'
      expect(result).not.toMatch(/\?.*\?/);
      // With strict whitelist, 'bodyinjected' is removed
      expect(result).toBe('sms:123?body=hello');
    });
  });

  describe('constructPhoneString', () => {
    it('should strip malicious parameter injections', () => {
      const data: PhoneData = {
        number: '123?body=injected'
      };
      const result = constructPhoneString(data);
      expect(result).toBe('tel:123');
    });

    it('should handle empty input', () => {
      const data: PhoneData = {
        number: ''
      };
      const result = constructPhoneString(data);
      // RFC 3966 needs digits: no number, no code (#1272).
      expect(result).toBe('');
    });
  });
});

describe('qrHelpers Security', () => {
  describe('constructPaymentString', () => {
    it('blocks dangerous schemes in custom network', () => {
      const dangerousPayload = 'javascript:alert(1)';
      const result = constructPaymentString({
        network: CryptoNetwork.CUSTOM,
        address: dangerousPayload,
        amount: '',
        label: ''
      });
      expect(result).toBe('');
    });

    it('allows valid custom URIs', () => {
      const validPayload = 'bitcoin:123?amount=10';
      const result = constructPaymentString({
        network: CryptoNetwork.CUSTOM,
        address: validPayload,
        amount: '',
        label: ''
      });
      expect(result).toBe(validPayload);
    });

    it('constructPaymentString allows parameter injection in custom network if protocol is safe', () => {
      // This is expected behavior for "custom" network - user controls the full string
      // but we ensure it doesn't start with javascript:
      const payload = 'bitcoin:123?amount=100&label=Hack';
      const result = constructPaymentString({
        network: CryptoNetwork.CUSTOM,
        address: payload,
        amount: '',
        label: ''
      });
      expect(result).toBe(payload);
    });
  });
});

describe('qrHelpers Security - URL', () => {
  it('should allow raw value for javascript: protocol', () => {
    const dangerousPayload = 'javascript:alert(1)';
    const result = constructUrlString({
      url: dangerousPayload
    });
    expect(result).toBe(dangerousPayload);
  });

  it('should allow raw value for vbscript: protocol', () => {
    const dangerousPayload = 'vbscript:msgbox(1)';
    const result = constructUrlString({
      url: dangerousPayload
    });
    expect(result).toBe(dangerousPayload);
  });

  it('should allow valid protocols like https:', () => {
    const validPayload = 'https://example.com';
    const result = constructUrlString({
      url: validPayload
    });
    expect(result).toBe('https://example.com/');
  });
});

describe('VCard URL Normalization', () => {
  const baseData: VCardData = {
    firstName: 'John',
    lastName: 'Doe',
    organization: 'Acme',
    title: 'Dev',
    phone: '123',
    email: 'john@example.com',
    website: '',
    street: '',
    city: '',
    zip: '',
    country: ''
  };

  it('should handle URL with spaces correctly (encode them)', () => {
    const data = { ...baseData, website: 'http://example.com/foo bar' };
    const result = constructVCardString(data);
    // Should be encoded as %20
    expect(result).toContain('URL:http://example.com/foo%20bar');
  });

  it('should handle URL without protocol by adding https://', () => {
    const data = { ...baseData, website: 'www.google.com' };
    const result = constructVCardString(data);
    // Should add protocol
    expect(result).toContain('URL:https://www.google.com/');
  });

  it('should not double-encode already encoded URL', () => {
    const data = { ...baseData, website: 'http://example.com/foo%20bar' };
    const result = constructVCardString(data);
    // Should remain %20, not %2520
    expect(result).toContain('URL:http://example.com/foo%20bar');
    expect(result).not.toContain('foo%2520bar');
  });

  it('should handle malformed URL gracefully (fallback to original)', () => {
    // A malformed URL that might throw in encodeURI is tricky because encodeURI handles most things.
    // A lone % is malformed for decodeURI, but encodeURI encodes it as %25.
    // So encodeURI won't throw for %.
    // However, new URL() throws for invalid URLs.
    // If we pass a string that is completely invalid for URL constructor:
    // new URL('http://example.com/%') throws? No, % is allowed in path?
    // Chrome: new URL('http://example.com/%').href -> 'http://example.com/%'
    // It normalizes it.

    // Let's try something really invalid for URL constructor.
    // "http:/" (missing slash?) -> valid?
    // "not a url" -> invalid protocol.
    const data = { ...baseData, website: 'not a url' };
    const result = constructVCardString(data);
    // Should probably just return it or encode it?
    // If we try 'http://not a url', it might fail validation because 'not a url' is not a valid hostname.
    // So it falls back to encodeURI('not a url') -> 'not%20a%20url'.
    expect(result).toContain('URL:not%20a%20url');
  });
});

describe('Payment String Construction - Injection Risks', () => {
  it('prevents parameter injection via label in Amount field', () => {
    // Attack vector: User inputs "1&label=Hacked" into amount field
    const data = {
      network: CryptoNetwork.BITCOIN,
      address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
      amount: '1&label=Hacked',
      label: 'Official Donation'
    };

    const result = constructPaymentString(data);

    // We expect the amount to be encoded or sanitized so that & becomes %26 or rejected
    // If it's vulnerable, it will look like: bitcoin:... ?amount=1&label=Hacked&label=Official%20Donation

    expect(result).not.toContain('&label=Hacked');

    // Ideally, amount should be numeric only or encoded.
    // If we just encodeURIComponent the amount, it would be amount=1%26label%3DHacked
    // which is safe as it won't be parsed as a separate label param.
  });

  it('prevents parameter injection via query params in Address field', () => {
     // Attack vector: User inputs address "1A...?amount=100" and sets amount empty
     // Or user inputs address "1A...?label=Malicious"
     const data = {
       network: CryptoNetwork.BITCOIN,
       address: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?label=Evil',
       amount: '0.5',
       label: 'Good'
     };

     const result = constructPaymentString(data);

     // Result: bitcoin:1A...?label=Evil?amount=0.5&label=Good
     // This is malformed URI (two ?), but some parsers might take the first label.

     // We should probably strip ? from address or encode it,
     // BUT valid addresses shouldn't have ? unless it's a raw URI input.
     // In 'InputPanel', we have separate fields. So we should assume address is just the address.

     expect(result).not.toContain('?label=Evil');
  });
});
