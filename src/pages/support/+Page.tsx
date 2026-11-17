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

import { useEffect, useState } from 'react';
import { ArticleHeading, ArticleLayout, type ArticleSection } from '@/components/ArticleLayout';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/SegmentedControl';
import { CONTACT_ADDRESS } from '@/data/contact';

export type SupportTab = 'web' | 'native';

const TAB_OPTIONS: readonly SegmentedOption<SupportTab>[] = [
  { value: 'web', label: 'Web Application' },
  { value: 'native', label: 'iPhone, iPad & Mac App' },
];

const WEB_SECTIONS: readonly ArticleSection[] = [
  { id: 'camera-permissions', label: 'Camera & browser permissions' },
  { id: 'worker-stalls', label: 'QR generation & Web Worker recovery' },
  { id: 'canvas-security', label: 'Canvas security & logo export' },
  { id: 'scannability-fixes', label: 'Scannability warnings & fixes' },
  { id: 'privacy', label: 'Is my data private?' },
  { id: 'contact', label: 'Contact us' },
];

const NATIVE_SECTIONS: readonly ArticleSection[] = [
  { id: 'wont-scan', label: "A code won't scan" },
  { id: 'camera', label: "The camera doesn't start" },
  { id: 'camera-transfer', label: 'Camera Transfer is slow or stops' },
  { id: 'privacy', label: 'Is my data private?' },
  { id: 'contact', label: 'Contact us' },
];

const NATIVE_HASHES = new Set(['#wont-scan', '#camera', '#camera-transfer', '#ios', '#native', '#app']);
const WEB_HASHES = new Set(['#camera-permissions', '#worker-stalls', '#canvas-security', '#scannability-fixes', '#web']);

const LINK_CLASSES = 'font-medium text-accent underline underline-offset-2';
const SECTION_CLASSES = 'mb-10 scroll-mt-6 space-y-3 text-fg-soft';
const LIST_CLASSES = 'list-disc pl-5 space-y-2 text-fg-soft';

/**
 * Troubleshooting manual for the QRCraftly web application with categorized self-service
 * guides, alongside support documentation for the native iPhone, iPad, and Mac application.
 * @returns The troubleshooting manual page.
 */
