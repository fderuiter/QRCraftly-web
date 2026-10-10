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
import { contentRegistry } from './contentRegistry';
import { guides } from './guides';
import { getPageGuides, PAGE_GUIDES } from './pageGuides';

describe('PAGE_GUIDES', () => {
  it('links every guide from at least three tool pages (#1309)', () => {
    for (const guide of guides) {
      const pages = Object.keys(PAGE_GUIDES).filter((id) => PAGE_GUIDES[id].includes(guide.slug));
      expect(pages.length, guide.slug).toBeGreaterThanOrEqual(3);
    }
  });

  it('names only real pages and real guides', () => {
    const slugs = new Set(guides.map((guide) => guide.slug));
    for (const [id, linked] of Object.entries(PAGE_GUIDES)) {
      expect(contentRegistry[id], id).toBeDefined();
      for (const slug of linked) expect(slugs.has(slug), `${id} -> ${slug}`).toBe(true);
    }
  });

  it('builds links with the guide short titles', () => {
    expect(getPageGuides('qr-code-scanner')[0]).toEqual({
      id: 'guides/qr-code-scams-quishing',
      name: 'QR code scams (quishing)',
      href: '/guides/qr-code-scams-quishing',
    });
    expect(getPageGuides('wifi-qr-code')).toEqual([]);
  });
});
