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

import type { ReactNode } from 'react';
import { isDangerousUrl } from '@/packages/core/security';
import { usePageContent } from '@/data/PageContentContext';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import type { ToolCopy } from '@/data/copy/types';
import { PrivacyPromiseGrid, type PrivacyPromiseItem } from '@/components/ui/PrivacyPromiseGrid';
import { SidebarContent } from '@/components/SidebarContent';

const NO_COPY: ToolCopy = {};
const RELATED_LINK_CLASSES = 'font-medium text-accent underline-offset-2 hover:underline';

/** A navigation link displayed in the related tools section. */
export interface ScannerRelatedLink {
  href: string;
  label: string;
}

/** Props for {@link ScannerPageLayout}. */
export interface ScannerPageLayoutProps {
  /** The content registry tool identifier. */
  toolId: string;
  /** Optional heading override. When omitted, uses `page.tool.heading`. */
  heading?: string;
  /** Optional title override alias. */
  title?: string;
  /** Subtitle or introductory description under the page heading. */
  description: string;
  /** Privacy promise items rendered below the primary scanner/checker component. */
  promises: readonly PrivacyPromiseItem[];
  /** Optional copy data. Falls back to `page.landing` or empty copy when omitted. */
  copy?: ToolCopy;
  /** Related tools navigation items. */
  relatedLinks: readonly ScannerRelatedLink[];
  /** Scanner or checker primary component children. */
  children: ReactNode;
}

/**
 * Reusable page layout shell for QR scanning routes (`/qr-code-scanner`, `/qr-code-checker`).
 * Encapsulates the container styling, heading, description, promise grid, copy context provider,
 * and related tools navigation.
 * @param props - Layout component properties.
 * @returns The rendered page layout shell.
 */
export function ScannerPageLayout({
  toolId,
  heading,
  title,
  description,
  promises,
  copy,
  relatedLinks,
  children,
}: ScannerPageLayoutProps) {
  const page = usePageContent();
  const pageHeading = heading ?? title ?? page?.tool?.heading;
  const pageCopy = copy ?? page?.landing ?? NO_COPY;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-2 text-3xl font-bold text-fg sm:text-4xl">{pageHeading}</h1>
      <p className="mb-6 text-fg-soft">{description}</p>

      {children}

      <PrivacyPromiseGrid items={promises} ariaLabel="Privacy" className="mt-6" />

      <PageCopyContext.Provider value={pageCopy}>
        <SidebarContent toolId={toolId} />
      </PageCopyContext.Provider>

      <nav aria-labelledby="related-title" className="mt-10">
        <h2 id="related-title" className="mb-3 text-2xl font-bold text-fg">
          Related tools
        </h2>
        <ul className="space-y-2">
          {relatedLinks.map((link) => {
            if (!isDangerousUrl(link.href)) {
              return (
                <li key={link.href}>
                  <a href={link.href} className={RELATED_LINK_CLASSES}>
                    {link.label}
                  </a>
                </li>
              );
            }
            return null;
          })}
        </ul>
      </nav>
    </div>
  );
}