export default function Page() {
  const [tab, setTab] = useState<SupportTab>(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.toLowerCase();
      if (NATIVE_HASHES.has(hash)) return 'native';
    }
    return 'web';
  });

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.toLowerCase();
      if (NATIVE_HASHES.has(hash)) {
        setTab('native');
      } else if (WEB_HASHES.has(hash)) {
        setTab('web');
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const sections = tab === 'web' ? WEB_SECTIONS : NATIVE_SECTIONS;

  return (
    <ArticleLayout
      pageId="support"
      title="QRCraftly Web Troubleshooting Manual"
      lead="Self-service troubleshooting guides for the QRCraftly web application and native iOS app."
      sections={sections}
    >
      <noscript>
        <style>{`
          [role="tabpanel"][hidden] {
            display: block !important;
          }
          .no-js-hide {
            display: none !important;
          }
        `}</style>
      </noscript>

      <div className="no-js-hide mb-8">
        <SegmentedControl<SupportTab>
          kind="tablist"
          label="Support documentation view"
          options={TAB_OPTIONS}
          value={tab}
          onChange={setTab}
          tabId={(v) => `${v}-tab`}
          controls={(v) => `${v}-panel`}
        />
      </div>

      <div id="web-panel" role="tabpanel" aria-labelledby="web-tab" hidden={tab !== 'web'}>
        <section id="camera-permissions" aria-labelledby="camera-permissions-title" className={SECTION_CLASSES}>
          <ArticleHeading id="camera-permissions">
            <span id="camera-permissions-title">Camera &amp; browser permissions</span>
          </ArticleHeading>
          <p>
            The QR scanner requests camera permissions only after you select Start camera or launch camera transfer,
            never when the page first loads. If you prefer not to grant camera access, you can always scan without
            permissions by choosing a photo, dragging an image onto the scanner, or pasting a screenshot from your
            clipboard.
          </p>
          <p>If your browser blocks camera access or cannot start the viewfinder, follow these resolution steps:</p>
          <ul className={LIST_CLASSES}>
            <li>
              <strong>Google Chrome, Brave, and Microsoft Edge:</strong> Click the site settings icon (tune or padlock)
              next to the URL in the address bar. Set <strong>Camera</strong> to <strong>Allow</strong> (or choose Reset
              permission), then reload the page.
            </li>
            <li>
              <strong>Apple Safari (macOS):</strong> Open <strong>Safari &gt; Settings &gt; Websites &gt; Camera</strong>,
              locate this site, and select <strong>Allow</strong>. Also check <strong>macOS System Settings &gt; Privacy
              &amp; Security &gt; Camera</strong> to verify Safari has permission to access your webcam.
            </li>
            <li>
              <strong>Apple Safari (iOS &amp; iPadOS):</strong> Open iOS <strong>Settings &gt; Safari &gt; Camera</strong> and
              select <strong>Allow</strong>. Within Safari, tap the <strong>aA</strong> icon in the address bar, select{' '}
              <strong>Website Settings</strong>, and ensure Camera is set to Allow.
            </li>
            <li>
              <strong>Mozilla Firefox:</strong> Click the crossed-out camera or permission badge on the left side of the
              address bar, clear the blocked camera permission, and reload. Alternatively, manage permissions under{' '}
              <strong>Settings &gt; Privacy &amp; Security &gt; Permissions &gt; Camera &gt; Settings</strong>.
            </li>
            <li>
              <strong>Operating system camera privacy:</strong> On Windows, open <strong>Settings &gt; Privacy &amp;
              Security &gt; Camera</strong> and enable &quot;Let apps access your camera&quot; and your browser. On Android, open{' '}
              <strong>Settings &gt; Apps &gt; [Browser Name] &gt; Permissions &gt; Camera</strong> and set to Allow.
            </li>
          </ul>
        </section>

        <section id="worker-stalls" aria-labelledby="worker-stalls-title" className={SECTION_CLASSES}>
          <ArticleHeading id="worker-stalls">
            <span id="worker-stalls-title">QR generation &amp; Web Worker recovery</span>
          </ArticleHeading>
          <p>
            QRCraftly performs intensive QR matrix calculations, layout formatting, and scannability simulations inside
            background Web Workers off the main thread. This off-thread architecture ensures typing, live preview updates,
            and interface controls remain responsive without UI jank.
          </p>
          <p>
            Occasionally, background workers may fail to load or stall, such as when a browser tab retains cached assets
            from an older release after a site deployment or when strict memory quotas terminate worker threads. When an
            error occurs, QRCraftly automatically intercepts the failure and falls back to computing the QR matrix
            synchronously on the main thread so you can continue editing without interruption.
          </p>
          <p>If QR generation or preview rendering appears stalled:</p>
          <ul className={LIST_CLASSES}>
            <li>
              <strong>Perform a hard reload:</strong> Press <kbd className="font-mono text-xs">Ctrl + F5</kbd> (Windows/Linux)
              or <kbd className="font-mono text-xs">Cmd + Shift + R</kbd> (macOS) to bypass the browser cache and load the latest
              worker bundle.
            </li>
            <li>
              <strong>Review browser extensions:</strong> Strict privacy extensions, ad blockers, or script manipulators
              can block Blob URLs or background worker execution. Temporarily allowlist the application to test.
            </li>
            <li>
              <strong>Trim payload size:</strong> Encoding exceptionally large text payloads or long URLs increases matrix
              density and calculation time. Use concise URLs or shortened text where feasible.
            </li>
          </ul>
        </section>

        <section id="canvas-security" aria-labelledby="canvas-security-title" className={SECTION_CLASSES}>
          <ArticleHeading id="canvas-security">
            <span id="canvas-security-title">Canvas security &amp; logo export</span>
          </ArticleHeading>
          <p>
            When downloading raster formats (PNG, JPEG, WEBP) or copying QR codes to your clipboard, the graphic is drawn onto
            an HTML5 canvas and serialized to data. Under standard browser canvas security rules, loading an external logo image
            hosted on a different domain without Cross-Origin Resource Sharing (CORS) headers causes the canvas to become
            tainted.
          </p>
          <p>
            Once tainted, the browser forbids reading pixel data via <code>toDataURL()</code> or <code>toBlob()</code>, throwing
            a <code>SecurityError: The operation is insecure</code> to prevent unauthorized cross-domain data reading.
          </p>
          <p>To resolve canvas export errors and avoid logo tainting:</p>
          <ul className={LIST_CLASSES}>
            <li>
              <strong>Upload directly from your device:</strong> Use the logo file picker or drag and drop an image file
              directly from your local drive. Local files are converted into safe data URIs and will never taint the canvas.
            </li>
            <li>
              <strong>Ensure CORS headers on remote servers:</strong> If referencing an external image URL, the remote server
              must return the <code>Access-Control-Allow-Origin: *</code> header.
            </li>
            <li>
              <strong>Export as SVG:</strong> Vector SVG downloads generate clean XML code without reading canvas pixel data,
              bypassing canvas security restrictions entirely.
            </li>
            <li>
              <strong>Check image integrity:</strong> Verify that the uploaded logo file is a valid, uncorrupted PNG, SVG,
              WEBP, or JPEG file.
            </li>
          </ul>
        </section>

        <section id="scannability-fixes" aria-labelledby="scannability-fixes-title" className={SECTION_CLASSES}>
          <ArticleHeading id="scannability-fixes">
            <span id="scannability-fixes-title">Scannability warnings &amp; fixes</span>
          </ArticleHeading>
          <p>
            The live Scannability Indicator under the preview card evaluates your QR design against simulated optical camera
            conditions and reports one of three verdicts: <strong>Scans reliably</strong>, <strong>Scans, but fragile</strong>,
            or <strong>Won&apos;t scan reliably</strong>.
          </p>
          <p>If your code triggers a warning or fails scannability checks, apply these adjustments:</p>
          <ul className={LIST_CLASSES}>
            <li>
              <strong>Increase contrast (Use black on white):</strong> Smartphone camera sensors require a high luminance
              contrast ratio (at least 4:1) between dark foreground modules and the light background. Avoid faint pastel colors,
              low-contrast color pairs, or inverted light-on-dark schemes unless thoroughly tested across multiple devices.
            </li>
            <li>
              <strong>Shrink the logo:</strong> Center logos obscure data modules. Ensure the logo occupies no more than 20%
              to 25% of the total QR code surface area so enough redundant data modules remain visible for scanning.
            </li>
            <li>
              <strong>Raise error correction (Use high error correction):</strong> When adding a logo or preparing codes for
              printed surfaces exposed to physical wear, set error correction to <strong>Level Q (25%)</strong> or{' '}
              <strong>Level H (30%)</strong>. High error correction restores up to 30% of lost or obstructed code data.
            </li>
            <li>
              <strong>Use standard pattern:</strong> Stylized modules (such as delicate dots or fluid waves) can reduce camera
              readability under dim lighting. Reverting to the classic square module pattern maximizes scan reliability on all
              hardware.
            </li>
          </ul>
        </section>
      </div>

      <div id="native-panel" role="tabpanel" aria-labelledby="native-tab" hidden={tab !== 'native'}>
        <section id="wont-scan" aria-labelledby="wont-scan-title" className={SECTION_CLASSES}>
          <ArticleHeading id="wont-scan">
            <span id="wont-scan-title">A code won&apos;t scan</span>
          </ArticleHeading>
          <p>
            Check the reliability grade under the code. Tap it to see each check and its fix: raise the contrast, shrink
            the logo, switch to a simpler pattern or raise error correction. For print, use Export &gt; PDF or a large PNG,
            and test a printed sample.
          </p>
        </section>

        <section id="camera" aria-labelledby="camera-title" className={SECTION_CLASSES}>
          <ArticleHeading id="camera">
            <span id="camera-title">The camera doesn&apos;t start</span>
          </ArticleHeading>
          <p>
            Allow camera access in Settings &gt; Privacy &amp; Security &gt; Camera &gt; QRCraftly. You can always scan a
            photo with Choose Photo or Video instead.
          </p>
        </section>

        <section id="camera-transfer" aria-labelledby="camera-transfer-title" className={SECTION_CLASSES}>
          <ArticleHeading id="camera-transfer">
            <span id="camera-transfer-title">Camera Transfer is slow or stops</span>
          </ArticleHeading>
          <p>
            Hold both screens steady in even light with little glare, turn the sending screen&apos;s brightness up, and
            try the Steady speed. Reduced Flashing is slower by design.
          </p>
        </section>
      </div>

      <section id="privacy" aria-labelledby="privacy-title" className={SECTION_CLASSES}>
        <ArticleHeading id="privacy">
          <span id="privacy-title">Is my data private?</span>
        </ArticleHeading>
        <p>
          Yes. Everything happens on your device; QRCraftly has no servers, accounts or tracking. See the{' '}
          <a href="/privacy" className={LINK_CLASSES}>
            privacy policy
          </a>.
        </p>
      </section>

      <section id="contact" aria-labelledby="contact-title" className={SECTION_CLASSES}>
        <ArticleHeading id="contact">
          <span id="contact-title">Contact us</span>
        </ArticleHeading>
        <p>
          Email{' '}
          <a href="mailto:fpderuiter+qrcraftly@gmail.com" className={LINK_CLASSES}>
            {CONTACT_ADDRESS}
          </a>.
        </p>
      </section>
    </ArticleLayout>
  );
}
