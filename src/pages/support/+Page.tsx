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

import { AppInfoPage, APP_INFO_LINK_CLASSES } from '@/components/AppInfoPage';

/**
 * Contact address for app support. A placeholder until the owner picks an address; it is shown
 * as-is so a missing address is obvious rather than silently wrong.
 */
const SUPPORT_CONTACT = 'YOUR_EMAIL';

/**
 * Support page for the native app "QRCraftly: QR Code Studio" on iPhone, iPad and Mac. The text
 * is the App Store support page from the app repository (`AppStore/pages/support.md`).
 * @returns The support page.
 */
export default function Page() {
  return (
    <AppInfoPage title="QRCraftly for iPhone, iPad and Mac: Support">
      <p>
        <strong className="text-fg">A code won&apos;t scan.</strong> Check the reliability grade under the code. Tap it
        to see each check and its fix: raise the contrast, shrink the logo, switch to a simpler pattern or raise error
        correction. For print, use Export &gt; PDF or a large PNG, and test a printed sample.
      </p>
      <p>
        <strong className="text-fg">The camera doesn&apos;t start.</strong> Allow camera access in Settings &gt; Privacy
        &amp; Security &gt; Camera &gt; QRCraftly. You can always scan a photo with Choose Photo or Video instead.
      </p>
      <p>
        <strong className="text-fg">Camera Transfer is slow or stops.</strong> Hold both screens steady in even light
        with little glare, turn the sending screen&apos;s brightness up, and try the Steady speed. Reduced Flashing is
        slower by design.
      </p>
      <p>
        <strong className="text-fg">Is my data private?</strong> Yes. Everything happens on your device; QRCraftly has
        no servers, accounts or tracking. See the{' '}
        <a href="/privacy" className={APP_INFO_LINK_CLASSES}>privacy policy</a>.
      </p>
      <p>
        <strong className="text-fg">Contact us</strong>: {SUPPORT_CONTACT}.
      </p>
    </AppInfoPage>
  );
}
