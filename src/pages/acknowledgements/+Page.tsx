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

import type { ReactNode } from 'react';
import shippedPackages, { licensesFile } from 'virtual:shipped-packages';
import { ArticleHeading, ArticleLayout, type ArticleSection } from '@/components/ArticleLayout';
import { isDangerousUrl } from '@/packages/core/security';

const SECTIONS: readonly ArticleSection[] = [
  { id: 'packages', label: 'What ships to your browser' },
  { id: 'license-texts', label: 'License texts' },
  { id: 'not-shipped', label: 'Tools that stay behind' },
];

const LINK_CLASSES = 'font-medium text-accent underline-offset-2 hover:underline';

/**
 * A link to a URL that comes from build data, or plain text when the URL is missing or unsafe.
 * @param props - Link properties.
 * @param props.href - Destination.
 * @param props.external - Whether to open in a new tab.
 * @param props.children - Link text.
 * @returns The link, or its text alone.
 */
function DataLink({ href, external = false, children }: { href?: string; external?: boolean; children: ReactNode }) {
  if (href === undefined) return <>{children}</>;
  if (!isDangerousUrl(href)) {
    return external ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASSES}>{children}</a>
    ) : (
      <a href={href} className={LINK_CLASSES}>{children}</a>
    );
  }
  return <>{children}</>;
}

/**
 * Open-source acknowledgements: every third-party package whose code ships to the browser, with
 * its version and license, and a link to the full license texts. The list comes from the build
 * (see `scripts/vite/thirdPartyLicenses.ts`), which fails if it ever disagrees with the bundle.
 * @returns The acknowledgements page.
 */
export default function Page() {
  return (
    <ArticleLayout
      pageId="acknowledgements"
      title="Open-source acknowledgements"
      lead={`QRCraftly is built on open-source software. These are the ${shippedPackages.length} third-party packages whose code your browser downloads when you use the site, with their licenses.`}
      sections={SECTIONS}
    >
      <section id="packages" aria-labelledby="packages-title" className="mb-10 scroll-mt-6 text-fg-soft">
        <ArticleHeading id="packages"><span id="packages-title">What ships to your browser</span></ArticleHeading>
        <div className="mb-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Third-party packages in the QRCraftly site, with version and license</caption>
            <thead className="bg-surface text-fg">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Package</th>
                <th scope="col" className="px-4 py-2 font-semibold">Version</th>
                <th scope="col" className="px-4 py-2 font-semibold">License</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {shippedPackages.map((pkg) => (
                <tr key={pkg.name}>
                  <th scope="row" className="px-4 py-2 font-normal break-all">
                    <DataLink href={pkg.url} external>{pkg.name}</DataLink>
                    {pkg.bundledIn && <span className="block text-xs break-normal text-fg-muted">Included in the build output of {pkg.bundledIn}.</span>}
                    {pkg.note && <span className="block text-xs break-normal text-fg-muted">{pkg.note}</span>}
                  </th>
                  <td className="px-4 py-2 font-mono text-xs whitespace-nowrap">{pkg.version}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{pkg.license}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-fg-muted">
          This list is generated when the site is built. The build fails if a package reaches your browser without
          being listed here, so the list cannot fall behind the code you download.
        </p>
      </section>

      <section id="license-texts" aria-labelledby="license-texts-title" className="mb-10 scroll-mt-6 text-fg-soft">
        <ArticleHeading id="license-texts"><span id="license-texts-title">License texts</span></ArticleHeading>
        <p>
          The full text of each license, with its copyright notice and any NOTICE file, is in{' '}
          <DataLink href={licensesFile}>third-party-licenses.txt</DataLink>, generated from the same build.
        </p>
      </section>

      <section id="not-shipped" aria-labelledby="not-shipped-title" className="mb-10 scroll-mt-6 space-y-3 text-fg-soft">
        <ArticleHeading id="not-shipped"><span id="not-shipped-title">Tools that stay behind</span></ArticleHeading>
        <p>
          Tools that build, test and check QRCraftly, such as TypeScript, Vitest, Playwright and ESLint, run only on
          developer machines and in continuous integration. None of their code is sent to your browser.
        </p>
        <p>
          QRCraftly&apos;s own code is not open source. The code published up to October 2026 was released under the
          GNU AGPL v3.0.{' '}
          <a href="/about#how-its-built" className={LINK_CLASSES}>How QRCraftly is built</a>
        </p>
      </section>
    </ArticleLayout>
  );
}
