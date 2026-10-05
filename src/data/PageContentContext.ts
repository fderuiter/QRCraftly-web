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

import { createContext, useContext } from 'react';
import type { PageContent } from './pageContent';

/**
 * The content of the page being rendered, from the global `+data` hook (see `pageContent.ts`).
 * LayoutDefault provides it; null outside a page, for example in a component test.
 */
export const PageContentContext = createContext<PageContent | null>(null);

/**
 * Reads the content of the page being rendered.
 * @returns The page's content, or null when no page provides it.
 */
export function usePageContent(): PageContent | null {
  return useContext(PageContentContext);
}
