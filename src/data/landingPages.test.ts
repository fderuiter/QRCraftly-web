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
import { contentRegistry } from '@/data/contentRegistry';
import { LANDING_GALLERIES, LANDING_PAGE_IDS, LANDING_PRESETS } from '@/data/landingPages';
import { landingPageContent } from '@/data/landingPageContent';
import { landingPageMeta } from '@/data/landingPageMeta';
import { getRelatedTypePages } from '@/data/relatedPages';
import { typeGuides } from '@/data/typeGuides';
import { USE_CASE_LINKS } from '@/data/navigation';

const wordCount = (text: string) => text.trim().split(/\s+/).length;

describe('landing pages (#1035, #1036, #1037)', () => {
  it('has one registry entry, one copy block and one route per page', () => {
    expect(Object.keys(landingPageContent).sort()).toEqual([...LANDING_PAGE_IDS].sort());
    for (const id of LANDING_PAGE_IDS) {
      expect(contentRegistry[id], id).toBeDefined();
      expect(contentRegistry[id].url).toMatch(new RegExp(`/${id}$`));
      expect(contentRegistry[id].image).toBe(`/og/${id}.png`);
    }
  });

  it('keeps the meta description within 155 characters and the title keyword-led', () => {
    for (const id of LANDING_PAGE_IDS) {
      const { description, seoTitle } = contentRegistry[id];
      expect(description.length, id).toBeLessThanOrEqual(155);
      expect(seoTitle, id).toMatch(/\| QRCraftly$/);
    }
  });

  it('gives every preset page a guide, how-to and FAQ, and a short guide intro', () => {
    for (const id of Object.keys(LANDING_PRESETS)) {
      const guide = typeGuides[id];
      expect(guide, id).toBeDefined();
      expect(wordCount(guide.intro), id).toBeGreaterThanOrEqual(10);
      expect(wordCount(guide.intro), id).toBeLessThanOrEqual(40);
      expect(landingPageContent[id].howTo?.steps.length, id).toBeGreaterThanOrEqual(3);
      expect(landingPageContent[id].faqs?.length, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('never claims AI, and says plainly that files are not hosted', () => {
    expect(landingPageContent['mosaic-qr-code'].faqs[0].answer).toMatch(/^No\./);
    expect(JSON.stringify(landingPageMeta['mosaic-qr-code'].seoTitle)).toMatch(/No AI/);
    expect(landingPageMeta['pdf-qr-code'].description).toMatch(/do not host/);
    expect(landingPageContent['menu-qr-code'].howTo.steps[0].text).toMatch(/does not host/);
  });

  it('links the pages to each other and from the footer list', () => {
    expect(USE_CASE_LINKS.map(([, href]) => href)).toEqual(Object.keys(LANDING_PRESETS).map((id) => `/${id}`));
    const related = getRelatedTypePages('qr-code-checker').map((page) => page.id);
    expect(related).not.toContain('qr-code-checker');
    expect(related.every((id) => LANDING_PAGE_IDS.includes(id))).toBe(true);
    expect(getRelatedTypePages('mosaic-qr-code', 3).map((page) => page.id)).toEqual(['qr-code-with-logo', 'google-review-qr-code', 'menu-qr-code']);
  });

  it('describes every gallery image', () => {
    for (const images of Object.values(LANDING_GALLERIES)) {
      for (const image of images) {
        expect(image.src).toMatch(/^\/examples\/.+\.png$/);
        expect(image.alt.length).toBeGreaterThan(20);
      }
    }
  });
});
