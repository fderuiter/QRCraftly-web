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

import React from 'react';
import { usePageContext } from 'vike-react/usePageContext';
import { ArcadeApp } from '@/components/arcade/ArcadeApp';
import { SidebarContent } from '@/components/SidebarContent';
import { JsonLdScript } from '@/components/ui/JsonLdScript';
import { contentRegistry } from '@/data/contentRegistry';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import { copy } from '@/data/copy/arcade';
import { resolveDomainForPath } from '@/utils/metadataEngine';
import { generateSchema } from '@/utils/schemaGenerator';

/**
 * QR Arcade & Durability Lab page (/arcade): the Arcade Blaster and Damage Simulator modes
 * inside the standard product shell, plus structured data and the how-to and FAQ content.
 * @returns The page.
 */
export default function Page() {
  const pageContext = usePageContext();
  const urlPathname = pageContext?.urlPathname ?? '/arcade';
  const schemaData = generateSchema({ ...contentRegistry['arcade'], ...copy }, resolveDomainForPath(urlPathname), urlPathname);

  return (
    <>
      <JsonLdScript data={schemaData} />
      <ArcadeApp />
      <div className="mx-auto max-w-3xl px-4 pb-12">
        <PageCopyContext.Provider value={copy}>
          <SidebarContent toolId="arcade" />
        </PageCopyContext.Provider>
      </div>
    </>
  );
}
