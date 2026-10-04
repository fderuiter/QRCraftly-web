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

import { QRTypePage } from '@/components/QRTypePage';
import { contentRegistry } from '@/data/contentRegistry';
import { LANDING_PRESETS } from '@/data/landingPages';
import { landingPageContent } from '@/data/landingPageContent';
import { generateSchema } from '@/utils/schemaGenerator';
import { resolveDomainForPath } from '@/utils/metadataEngine';
import { usePageContext } from 'vike-react/usePageContext';

/**
 * A landing page that opens the generator with presets for one job (#1035, #1037), such as the
 * logo panel open with high error correction. Its copy, share image and schema come from the
 * page's registry entry.
 * @param props - The component props.
 * @param props.id - Registry id and route of the page (a key of `LANDING_PRESETS`).
 * @returns The generator page.
 */
export function LandingPage({ id }: { id: string }) {
  const pageContext = usePageContext();
  const urlPathname = pageContext?.urlPathname ?? `/${id}`;
  const preset = LANDING_PRESETS[id];
  const copy = landingPageContent[id];
  const schemaData = generateSchema({ ...contentRegistry[id], howTo: copy.howTo, faqs: copy.faqs }, resolveDomainForPath(urlPathname), urlPathname);

  return (
    <QRTypePage
      type={preset.type}
      title={preset.title}
      schemaData={schemaData}
      toolId={id}
      copy={copy}
      presetConfig={preset.presetConfig}
      openSections={preset.openSections}
    />
  );
}
