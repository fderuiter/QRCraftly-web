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

import type { ReactNode } from 'react';

/** Link styling for the app pages: always underlined, so links read as links without colour. */
export const APP_INFO_LINK_CLASSES = 'font-medium text-accent underline underline-offset-2';

/** Date the native app's privacy policy took effect and was last updated. */
export const APP_POLICY_DATE = { iso: '2026-10-04', label: 'October 4, 2026' } as const;

/**
 * A plain, single-column page for the native QRCraftly app (privacy policy, support). It is
 * static markup with no interactive parts, so it reads the same with JavaScript off, and it is
 * sized in rem so it follows the reader's text size.
 * @param props - Page properties.
 * @param props.title - The page heading (the only H1).
 * @param props.meta - Line under the heading, such as the effective date.
 * @param props.children - Page body.
 * @returns The page.
 */
export function AppInfoPage({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl min-w-0 px-4 py-10 sm:px-6">
      <article className="max-w-[68ch] min-w-0 space-y-5 text-lg/relaxed break-words text-fg-soft">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-fg sm:text-4xl">{title}</h1>
          {meta && <p className="mt-3 text-base text-fg-muted">{meta}</p>}
        </header>
        {children}
      </article>
    </div>
  );
}
