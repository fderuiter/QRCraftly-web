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
import { constructSocialString, hydrateSocialData, identifyProtocol } from '../index';
import { SocialPlatform } from '@/types';
import { QRType } from '@/packages/core/types';

describe('Social generator', () => {
  it('constructs and hydrates successfully', () => {
    const data = {
      platform: SocialPlatform.TIKTOK,
      handle: 'qrcraftly',
    };
    const str = constructSocialString(data);
    const hydrated = hydrateSocialData(str);
    expect(hydrated).toEqual(data);
  });

  it('hydrates unknown urls or raw strings', () => {
    const result = hydrateSocialData('random');
    expect(result.handle).toBe('');

    const result2 = hydrateSocialData('https://example.com/user');
    expect(result2.handle).toBe('');
  });

  it('hydrates urls with www. prefix', () => {
    const hydrated = hydrateSocialData('https://www.instagram.com/qrcraftly');
    expect(hydrated.platform).toBe(SocialPlatform.INSTAGRAM);
    expect(hydrated.handle).toBe('qrcraftly');
  });

  it('hydrates instagram', () => {
    const hydrated = hydrateSocialData('https://instagram.com/qrcraftly');
    expect(hydrated.platform).toBe(SocialPlatform.INSTAGRAM);
    expect(hydrated.handle).toBe('qrcraftly');
  });

  it('hydrates twitter', () => {
    const hydrated = hydrateSocialData('https://x.com/qrcraftly');
    expect(hydrated.platform).toBe(SocialPlatform.TWITTER);
    expect(hydrated.handle).toBe('qrcraftly');
  });

  it('hydrates linkedin with /in/ prefix', () => {
    const hydrated = hydrateSocialData('https://linkedin.com/in/qrcraftly');
    expect(hydrated.platform).toBe(SocialPlatform.LINKEDIN);
    expect(hydrated.handle).toBe('qrcraftly');

    const hydratedWww = hydrateSocialData('https://www.linkedin.com/in/qrcraftly');
    expect(hydratedWww.platform).toBe(SocialPlatform.LINKEDIN);
    expect(hydratedWww.handle).toBe('qrcraftly');
  });

  it('hydrates youtube with @ handle', () => {
    const hydrated = hydrateSocialData('https://youtube.com/@qrcraftly');
    expect(hydrated.platform).toBe(SocialPlatform.YOUTUBE);
    expect(hydrated.handle).toBe('qrcraftly');
  });

  it('hydrates facebook', () => {
    const hydrated = hydrateSocialData('https://facebook.com/qrcraftly');
    expect(hydrated.platform).toBe(SocialPlatform.FACEBOOK);
    expect(hydrated.handle).toBe('qrcraftly');
  });

  it('hydrates whatsapp wa.me links with and without message', () => {
    const hydratedNoMsg = hydrateSocialData('https://wa.me/15551234567');
    expect(hydratedNoMsg.platform).toBe(SocialPlatform.WHATSAPP);
    expect(hydratedNoMsg.handle).toBe('15551234567');
    expect(hydratedNoMsg.message).toBeUndefined();

    const hydratedWithMsg = hydrateSocialData('https://wa.me/15551234567?text=Hello%20World%0ANext%20Line');
    expect(hydratedWithMsg.platform).toBe(SocialPlatform.WHATSAPP);
    expect(hydratedWithMsg.handle).toBe('15551234567');
    expect(hydratedWithMsg.message).toBe('Hello World\nNext Line');

    // The Social form builds wa.me links, so a generic whatsapp.com link is not one it can rebuild.
    const hydratedCom = hydrateSocialData('https://whatsapp.com/15551234567');
    expect(hydratedCom.handle).toBe('');
  });

  it('keeps lossy WhatsApp links classified as QRType.URL', () => {
    const lossyInputs = [
      'https://api.whatsapp.com/send?phone=15551234567&text=Hello&utm_source=qr&app_absent=0',
      'https://wa.me/15551234567?utm_source=qr',
      'https://wa.me/15551234567?text=%20Hi%20',
      'https://wa.me/15551234567?text=%20',
      'https://wa.me/15551234567?text=C++',
    ];

    for (const input of lossyInputs) {
      expect(identifyProtocol(input)).toBe(QRType.URL);
      expect(hydrateSocialData(input).handle).toBe('');
    }
  });

  it('round-trips multi-line whatsapp message exact URL', () => {
    const link = 'https://wa.me/15551234567?text=Hello%20World%0ANext%20Line';
    expect(identifyProtocol(link)).toBe(QRType.SOCIAL);
    const hydrated = hydrateSocialData(link);
    expect(hydrated).toEqual({
      platform: SocialPlatform.WHATSAPP,
      handle: '15551234567',
      message: 'Hello World\nNext Line',
    });
    expect(constructSocialString(hydrated)).toBe(link);
  });

  it('constructs whatsapp URLs with encoded pre-filled messages', () => {
    const noMsg = constructSocialString({
      platform: SocialPlatform.WHATSAPP,
      handle: '15551234567',
    });
    expect(noMsg).toBe('https://wa.me/15551234567');

    const emptyMsg = constructSocialString({
      platform: SocialPlatform.WHATSAPP,
      handle: '15551234567',
      message: '   ',
    });
    expect(emptyMsg).toBe('https://wa.me/15551234567');

    const withMsg = constructSocialString({
      platform: SocialPlatform.WHATSAPP,
      handle: '15551234567',
      message: 'Hello World!\nInquiry #101',
    });
    expect(withMsg).toBe('https://wa.me/15551234567?text=Hello%20World!%0AInquiry%20%23101');
  });

  it('hydrates github', () => {
    const hydrated = hydrateSocialData('https://github.com/qrcraftly');
    expect(hydrated.platform).toBe(SocialPlatform.GITHUB);
    expect(hydrated.handle).toBe('qrcraftly');
  });

  it('hydrates handle fallback', () => {
    const hydrated = hydrateSocialData('https://instagram.com/');
    expect(hydrated.handle).toBe('');
    const hydrated2 = hydrateSocialData('https://x.com/');
    expect(hydrated2.handle).toBe('');
    const hydrated3 = hydrateSocialData('https://tiktok.com/');
    expect(hydrated3.handle).toBe('');
  });

  it('handles unknown platform', () => {
    const data = {
      platform: 'UNKNOWN' as SocialPlatform,
      handle: 'qrcraftly',
    };
    const str = constructSocialString(data);
    expect(str).toBe('');
  });

  it('sanitizes handles correctly by stripping invalid characters', () => {
    // strips leading @ sign
    expect(
      constructSocialString({ platform: SocialPlatform.INSTAGRAM, handle: '@username' })
    ).toBe('https://instagram.com/username');

    // strips path-injection characters (slashes)
    expect(
      constructSocialString({ platform: SocialPlatform.INSTAGRAM, handle: 'user/../../etc' })
    ).toBe('https://instagram.com/user....etc');

    // strips query string characters
    expect(
      constructSocialString({ platform: SocialPlatform.INSTAGRAM, handle: 'user?x=1' })
    ).toBe('https://instagram.com/userx1');

    // strips hash characters
    expect(
      constructSocialString({ platform: SocialPlatform.INSTAGRAM, handle: 'user#fragment' })
    ).toBe('https://instagram.com/userfragment');

    // allows underscores, hyphens, and periods
    expect(
      constructSocialString({
        platform: SocialPlatform.INSTAGRAM,
        handle: 'user_name.test-123',
      })
    ).toBe('https://instagram.com/user_name.test-123');
  });
  it('leaves an http profile link as a Website code so its scheme survives (#1481)', () => {
    expect(identifyProtocol('http://github.com/fderuiter')).not.toBe(QRType.SOCIAL);
    expect(identifyProtocol('https://github.com/fderuiter')).toBe(QRType.SOCIAL);
  });
});
