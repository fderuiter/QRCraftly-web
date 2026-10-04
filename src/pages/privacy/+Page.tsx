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

import { AppInfoPage, APP_INFO_LINK_CLASSES, APP_POLICY_DATE } from '@/components/AppInfoPage';

const LIST_CLASSES = 'list-disc space-y-2 pl-6';

/**
 * Privacy policy for the native app "QRCraftly: QR Code Studio" on iPhone, iPad and Mac (not
 * the web app, whose privacy architecture is on /security). The text is the App Store policy
 * from the app repository (`AppStore/pages/privacy-policy.md`), word for word.
 * @returns The privacy policy page.
 */
export default function Page() {
  return (
    <AppInfoPage
      title="QRCraftly for iPhone, iPad and Mac: Privacy Policy"
      meta={
        <>
          Effective date: <time dateTime={APP_POLICY_DATE.iso}>{APP_POLICY_DATE.label}</time>
          <br />
          <em>
            Last updated: <time dateTime={APP_POLICY_DATE.iso}>{APP_POLICY_DATE.label}</time>
          </em>
        </>
      }
    >
      <p>QRCraftly is made to work entirely on your device. We don&apos;t collect, store or share any of your data.</p>

      <section aria-labelledby="information" className="space-y-3">
        <h2 id="information" className="text-2xl font-bold text-fg">What QRCraftly does with your information</h2>
        <ul className={LIST_CLASSES}>
          <li>
            Codes you create, codes you scan and files you send or receive are processed only on your device and are
            never sent to us or anyone else. They are gone when you close the app, unless you save or share them
            yourself.
          </li>
          <li>
            The app remembers your last-used look (pattern, colors and error correction) and which tips you&apos;ve seen,
            on your device only.
          </li>
          <li>
            QRCraftly makes no network connections. It has no accounts, advertising, analytics, tracking or crash
            reporting.
          </li>
        </ul>
      </section>

      <section aria-labelledby="permissions" className="space-y-3">
        <h2 id="permissions" className="text-2xl font-bold text-fg">Permissions</h2>
        <ul className={LIST_CLASSES}>
          <li>
            <strong className="text-fg">Camera</strong>: to scan codes, receive a transfer or check a printed code, only
            when you start those features. Camera frames are read on your device and never recorded or saved.
          </li>
          <li>
            <strong className="text-fg">Photos</strong>: only to add images you choose to save. To scan a photo you pick
            it in the system picker; QRCraftly can&apos;t see the rest of your library.
          </li>
          <li>
            <strong className="text-fg">Location</strong>: only when you tap Use My Location to fill a Location code. It
            isn&apos;t stored or sent.
          </li>
          <li>
            <strong className="text-fg">Contacts and Calendar</strong>: the system&apos;s own screens add a contact or
            event you scanned; QRCraftly doesn&apos;t read your contacts or calendars.
          </li>
        </ul>
      </section>

      <p>
        <strong className="text-fg">Children</strong>: QRCraftly collects no data from anyone, including children.
      </p>
      <p>
        <strong className="text-fg">Changes</strong>: if this policy ever changes, the new version will be posted here
        with its date.
      </p>
      <p>
        <strong className="text-fg">Contact</strong>: see the{' '}
        <a href="/support" className={APP_INFO_LINK_CLASSES}>support page</a>.
      </p>
    </AppInfoPage>
  );
}
