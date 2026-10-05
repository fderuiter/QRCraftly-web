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

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { formatGuideDate } from '@/components/GuideArticle';
import { guides, readingMinutes } from '@/data/guides';
import { isDangerousUrl } from '@/utils/security';

/**
 * The `/guides` index (#1038): every guide with its summary, date and reading time.
 * @returns The page.
 */
export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Breadcrumbs pageId="guides" />
        <h1 className="mb-3 text-3xl font-bold text-fg sm:text-4xl">QR code guides</h1>
        <p className="mb-8 text-lg text-fg-muted">
          Plain answers to the questions people ask when a QR code lets them down, with sources. No sign-up, no ads, and nothing tracked.
        </p>
        <ul className="list-none space-y-4">
          {guides.map((guide) => {
            const href = `/guides/${guide.slug}`;
            if (!isDangerousUrl(href)) {
              return (
                <li key={guide.slug} className="rounded-xl border border-line bg-surface p-5">
                  <h2 className="text-xl font-bold text-fg">
                    <a href={href} className="text-accent underline-offset-2 hover:underline">
                      {guide.title}
                    </a>
                  </h2>
                  <p className="mt-2 text-sm text-fg-soft">{guide.description}</p>
                  <p className="mt-2 text-xs text-fg-muted">
                    <time dateTime={guide.dateModified}>{formatGuideDate(guide.dateModified)}</time> · {readingMinutes(guide)} min read
                  </p>
                </li>
              );
            }
            return null;
          })}
        </ul>
      </div>
    </>
  );
}
