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
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { ArticleHeading, ArticleLayout } from '@/components/ArticleLayout';
import { GUIDE_AUTHOR, getGuide, readingMinutes, type Guide, type GuideBlock } from '@/data/guides';
import { isDangerousUrl } from '@/utils/security';

const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;
const LINK_CLASSES = 'font-medium text-accent underline underline-offset-2';
const LIST_CLASSES = 'my-3 space-y-1.5 pl-6';

/**
 * Turns the `[label](href)` links of a guide's text into anchors. A link with a script or data
 * address is shown as plain text.
 * @param text - Text with optional links.
 * @returns Text and anchor nodes.
 */
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const [whole, label, href] = match;
    nodes.push(text.slice(from, match.index));
    if (!isDangerousUrl(href)) {
      nodes.push(
        <a key={match.index} href={href} className={LINK_CLASSES}>
          {label}
        </a>
      );
    } else {
      nodes.push(label);
    }
    from = match.index + whole.length;
  }
  nodes.push(text.slice(from));
  return nodes;
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case 'p':
      return <p className="my-3 leading-relaxed">{renderInline(block.text)}</p>;
    case 'ul':
      return (
        <ul className={`${LIST_CLASSES} list-disc`}>
          {block.items.map((item) => (
            <li key={item}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className={`${LIST_CLASSES} list-decimal`}>
          {block.items.map((item) => (
            <li key={item}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    case 'note':
      return (
        <aside className="my-4 rounded-xl border border-line bg-surface-sunken p-4 text-sm">
          <p className="mb-1 font-semibold text-fg">{block.title}</p>
          <p className="leading-relaxed">{renderInline(block.text)}</p>
        </aside>
      );
    case 'table':
      return (
        // A scrollable region must be focusable so keyboard users can scroll it (axe: scrollable-region-focusable).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        <div tabIndex={0} role="region" aria-label={block.caption} className="my-4 w-0 min-w-full overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-lg text-left text-sm">
            <caption className="sr-only">{block.caption}</caption>
            <thead className="bg-surface-sunken text-fg">
              <tr>
                {block.head.map((cell) => (
                  <th key={cell} scope="col" className="px-3 py-2 font-semibold">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]} className="border-t border-line-subtle align-top">
                  {row.map((cell, index) =>
                    index === 0 ? (
                      <th key={cell} scope="row" className="px-3 py-2 font-medium text-fg">
                        {cell}
                      </th>
                    ) : (
                      <td key={cell} className="px-3 py-2">
                        {renderInline(cell)}
                      </td>
                    )
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** Formats a `YYYY-MM-DD` date as "3 October 2026" in UTC, so it reads the same in every time zone. */
export function formatGuideDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * A guide from the `/guides` hub (#1038): heading, a visible byline with its dates, a table of
 * contents, the body, the sources it rests on and links to related guides. Head renders its
 * `Article` data.
 * @param props - Component properties.
 * @param props.guide - The guide to show.
 * @returns The article.
 */
export function GuideArticle({ guide }: { guide: Guide }) {
  const sections = [...guide.sections.map(({ id, heading }) => ({ id, label: heading })), { id: 'sources', label: 'Sources' }];
  const related = guide.related.flatMap((slug) => {
    const other = getGuide(slug);
    return other ? [other] : [];
  });
  const updated = guide.dateModified !== guide.datePublished;

  return (
    <>
      <ArticleLayout
        title={guide.title}
        lead={
          <>
            {guide.lead}
            <span className="mt-4 block text-sm text-fg-muted">
              By {GUIDE_AUTHOR} · Published <time dateTime={guide.datePublished}>{formatGuideDate(guide.datePublished)}</time>
              {updated && (
                <>
                  {' '}
                  · Updated <time dateTime={guide.dateModified}>{formatGuideDate(guide.dateModified)}</time>
                </>
              )}{' '}
              · {readingMinutes(guide)} min read
            </span>
          </>
        }
        sections={sections}
      >
        <Breadcrumbs pageId={`guides/${guide.slug}`} />
        <div className="text-base text-fg-soft">
          {guide.sections.map((section) => (
            <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="mb-10 scroll-mt-6">
              <ArticleHeading id={section.id}>
                <span id={`${section.id}-title`}>{section.heading}</span>
              </ArticleHeading>
              {section.blocks.map((block, index) => (
                <Block key={index} block={block} />
              ))}
            </section>
          ))}

          <section id="sources" aria-labelledby="sources-title" className="mb-10 scroll-mt-6">
            <ArticleHeading id="sources">
              <span id="sources-title">Sources</span>
            </ArticleHeading>
            <ul className="my-3 list-none space-y-3 text-sm">
              {guide.sources.map((source) => {
                if (!isDangerousUrl(source.url)) {
                  return (
                    <li key={source.url}>
                      <a href={source.url} rel="noopener noreferrer" className={LINK_CLASSES}>
                        {source.label}
                      </a>
                      <span className="mt-0.5 block text-fg-muted">{source.supports}</span>
                    </li>
                  );
                }
                return null;
              })}
            </ul>
          </section>

          {related.length > 0 && (
            <nav aria-labelledby="related-guides-title" className="mb-6">
              <h2 id="related-guides-title" className="mb-3 text-2xl font-bold text-fg">
                Keep reading
              </h2>
              <ul className="list-none space-y-2 text-sm">
                {related.map((other) => {
                  const href = `/guides/${other.slug}`;
                  if (!isDangerousUrl(href)) {
                    return (
                      <li key={other.slug}>
                        <a href={href} className={LINK_CLASSES}>
                          {other.title}
                        </a>
                      </li>
                    );
                  }
                  return null;
                })}
                <li>
                  <a href="/guides" className={LINK_CLASSES}>
                    All guides
                  </a>
                </li>
              </ul>
            </nav>
          )}
        </div>
      </ArticleLayout>
    </>
  );
}
