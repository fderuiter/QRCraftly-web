/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { QRSizeCalculator } from '@/components/QRSizeCalculator';
import { SidebarContent } from '@/components/SidebarContent';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import { usePageContent } from '@/data/PageContentContext';
import type { ToolCopy } from '@/data/copy/types';

const LINK_CLASSES = 'font-medium text-accent underline-offset-2 hover:underline';

/** Copy used before the page's content is available. */
const NO_COPY: ToolCopy = {};

/**
 * QR code size calculator (/qr-code-size-calculator): how wide to print a code so phones scan it
 * from a chosen distance, measured from the real code the content makes.
 * @returns The page.
 */
export default function Page() {
  const page = usePageContent();
  const copy = page?.landing ?? NO_COPY;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-2 text-3xl font-bold text-fg sm:text-4xl">{page?.tool?.heading}</h1>
      <p className="mb-6 text-fg-soft">
        Print a QR code about one tenth as wide as the distance it will be scanned from: 10 cm (4 in) for a phone 1 m (3.3 ft) away. Paste
        your content below for the exact size, since longer content makes a denser code that needs more room.
      </p>

      <QRSizeCalculator />

      <PageCopyContext.Provider value={copy}>
        <SidebarContent toolId="qr-code-size-calculator" />
      </PageCopyContext.Provider>

      <nav aria-labelledby="related-title" className="mt-10">
        <h2 id="related-title" className="mb-3 text-2xl font-bold text-fg">
          Related tools
        </h2>
        <ul className="space-y-2">
          <li>
            <a href="/" className={LINK_CLASSES}>
              Make your QR code
            </a>
          </li>
          <li>
            <a href="/svg-qr-code" className={LINK_CLASSES}>
              Download it as a vector file for print
            </a>
          </li>
          <li>
            <a href="/qr-code-checker" className={LINK_CLASSES}>
              Check a printed proof
            </a>
          </li>
        </ul>
      </nav>
    </div>
  );
}
