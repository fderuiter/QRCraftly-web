import { useEffect, useState } from 'react';
import { CloudCog, CloudUpload, Cookie, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { SanitizedHtml } from '@/components/ui/SanitizedHtml';
import docsManifest from '../../data/docs_manifest.json';
import { AccordionItem } from '@/components/ui/Accordion';
import { ButtonLink } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ArticleHeading, ArticleLayout, type ArticleSection } from '@/components/ArticleLayout';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import { copy } from '@/data/copy/security';
import { SidebarContent } from '@/components/SidebarContent';

/**
 * Typography for compiled Markdown. The project does not ship `@tailwindcss/typography`, so
 * `prose` classes would be inert; these descendant utilities style the manifest HTML
 * explicitly and keep long code, tables and URLs inside the column on narrow screens.
 */
const DOC_PROSE_CLASSES = [
  'min-w-0 max-w-none text-base leading-relaxed text-fg-soft [overflow-wrap:anywhere]',
  '[&_h3]:mt-8 [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:text-fg [&_h3]:scroll-mt-6',
  '[&_h4]:mt-6 [&_h4]:mb-2 [&_h4]:text-lg [&_h4]:font-semibold [&_h4]:text-fg [&_h4]:scroll-mt-6',
  '[&_h5]:mt-4 [&_h5]:mb-2 [&_h5]:font-semibold [&_h5]:text-fg',
  '[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1',
  '[&_a]:font-medium [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-semibold [&_strong]:text-fg',
  '[&_hr]:my-8 [&_hr]:border-line',
  '[&_code]:rounded [&_code]:bg-surface-hover [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm',
  '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-sunken [&_pre]:p-4 [&_pre]:text-sm [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:my-4 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:text-sm',
  '[&_th]:border-b [&_th]:border-line-strong [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold',
  '[&_td]:border-b [&_td]:border-line-subtle [&_td]:px-3 [&_td]:py-2 [&_td]:align-top',
].join(' ');

/**
 * The published documents from `docs/`, in page order. Their HTML comes from the docs
 * manifest while the page is prerendered; `Page.test.tsx` checks that every manifest
 * document is listed here.
 */
const DOC_SECTIONS: readonly ArticleSection[] = [
  { id: 'security', label: 'Security policy' },
  { id: 'compliance', label: 'Privacy and compliance' },
];

/**
 * The compiled documents are about 8 KB gzipped. They are rendered into the prerendered
 * HTML only: the browser bundle leaves the manifest out (the condition is false in a
 * production client build) and hydrates each document from the HTML already on the page.
 */
const PRERENDER_DOCS: ReadonlyMap<string, string> | null =
  import.meta.env.SSR || import.meta.env.MODE === 'test' ? new Map(docsManifest.map((doc) => [doc.id, doc.html])) : null;

/**
 * True when the document itself was loaded at the current path, so a reload would return
 * the same HTML. It guards against a reload loop when the offline service worker serves
 * the app shell in place of this page.
 * @returns Whether this page was a full document load.
 */
function isFullLoadOfThisPage(): boolean {
  const [entry] = performance.getEntriesByType('navigation');
  return entry !== undefined && new URL(entry.name).pathname === window.location.pathname;
}

/**
 * Reads a document's HTML: from the manifest while prerendering, otherwise from the
 * prerendered element itself. After a client-side navigation there is no prerendered
 * element, so the page reloads once to fetch the static HTML.
 * @param id - Document id.
 * @returns The document HTML, or null while the page reloads or when it is unavailable.
 */
function usePrerenderedDoc(id: string): string | null {
  const [html] = useState(() => PRERENDER_DOCS?.get(id) ?? (typeof document === 'undefined' ? null : document.getElementById(`${id}-doc`)?.innerHTML ?? null));
  useEffect(() => {
    if (html === null && !isFullLoadOfThisPage()) window.location.reload();
  }, [html]);
  return html;
}

function DocSection({ id, label }: ArticleSection) {
  const html = usePrerenderedDoc(id);
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-10 min-w-0 scroll-mt-6">
      <ArticleHeading id={id}>
        <span id={`${id}-title`}>{label}</span>
      </ArticleHeading>
      <AccordionItem title={`Read the full ${label.toLowerCase()}`}>
        {html === null ? (
          <Skeleton shape="text" className="h-24" />
        ) : (
          <SanitizedHtml id={`${id}-doc`} html={html} className={DOC_PROSE_CLASSES} />
        )}
      </AccordionItem>
    </section>
  );
}

