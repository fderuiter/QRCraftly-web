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

/** Where to reach us about the app. A placeholder until the address is chosen. */
const CONTACT = 'YOUR_EMAIL';

const SECTIONS: readonly ArticleSection[] = [
  { id: 'wont-scan', label: "A code won't scan" },
  { id: 'camera', label: "The camera doesn't start" },
  { id: 'camera-transfer', label: 'Camera Transfer is slow or stops' },
  { id: 'privacy', label: 'Is my data private?' },
  { id: 'contact', label: 'Contact us' },
];

const LINK_CLASSES = 'font-medium text-accent underline underline-offset-2';
const SECTION_CLASSES = 'mb-10 scroll-mt-6 space-y-3 text-fg-soft';

/**
 * Support page for the native app "QRCraftly: QR Code Studio" on iPhone, iPad and Mac. The App
 * Store listing links here. The text is the app repository's `AppStore/pages/support.md`.
 * @returns The app support page.
 */
export default function Page() {
  return (
    <ArticleLayout
      title="QRCraftly for iPhone, iPad and Mac: Support"
      lead="Help with the app QRCraftly: QR Code Studio."
      sections={SECTIONS}
    >
      <section id="wont-scan" aria-labelledby="wont-scan-title" className={SECTION_CLASSES}>
        <ArticleHeading id="wont-scan"><span id="wont-scan-title">A code won&apos;t scan</span></ArticleHeading>
        <p>
          Check the reliability grade under the code. Tap it to see each check and its fix: raise the contrast, shrink
          the logo, switch to a simpler pattern or raise error correction. For print, use Export &gt; PDF or a large PNG,
          and test a printed sample.
        </p>
      </section>

      <section id="camera" aria-labelledby="camera-title" className={SECTION_CLASSES}>
        <ArticleHeading id="camera"><span id="camera-title">The camera doesn&apos;t start</span></ArticleHeading>
        <p>
          Allow camera access in Settings &gt; Privacy &amp; Security &gt; Camera &gt; QRCraftly. You can always scan a
          photo with Choose Photo or Video instead.
        </p>
      </section>

      <section id="camera-transfer" aria-labelledby="camera-transfer-title" className={SECTION_CLASSES}>
        <ArticleHeading id="camera-transfer"><span id="camera-transfer-title">Camera Transfer is slow or stops</span></ArticleHeading>
        <p>
          Hold both screens steady in even light with little glare, turn the sending screen&apos;s brightness up, and
          try the Steady speed. Reduced Flashing is slower by design.
        </p>
      </section>

      <section id="privacy" aria-labelledby="privacy-title" className={SECTION_CLASSES}>
        <ArticleHeading id="privacy"><span id="privacy-title">Is my data private?</span></ArticleHeading>
        <p>
          Yes. Everything happens on your device; QRCraftly has no servers, accounts or tracking. See the{' '}
          <a href="/privacy" className={LINK_CLASSES}>privacy policy</a>.
        </p>
      </section>

      <section id="contact" aria-labelledby="contact-title" className={SECTION_CLASSES}>
        <ArticleHeading id="contact"><span id="contact-title">Contact us</span></ArticleHeading>
        <p>{CONTACT}</p>
      </section>
    </ArticleLayout>
  );
}
