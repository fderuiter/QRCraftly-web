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

import type { ReactNode } from 'react';
import { buildPageContent } from '../../src/data/pageContent';
import { PageContentContext } from '../../src/data/PageContentContext';

/**
 * Wraps a component in the content the global `+data` hook gives the page at `path`, as
 * LayoutDefault does on a real page.
 * @param path - The page's path, such as `/wifi-qr-code` or `/` for the homepage.
 * @param children - The component under test.
 * @returns The wrapped element.
 */
export function withPageContent(path: string, children: ReactNode) {
  return <PageContentContext.Provider value={buildPageContent({ urlPathname: path })}>{children}</PageContentContext.Provider>;
}

/**
 * The path of a registry id.
 * @param id - Registry id (`index` for the homepage).
 * @returns The page's path.
 */
export function pathOf(id: string): string {
  return id === 'index' ? '/' : `/${id}`;
}