/** The four plain claims at the top of the page. Each one is backed by the details below. */
const SUMMARY = [
  { icon: MonitorSmartphone, title: 'Generated on your device', text: 'Your browser builds every QR code and file transfer itself.' },
  { icon: CloudUpload, title: 'Nothing uploaded', text: 'What you type, scan or send never leaves this device.' },
  { icon: Cookie, title: 'No tracking cookies or trackers', text: 'No analytics, pixels, fingerprinting or third-party scripts.' },
  { icon: CloudCog, title: 'Cloudflare keeps standard request logs', text: 'Our host sees page requests (IP address, browser, page, time), never your content.' },
] as const;

/**
 * Counts the requests this page has made since it loaded, using `PerformanceObserver`.
 * The count stays in the page and is never sent anywhere.
 * @returns The total and third-party request counts, or null where unsupported.
 */
function useRequestCount(): { total: number; external: number } | null {
  const [count, setCount] = useState<{ total: number; external: number } | null>(null);
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined' || typeof performance.getEntriesByType !== 'function') return;
    let total = 0;
    let external = 0;
    const add = (entries: PerformanceEntryList) => {
      for (const entry of entries) {
        total += 1;
        if (!entry.name.startsWith(window.location.origin)) external += 1;
      }
      setCount({ total, external });
    };
    add(performance.getEntriesByType('resource'));
    const observer = new PerformanceObserver((list) => add(list.getEntries()));
    observer.observe({ type: 'resource' });
    return () => observer.disconnect();
  }, []);
  return count;
}

function RequestCounter() {
  const count = useRequestCount();
  return (
    <p className="mt-4 rounded-xl border border-line bg-surface-sunken p-4 text-sm text-fg-soft" data-testid="request-counter">
      <span className="font-semibold text-fg">Check it yourself.</span> Open your browser&apos;s developer tools, choose
      Network, then make a QR code: no request carries your content.{' '}
      {count && (
        <span aria-live="polite">
          This page has loaded {count.total} files since it opened, {count.external} of them from other sites.
        </span>
      )}
    </p>
  );
}

const SECTIONS: readonly ArticleSection[] = [
  { id: 'summary', label: 'What happens to your data' },
  ...DOC_SECTIONS,
  { id: 'report', label: 'Report a vulnerability' },
  { id: 'content-section', label: 'Questions' },
];

/**
 * Security & Privacy page: a short summary of what happens to your data, the security
 * policy and privacy documents (collapsed, but in the HTML), and how to report a problem.
 * @returns The security page.
 */
export default function Page() {

  return (
    <>
      <ArticleLayout
        title="Security & Privacy Transparency Hub"
        lead="What QRCraftly does with your data, in plain words, and the full policies behind it."
        sections={SECTIONS}
      >
        <section id="summary" aria-labelledby="summary-title" className="mb-10 scroll-mt-6">
          <ArticleHeading id="summary">
            <span id="summary-title">What happens to your data</span>
          </ArticleHeading>
          <ul className="grid gap-3 sm:grid-cols-2">
            {SUMMARY.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3 rounded-xl border border-line bg-surface p-4">
                <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-fg">{title}</p>
                  <p className="text-sm text-fg-muted">{text}</p>
                </div>
              </li>
            ))}
          </ul>
          <RequestCounter />
        </section>

        {DOC_SECTIONS.map((doc) => (
          <DocSection key={doc.id} {...doc} />
        ))}

        <section id="report" aria-labelledby="report-title" className="mb-10 scroll-mt-6">
          <ArticleHeading id="report">
            <span id="report-title">Report a vulnerability</span>
          </ArticleHeading>
          <p className="mb-4 text-fg-soft">
            Found a security problem? Report it privately through GitHub&apos;s security advisories so it can be fixed before it is public.
          </p>
          <ButtonLink
            href="https://github.com/fderuiter/QRCraftly/security/advisories/new"
            target="_blank"
            rel="noopener noreferrer"
            variant="primary"
          >
            <ShieldCheck className="size-5" aria-hidden="true" />
            Secure Disclosure Portal
          </ButtonLink>
        </section>

        <PageCopyContext.Provider value={copy}>
          <SidebarContent toolId="security" />
        </PageCopyContext.Provider>
      </ArticleLayout>
    </>
  );
}
