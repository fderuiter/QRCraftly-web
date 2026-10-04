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

import { ArticleHeading, ArticleLayout, type ArticleSection } from '@/components/ArticleLayout';

/** The date this policy took effect, also its last update. Change both when the policy changes. */
const EFFECTIVE_DATE = '2026-10-04';
const EFFECTIVE_DATE_TEXT = 'October 4, 2026';

const SECTIONS: readonly ArticleSection[] = [
  { id: 'information', label: 'What QRCraftly does with your information' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'children', label: 'Children' },
  { id: 'changes', label: 'Changes' },
  { id: 'contact', label: 'Contact' },
];

const LINK_CLASSES = 'font-medium text-accent underline underline-offset-2';
const SECTION_CLASSES = 'mb-10 scroll-mt-6 space-y-3 text-fg-soft';

/**
 * Privacy policy for the native app "QRCraftly: QR Code Studio" on iPhone, iPad and Mac (not the
 * web app, whose privacy is described on /security). The App Store listing links here. The text
 * is the app repository's `AppStore/pages/privacy-policy.md`, word for word; keep the two in step.
 * @returns The app privacy policy page.
 */
export default function Page() {
  return (
    <ArticleLayout
      title="QRCraftly for iPhone, iPad and Mac: Privacy Policy"
      lead="QRCraftly is made to work entirely on your device. We don't collect, store or share any of your data."
      sections={SECTIONS}
    >
      <div className="mb-8 space-y-1 text-fg-muted">
        <p>
          This policy covers the app QRCraftly: QR Code Studio. For the QRCraftly website, see{' '}
          <a href="/security#privacy" className={LINK_CLASSES}>Security &amp; Privacy</a>.
        </p>
        <p>
          Effective date: <time dateTime={EFFECTIVE_DATE}>{EFFECTIVE_DATE_TEXT}</time>
        </p>
        <p>
          <em>Last updated: <time dateTime={EFFECTIVE_DATE}>{EFFECTIVE_DATE_TEXT}</time></em>
        </p>
      </div>

      <section id="information" aria-labelledby="information-title" className={SECTION_CLASSES}>
        <ArticleHeading id="information"><span id="information-title">What QRCraftly does with your information</span></ArticleHeading>
        <ul className="list-disc space-y-3 pl-6">
          <li>
            Codes you create, codes you scan and files you send or receive are processed only on your device and are
            never sent to us or anyone else. They are gone when you close the app, unless you save or share them yourself.
          </li>
          <li>
            The app remembers your last-used look (pattern, colors and error correction) and which tips you&apos;ve seen, on
            your device only.
          </li>
          <li>
            QRCraftly makes no network connections. It has no accounts, advertising, analytics, tracking or crash
            reporting.
          </li>
        </ul>
      </section>

      <section id="permissions" aria-labelledby="permissions-title" className={SECTION_CLASSES}>
        <ArticleHeading id="permissions"><span id="permissions-title">Permissions</span></ArticleHeading>
        <ul className="list-disc space-y-3 pl-6">
          <li>
            <strong className="text-fg">Camera:</strong> to scan codes, receive a transfer or check a printed code, only
            when you start those features. Camera frames are read on your device and never recorded or saved.
          </li>
          <li>
            <strong className="text-fg">Photos:</strong> only to add images you choose to save. To scan a photo you pick
            it in the system picker; QRCraftly can&apos;t see the rest of your library.
          </li>
          <li>
            <strong className="text-fg">Location:</strong> only when you tap Use My Location to fill a Location code. It
            isn&apos;t stored or sent.
          </li>
          <li>
            <strong className="text-fg">Contacts and Calendar:</strong> the system&apos;s own screens add a contact or
            event you scanned; QRCraftly doesn&apos;t read your contacts or calendars.
          </li>
        </ul>
      </section>

      <section id="children" aria-labelledby="children-title" className={SECTION_CLASSES}>
        <ArticleHeading id="children"><span id="children-title">Children</span></ArticleHeading>
        <p>QRCraftly collects no data from anyone, including children.</p>
      </section>

      <section id="changes" aria-labelledby="changes-title" className={SECTION_CLASSES}>
        <ArticleHeading id="changes"><span id="changes-title">Changes</span></ArticleHeading>
        <p>If this policy ever changes, the new version will be posted here with its date.</p>
      </section>

      <section id="contact" aria-labelledby="contact-title" className={SECTION_CLASSES}>
        <ArticleHeading id="contact"><span id="contact-title">Contact</span></ArticleHeading>
        <p>
          See the <a href="/support" className={LINK_CLASSES}>support page</a>.
        </p>
      </section>
    </ArticleLayout>
  );
}
