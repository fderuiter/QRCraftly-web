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

import { QRTypePage } from '@/components/QRTypePage';
import { QRType } from '@/types';
import { contentRegistry } from '@/data/contentRegistry';
import { copy } from '@/data/copy/bulk-csv-qr-code';
import { generateSchema } from '@/utils/schemaGenerator';
import { resolveDomainForPath } from '@/utils/metadataEngine';
import { usePageContext } from 'vike-react/usePageContext';

/**
 * Bulk CSV Batch QR Code Page Component
 */
export default function Page() {
  const pageContext = usePageContext();
  const urlPathname = pageContext?.urlPathname ?? '/bulk-csv-qr-code';
  const resolvedDomain = resolveDomainForPath(urlPathname);
  const schemaData = generateSchema({ ...contentRegistry['bulk-csv-qr-code'], ...copy }, resolvedDomain, urlPathname);

  return <QRTypePage type={QRType.BULK_CSV} title="Bulk CSV Batch QR Code" schemaData={schemaData} toolId="bulk-csv-qr-code" copy={copy} />;
}
