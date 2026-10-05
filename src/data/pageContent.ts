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

/**
 * Per-page content, built at prerender time (#1058).
 *
 * The content registry, the type guides and the landing copy describe every page. Shipping them
 * to the browser made each page download every other page's text. The global `+data` hook calls
 * {@link buildPageContent} on the server instead, so a page's HTML carries only its own entry,
 * and the page's structured data is rendered by the server-only Head ({@link getPageSchema}).
 * Client code imports only the types from this module.
 */

import {
  auxiliaryRegistry,
  contentRegistry,
  getMetadataForPageContext,
  getRegistryKeyForPath,
  type MetadataPageContext,
  type ToolContent,
} from './contentRegistry';
import type { ToolCopy } from './copy/types';
import { getGuide } from './guides';
import { LANDING_GALLERIES, LANDING_PAGE_IDS, type LandingGalleryImage } from './landingPages';
import { landingPageContent, type LandingCopy } from './landingPageContent';
import { getExampleImage, getRelatedTypePages, TYPE_PAGE_TYPES, type RelatedPage } from './relatedPages';
import { typeGuides, type TypeGuide } from './typeGuides';
import { generateGuideIndexSchema, generateGuideSchema, generateSchema } from '../utils/schemaGenerator';
import { resolveDomainForPath, type JsonLdObject } from '../utils/metadataEngine';

/** Everything a page renders from the shared content modules, for that page alone. */
export interface PageContent {
  /** Registry key of the page (`index` for `/`). */
  id: string;
  /** The document title. */
  title: string;
  /** The page's content registry entry, when it has one. */
  tool?: ToolContent;
  /** Long-form sections of a generator page. */
  guide?: TypeGuide;
  /** How-to steps and FAQs of a landing page or the checker. */
  landing?: LandingCopy;
  /** Example picture of a type page. */
  example?: { src: string; alt: string };
  /** Example pictures of a landing page. */
  gallery?: readonly LandingGalleryImage[];
  /** Sibling generator pages to link to. */
  related: RelatedPage[];
}

/** The how-to steps and FAQs of each page that has its own copy module, by registry key. */
const pageCopy: Record<string, ToolCopy> = Object.fromEntries(
  Object.entries(import.meta.glob<{ copy?: ToolCopy }>(['./copy/*.ts', '!./copy/*.test.ts'], { eager: true }))
    .flatMap(([file, module]) => (module.copy ? [[file.slice('./copy/'.length, -'.ts'.length), module.copy]] : [])),
);

/** Registry pages that describe themselves with an application schema. */
const SCHEMA_PAGE_IDS: ReadonlySet<string> = new Set([
  ...Object.keys(TYPE_PAGE_TYPES),
  ...LANDING_PAGE_IDS,
  'qr-code-scanner',
  'about',
  'arcade',
  'file-transfer',
  'free-forever',
  'security',
]);

/**
 * Builds the content one page renders.
 * @param pageContext - The page's path, plus its 404 state for the title.
 * @returns The page's own content.
 */
export function buildPageContent(pageContext: MetadataPageContext): PageContent {
  const id = getRegistryKeyForPath(pageContext.urlPathname);
  const content: PageContent = {
    id,
    title: getMetadataForPageContext(pageContext).title,
    related: getRelatedTypePages(id),
  };
  const tool = contentRegistry[id];
  const guide = typeGuides[id];
  const landing = landingPageContent[id];
  const example = getExampleImage(id);
  const gallery = LANDING_GALLERIES[id];
  if (tool) content.tool = tool;
  if (guide) content.guide = guide;
  if (landing) content.landing = landing;
  if (example) content.example = example;
  if (gallery) content.gallery = gallery;
  return content;
}

/**
 * Builds a page's own structured data (the site-wide graph is built by Head).
 * @param urlPathname - The page's path.
 * @returns The JSON-LD object, or undefined for pages without one.
 */
export function getPageSchema(urlPathname: string): JsonLdObject | undefined {
  const id = getRegistryKeyForPath(urlPathname);
  const domain = resolveDomainForPath(urlPathname);
  if (id === 'guides') return generateGuideIndexSchema(auxiliaryRegistry.guides.description, domain);
  if (id.startsWith('guides/')) {
    const guide = getGuide(id.slice('guides/'.length));
    return guide ? generateGuideSchema(guide, domain) : undefined;
  }
  const tool = contentRegistry[id];
  if (!tool || !SCHEMA_PAGE_IDS.has(id)) return undefined;
  const landing = landingPageContent[id];
  const copy: ToolCopy = pageCopy[id] ?? (landing ? { howTo: landing.howTo, faqs: landing.faqs } : {});
  return generateSchema({ ...tool, ...copy }, domain, urlPathname);
}
