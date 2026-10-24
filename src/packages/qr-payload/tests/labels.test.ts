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
import { QRType } from '@/packages/core/types';
import { getQrTypeLabel, getQrTypeDescription, QR_GENERATORS } from '../index';

describe('QR type labels', () => {
  describe('getQrTypeLabel', () => {
    it('returns user-friendly labels for all supported QR types', () => {
      expect(getQrTypeLabel(QRType.WIFI)).toBe('WiFi Network');
      expect(getQrTypeLabel(QRType.URL)).toBe('URL');
      expect(getQrTypeLabel(QRType.TEXT)).toBe('Text');
      expect(getQrTypeLabel(QRType.EVENT)).toBe('Event');
      expect(getQrTypeLabel(QRType.VCARD)).toBe('Contact');
      expect(getQrTypeLabel(QRType.EMAIL)).toBe('Email');
      expect(getQrTypeLabel(QRType.PHONE)).toBe('Phone');
      expect(getQrTypeLabel(QRType.SMS)).toBe('SMS');
      expect(getQrTypeLabel(QRType.PAYMENT)).toBe('Payment');
      expect(getQrTypeLabel(QRType.LOCATION)).toBe('Location');
      expect(getQrTypeLabel(QRType.MEETING)).toBe('Meeting');
      expect(getQrTypeLabel(QRType.SOCIAL)).toBe('Social');
    });

    it('returns the input type as fallback for unknown QR types', () => {
      expect(getQrTypeLabel('UNKNOWN_TYPE' as any)).toBe('UNKNOWN_TYPE');
    });
  });

  describe('getQrTypeDescription', () => {
    it('returns empty string if value is falsy', () => {
      expect(getQrTypeDescription(QRType.URL, '')).toBe('');
    });

    it('returns input value if generator for type does not exist', () => {
      expect(getQrTypeDescription('UNKNOWN_TYPE' as any, 'some_val')).toBe('some_val');
    });

    it('returns SSID for WIFI', () => {
      const wifiVal = 'WIFI:T:WPA;S:MyHomeWiFi;P:secretpassword;;';
      expect(getQrTypeDescription(QRType.WIFI, wifiVal)).toBe('MyHomeWiFi');
    });

    it('returns URL for URL type', () => {
      expect(getQrTypeDescription(QRType.URL, 'https://example.com')).toBe('https://example.com');
    });

    it('returns text content for TEXT type', () => {
      expect(getQrTypeDescription(QRType.TEXT, 'Hello World')).toBe('Hello World');
    });

    it('returns title for EVENT', () => {
      // Event generates a format like BEGIN:VEVENT\nSUMMARY:My Event\n...
      const eventVal = 'BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nSUMMARY:Birthday Party\nDTSTART:20260731T130000\nDTEND:20260731T150000\nEND:VEVENT\nEND:VCALENDAR';
      expect(getQrTypeDescription(QRType.EVENT, eventVal)).toBe('Birthday Party');
    });

    it('returns joined first and last name for VCARD', () => {
      const vcardVal = 'BEGIN:VCARD\nVERSION:3.0\nN:Doe;John;;;\nFN:John Doe\nORG:ACME\nEND:VCARD';
      expect(getQrTypeDescription(QRType.VCARD, vcardVal)).toBe('John Doe');
    });

    it('returns organization for VCARD if name is empty', () => {
      const vcardVal = 'BEGIN:VCARD\nVERSION:3.0\nORG:ACME Corp\nEND:VCARD';
      expect(getQrTypeDescription(QRType.VCARD, vcardVal)).toBe('ACME Corp');
    });

    it('returns empty string or value for VCARD if both name and organization are empty', () => {
      const vcardVal = 'BEGIN:VCARD\nVERSION:3.0\nEND:VCARD';
      expect(getQrTypeDescription(QRType.VCARD, vcardVal)).toBe('');
    });

    it('returns email address for EMAIL type', () => {
      expect(getQrTypeDescription(QRType.EMAIL, 'mailto:test@example.com')).toBe('test@example.com');
    });

    it('returns phone number for PHONE type', () => {
      expect(getQrTypeDescription(QRType.PHONE, 'tel:+123456789')).toBe('+123456789');
    });

    it('returns SMS number for SMS type', () => {
      expect(getQrTypeDescription(QRType.SMS, 'SMSTO:+123456789:Hello')).toBe('+123456789');
    });

    it('returns address for PAYMENT', () => {
      const paymentVal = 'ethereum:0x1234567890123456789012345678901234567890?value=1.5';
      expect(getQrTypeDescription(QRType.PAYMENT, paymentVal)).toBe('0x1234567890123456789012345678901234567890');
    });

    it('returns latitude and longitude for LOCATION', () => {
      expect(getQrTypeDescription(QRType.LOCATION, 'geo:37.7749,-122.4194')).toBe('37.7749, -122.4194');
    });

    it('returns empty string for LOCATION if coords are missing', () => {
      expect(getQrTypeDescription(QRType.LOCATION, 'geo:')).toBe('');
    });

    it('returns meeting URL for MEETING', () => {
      expect(getQrTypeDescription(QRType.MEETING, 'https://zoom.us/j/12345')).toBe('https://zoom.us/j/12345');
    });

    it('returns social handle for SOCIAL', () => {
      expect(getQrTypeDescription(QRType.SOCIAL, 'https://twitter.com/myhandle')).toBe('@myhandle');
    });

    it('returns empty string if social handle is missing', () => {
      expect(getQrTypeDescription(QRType.SOCIAL, 'https://twitter.com/')).toBe('');
    });

    it('returns the raw value when generator.hydrate returns null or falsy', () => {
      // Mocking/passing an unrecognized format for URL which might return empty/null hydrate object
      const invalidWifi = 'WIFI:';
      expect(getQrTypeDescription(QRType.WIFI, invalidWifi)).toBe('');
    });

    it('recovers and returns the input value when parsing/hydration throws an error', () => {
      const originalHydrate = QR_GENERATORS[QRType.URL].hydrate;
      QR_GENERATORS[QRType.URL].hydrate = () => {
        throw new Error('Test throw');
      };
      try {
        expect(getQrTypeDescription(QRType.URL, 'http://test.com')).toBe('http://test.com');
      } finally {
        QR_GENERATORS[QRType.URL].hydrate = originalHydrate;
      }
    });

    it('covers switch default fallback when type is not handled but generator exists', () => {
      const generators = QR_GENERATORS as unknown as Record<string, any>;
      generators['CUSTOM_TYPE'] = {
        generate: () => '',
        hydrate: () => ({ someProperty: 'hello' }),
      };
      try {
        expect(getQrTypeDescription('CUSTOM_TYPE' as any, 'some_val')).toBe('some_val');
      } finally {
        delete generators['CUSTOM_TYPE'];
      }
    });

    it('covers falsy hydrated data fallback', () => {
      const originalHydrate = QR_GENERATORS[QRType.URL].hydrate;
      QR_GENERATORS[QRType.URL].hydrate = () => null as any;
      try {
        expect(getQrTypeDescription(QRType.URL, 'http://test.com')).toBe('http://test.com');
      } finally {
        QR_GENERATORS[QRType.URL].hydrate = originalHydrate;
      }
    });

    it('covers falsy properties for all types fallback to empty string', () => {
      const types = [
        QRType.WIFI,
        QRType.URL,
        QRType.TEXT,
        QRType.EVENT,
        QRType.EMAIL,
        QRType.PHONE,
        QRType.SMS,
        QRType.PAYMENT,
        QRType.MEETING
      ];
      for (const type of types) {
        const originalHydrate = QR_GENERATORS[type].hydrate;
        QR_GENERATORS[type].hydrate = () => ({}) as any; // return empty object so property is undefined
        try {
          expect(getQrTypeDescription(type, 'some_val')).toBe('');
        } finally {
          QR_GENERATORS[type].hydrate = originalHydrate;
        }
      }
    });
  });
});
