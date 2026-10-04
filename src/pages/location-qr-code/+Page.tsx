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

import { QRTypePage } from '@/components/QRTypePage';
import { QRType } from '@/types';
import { contentRegistry } from '@/data/contentRegistry';
import { copy } from '@/data/copy/location-qr-code';
import { generateSchema } from '@/utils/schemaGenerator';
import { resolveDomainForPath } from '@/utils/metadataEngine';
import { usePageContext } from 'vike-react/usePageContext';

/**
 * Location QR Code Page Component
 */
export default function Page() {
  const pageContext = usePageContext();
  const urlPathname = pageContext?.urlPathname ?? '/location-qr-code';
  const resolvedDomain = resolveDomainForPath(urlPathname);
  const schemaData = generateSchema({ ...contentRegistry['location-qr-code'], ...copy }, resolvedDomain, urlPathname);

  return <QRTypePage type={QRType.LOCATION} title="Location QR Code" schemaData={schemaData} toolId="location-qr-code" copy={copy} />;
}
