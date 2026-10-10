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

import { describe, expect, it } from 'vitest';
import { buildPageContent, getPageSchema } from './pageContent';
import { contentRegistry, getMetadataForPath } from './contentRegistry';
import { guides } from './guides';
import { landingPageContent } from './landingPageContent';
import { LANDING_PAGE_IDS } from './landingPages';
import { TYPE_PAGE_TYPES } from './relatedPages';
import { getGuideFaqs, guideFaqAnswer } from './guideFaqs';
import { typeGuides } from './typeGuides';
import { generateGuideSchema, generateSchema } from '../utils/schemaGenerator';
import { resolveDomainForPath } from '../utils/metadataEngine';
import { pageCopy } from '../../tests/utils/pageCopy';

const pathOf = (id: string) => (id === 'index' ? '/' : `/${id}`);

/** The FAQ entries a page's guide adds to its structured data, in page order. */
const guideFaqs = (id: string) =>
  typeGuides[id] ? getGuideFaqs(typeGuides[id]).map((faq) => ({ question: faq.question, answer: guideFaqAnswer(faq) })) : [];

describe('getPageSchema (#1058)', () => {
  const ownCopyIds = [...Object.keys(TYPE_PAGE_TYPES), 'qr-code-scanner', 'about', 'arcade', 'file-transfer', 'free-forever', 'security'];

  it.each(ownCopyIds)('builds the same schema %s rendered in the browser before', (id) => {
    const path = pathOf(id);
    const copy = pageCopy(id);
    const faqs = [...(copy.faqs ?? []), ...guideFaqs(id)];
    expect(getPageSchema(path)).toEqual(generateSchema({ ...contentRegistry[id], ...copy, faqs: faqs.length > 0 ? faqs : copy.faqs }, resolveDomainForPath(path), path));
  });

  it.each([...LANDING_PAGE_IDS])('builds the landing schema of %s from its how-to and FAQs', (id) => {
    const path = pathOf(id);
    const { howTo, faqs } = landingPageContent[id];
    expect(getPageSchema(path)).toEqual(generateSchema({ ...contentRegistry[id], howTo, faqs: [...faqs, ...guideFaqs(id)] }, resolveDomainForPath(path), path));
  });

  it.each(guides.map((guide) => guide.slug))('builds the article schema of the %s guide', (slug) => {
    const path = `/guides/${slug}`;
    const guide = guides.find((entry) => entry.slug === slug)!;
    expect(getPageSchema(path)).toEqual(generateGuideSchema(guide, resolveDomainForPath(path)));
  });

  it('builds the guide index schema', () => {
    expect(JSON.stringify(getPageSchema('/guides'))).toContain('CollectionPage');
  });

  it.each(['/privacy', '/support', '/acknowledgements', '/file-transfer/receive', '/no-such-page'])('has none for %s', (path) => {
    expect(getPageSchema(path)).toBeUndefined();
  });
});

describe('buildPageContent (#1058)', () => {
  it('gives a generator page its own entry, guide, example and related pages only', () => {
    const content = buildPageContent({ urlPathname: '/wifi-qr-code/' });
    expect(content.id).toBe('wifi-qr-code');
    expect(content.title).toBe(getMetadataForPath('/wifi-qr-code').title);
    expect(content.tool).toBe(contentRegistry['wifi-qr-code']);
    expect(content.guide).toBe(typeGuides['wifi-qr-code']);
    expect(content.example?.src).toBe('/examples/wifi-qr-code.svg');
    expect(content.related.map((page) => page.id)).not.toContain('wifi-qr-code');
    expect(content.landing).toBeUndefined();
    expect(content.gallery).toBeUndefined();
    // Only this page's text: other pages' copy stays out of its HTML.
    expect(JSON.stringify(content)).not.toContain(contentRegistry['vcard-qr-code'].description);
  });

  it('gives a landing page its copy and gallery', () => {
    const content = buildPageContent({ urlPathname: '/mosaic-qr-code' });
    expect(content.landing).toBe(landingPageContent['mosaic-qr-code']);
    expect(content.gallery?.length).toBeGreaterThan(0);
  });

  it('titles the 404 page from the error entry', () => {
    expect(buildPageContent({ urlPathname: '/missing', is404: true }).title).toBe(getMetadataForPath('/_error').title);
  });
});
