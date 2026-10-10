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
import { constructWifiString, hydrateWifiData, WifiContract } from '../index';
import { WifiEncryption, WifiEapMethod, WifiEapPhase2, QRType } from '@/types';

describe('Wifi generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
      ssid: 'My Network',
      password: 'password123;',
      encryption: WifiEncryption.WPA,
      hidden: true,
      eapIdentity: '',
    };
    const str = constructWifiString(data);
    const hydrated = hydrateWifiData(str);
    expect(hydrated).toEqual(data);
  });

  it('hydrates unknown fields or non-wifi strings', () => {
    const result = hydrateWifiData('random');
    expect(result.ssid).toBe('');

    const result2 = hydrateWifiData('WIFI:INVALID;;');
    expect(result2.ssid).toBe('');

    const result3 = hydrateWifiData('WIFI:T:UNKNOWN;;');
    expect(result3.encryption).toBe(WifiEncryption.WPA);
  });

  it('hydrates WPA2-EAP identity', () => {
    const data = {
      ssid: 'My Enterprise',
      password: 'password123;',
      encryption: WifiEncryption.WPA2_EAP,
      hidden: false,
      eapIdentity: 'user123',
    };
    const str = constructWifiString(data);
    const hydrated = hydrateWifiData(str);
    // The default EAP method and phase 2 are emitted, so they come back on hydrate
    expect(hydrated).toEqual({
      ...data,
      eapMethod: WifiEapMethod.PEAP,
      eapPhase2: WifiEapPhase2.MSCHAPV2,
    });
  });

  it('hydrates string ending with single semicolon', () => {
    const raw = 'WIFI:S:MyNet;P:secret;T:WPA;';
    const hydrated = hydrateWifiData(raw);
    expect(hydrated.ssid).toBe('MyNet');
    expect(hydrated.password).toBe('secret');
    expect(hydrated.encryption).toBe(WifiEncryption.WPA);
  });

  it('hydrates string not ending with a semicolon', () => {
    const raw = 'WIFI:S:NoSemiNet;P:password123;T:WPA';
    const hydrated = hydrateWifiData(raw);
    expect(hydrated.ssid).toBe('NoSemiNet');
    expect(hydrated.password).toBe('password123');
    expect(hydrated.encryption).toBe(WifiEncryption.WPA);
  });

  it('builds no code without a network name (#1272)', () => {
    for (const ssid of ['', '   ', undefined as unknown as string]) {
      expect(constructWifiString({ ssid, password: 'secret', encryption: WifiEncryption.WPA, hidden: false })).toBe('');
    }
  });

  it('handles edge cases in escaping with undefined fields', () => {
    const data = {
      ssid: 'Office',
      password: undefined as unknown as string,
      encryption: WifiEncryption.WPA2_EAP,
      hidden: false,
      eapIdentity: undefined as unknown as string,
    };
    const str = constructWifiString(data);
    expect(str).toContain('S:Office;');
    expect(str).toContain('P:;');
    expect(str).toContain('I:;');
  });

  it('preserves control characters and still escapes correctly', () => {
    const data = {
      ssid: 'My\nNetwork\0\t',
      password: 'Pass\rWord\x1F',
      encryption: WifiEncryption.WPA2_EAP,
      hidden: false,
      eapIdentity: 'My;Net\nwork',
    };
    const str = constructWifiString(data);
    expect(str).toContain('S:My\nNetwork\0\t;');
    expect(str).toContain('P:Pass\rWord\x1F;');
    expect(str).toContain('I:My\\;Net\nwork;');
  });

  it('implements WifiContract correctly', () => {
    expect(WifiContract.type).toBe(QRType.WIFI);
    expect(WifiContract.matches('WIFI:S:test;;')).toBe(true);
    expect(WifiContract.matches('OTHER:S:test;;')).toBe(false);
    expect(WifiContract.validate?.('WIFI:S:test;;')).toEqual([]);
  });

  it('handles empty SSID or parameters', () => {
    const raw = 'WIFI:S:;P:;T:WPA;';
    const hydrated = hydrateWifiData(raw);
    expect(hydrated.ssid).toBe('');
    expect(hydrated.password).toBe('');
  });

  it('correctly extracts passwords ending in an odd number of backslashes', () => {
    const data = {
      ssid: 'My Network',
      password: 'my_password\\',
      encryption: WifiEncryption.WPA,
      hidden: false,
      eapIdentity: '',
    };
    const str = constructWifiString(data);
    expect(str).toContain('P:my_password\\\\;');
    const hydrated = hydrateWifiData(str);
    expect(hydrated.password).toBe('my_password\\');
  });

  it('correctly parses password ending in backslash from raw input', () => {
    const raw = 'WIFI:S:MyNet;P:pwd\\\\;T:WPA;';
    const hydrated = hydrateWifiData(raw);
    expect(hydrated.password).toBe('pwd\\');
  });

  it('separates parameters accurately when values contain even numbers of backslashes followed by a semicolon', () => {
    const data = {
      ssid: 'MyNet',
      password: 'pwd\\\\',
      encryption: WifiEncryption.WPA,
      hidden: true,
      eapIdentity: '',
    };
    const str = constructWifiString(data);
    expect(str).toContain('P:pwd\\\\\\\\;H:true');
    const hydrated = hydrateWifiData(str);
    expect(hydrated.password).toBe('pwd\\\\');
    expect(hydrated.hidden).toBe(true);
  });

  it('separates parameters with even backslashes from raw input', () => {
    const raw = 'WIFI:S:MyNet;P:pwd\\\\\\\\;H:true;';
    const hydrated = hydrateWifiData(raw);
    expect(hydrated.password).toBe('pwd\\\\');
    expect(hydrated.hidden).toBe(true);
  });

  it('rejects prohibited control and zero-width characters during evaluation', () => {
    expect(() => hydrateWifiData('WIFI:S:MyNet\x00;P:secret;')).toThrow(
      'Payload contains prohibited control or zero-width characters'
    );
    expect(() => hydrateWifiData('WIFI:S:MyNet\u200B;P:secret;')).toThrow(
      'Payload contains prohibited control or zero-width characters'
    );
    expect(() => hydrateWifiData('WIFI:S:MyNet\uFEFF;P:secret;')).toThrow(
      'Payload contains prohibited control or zero-width characters'
    );
    expect(() => hydrateWifiData('WIFI:S:MyNet\x15;P:secret;')).toThrow(
      'Payload contains prohibited control or zero-width characters'
    );
  });

  it('does not reject allowed characters such as newline, carriage return, and tab', () => {
    const raw = 'WIFI:S:My\nNet\t;P:sec\ret;T:WPA;';
    const hydrated = hydrateWifiData(raw);
    expect(hydrated.ssid).toBe('My\nNet\t');
    expect(hydrated.password).toBe('sec\ret');
  });
});
