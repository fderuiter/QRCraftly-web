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

import type { PageContextServer } from 'vike/types';
import { buildPageContent, type PageContent } from '@/data/pageContent';

/**
 * Hands each page its own content at prerender time, so the shared content modules stay on the
 * server (#1058). Vike serializes the result into the page's HTML.
 * @param pageContext - The page being rendered.
 * @returns The page's content.
 */
export default function data(pageContext: PageContextServer): PageContent {
  return buildPageContent(pageContext);
}
