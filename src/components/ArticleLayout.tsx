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

import { useEffect, useState, type ReactNode } from 'react';
import { Link2 } from 'lucide-react';
import { isDangerousUrl } from '@/utils/security';
import { AccordionItem } from './ui/Accordion';
import { ButtonLink } from './ui/Button';
import { Tooltip } from './ui/Tooltip';
import { Breadcrumbs } from './Breadcrumbs';

/** One table-of-contents entry: the id and label of an H2 section of the article. */
export interface ArticleSection {
  id: string;
  label: string;
}

interface ArticleLayoutProps {
  /** Registry id of the page; when set, its breadcrumb trail is shown above the heading. */
  pageId?: string;
  /** The page heading (the only H1). */
  title: ReactNode;
  /** One or two sentences under the heading. */
  lead?: ReactNode;
  /** The article's H2 sections, in order; they become the table of contents. */
  sections: readonly ArticleSection[];
  children: ReactNode;
}

/**
 * Tracks which section is being read: the last section whose top has scrolled past the
 * upper third of the viewport.
 * @param ids - Section ids in document order.
 * @returns The id of the active section.
 */
function useActiveSection(ids: readonly string[]): string {
  const [active, setActive] = useState(ids[0] ?? '');
  // A string key keeps the observer stable while the caller passes a new array each render.
  const key = ids.join(' ');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const sectionIds = key.split(' ');
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = sectionIds.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: '0px 0px -66% 0px' }
    );
    for (const id of sectionIds) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);
  return active;
}

function TocLinks({ sections, active }: { sections: readonly ArticleSection[]; active: string }) {
  return (
    <ol className="space-y-1 border-l border-line text-sm">
      {sections.map(({ id, label }) => {
        const href = `#${id}`;
        if (!isDangerousUrl(href)) {
          return (
            <li key={id}>
              <a
                href={href}
                aria-current={id === active ? 'location' : undefined}
                className="-ml-px block border-l-2 border-transparent py-1 pl-3 text-fg-muted hover:text-fg aria-[current=location]:border-accent aria-[current=location]:font-semibold aria-[current=location]:text-accent"
              >
                {label}
              </a>
            </li>
          );
        }
        return null;
      })}
    </ol>
  );
}

/**
 * Long-form page layout for Security, About and future guides: a left-aligned column at
 * reading width (about 68 characters) and a table of contents built from the H2 sections.
 * From `lg` up the contents sit in a sticky column on the right and highlight the section
 * being read; below `lg` they collapse into an "On this page" disclosure above the article.
 * @param props - Layout properties.
 * @returns The article layout.
 */
export function ArticleLayout({ pageId, title, lead, sections, children }: ArticleLayoutProps) {
  const active = useActiveSection(sections.map((section) => section.id));
  return (
    <div className="mx-auto max-w-6xl min-w-0 px-4 py-10 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1fr)_14rem] lg:gap-12">
      <article className="max-w-[68ch] min-w-0">
        {pageId && <Breadcrumbs pageId={pageId} />}
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-fg sm:text-4xl">{title}</h1>
          {lead && <p className="mt-3 text-lg text-fg-muted">{lead}</p>}
        </header>
        <div className="mb-8 lg:hidden">
          <AccordionItem title="On this page">
            <nav aria-label="On this page">
              <TocLinks sections={sections} active={active} />
            </nav>
          </AccordionItem>
        </div>
        {children}
      </article>
      <aside className="hidden lg:block">
        <nav aria-label="On this page" className="sticky top-6">
          <p className="mb-3 text-xs font-semibold tracking-wide text-fg-muted uppercase">On this page</p>
          <TocLinks sections={sections} active={active} />
        </nav>
      </aside>
    </div>
  );
}

/**
 * An H2 with a copy-link anchor, for a section listed in the {@link ArticleLayout} contents.
 * Clicking the anchor jumps to the section and copies its address to the clipboard.
 * @param props - Heading properties.
 * @param props.id - Id of the section the anchor links to.
 * @param props.children - Heading text.
 * @returns The heading.
 */
export function ArticleHeading({ id, children }: { id: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group mb-4 flex items-center gap-2">
      <h2 className="text-2xl font-bold text-fg">{children}</h2>
      <Tooltip content={copied ? 'Link copied' : 'Copy link to this section'}>
        <ButtonLink
          href={`#${id}`}
          variant="ghost"
          size="xs"
          iconOnly
          aria-label="Copy link to this section"
          className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => {
            const url = `${window.location.origin}${window.location.pathname}#${id}`;
            navigator.clipboard?.writeText(url).then(() => setCopied(true), () => undefined);
          }}
        >
          <Link2 className="size-4" aria-hidden="true" />
        </ButtonLink>
      </Tooltip>
    </div>
  );
}
