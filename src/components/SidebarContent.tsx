import { useContext } from 'react';
import { copy as indexCopy } from '@/data/copy/index';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import { usePageContent } from '@/data/PageContentContext';
import { getGuideFaqs } from '@/data/guideFaqs';
import { isDangerousUrl } from '@/utils/security';
import { Breadcrumbs } from './Breadcrumbs';
import { SectionHeading } from './ui/SectionHeading';
import { Accordion, AccordionItem } from './ui/Accordion';

interface SidebarContentProps {
  toolId: string;
}

/**
 * Builds the overview heading for a registry entry without doubling a leading "About"
 * (for example "About QRCraftly" stays as is instead of becoming "About About QRCraftly").
 * @param name - Registry display name.
 * @returns The section heading.
 */
export function getAboutHeading(name: string): string {
  return /^about\b/i.test(name.trim()) ? name.trim() : `About ${name}`;
}

/**
 * Renders the overview, how-to and FAQ sections for a tool's registry entry.
 * @param root0 - Component properties.
 * @param root0.toolId - Content registry id.
 * @returns The content sections, or null for unknown ids.
 */
export function SidebarContent({ toolId }: SidebarContentProps) {
  const page = usePageContent();
  const copy = useContext(PageCopyContext);
  const content = page?.tool;

  if (!page || !content) return null;

  const displayFaqs = (copy.faqs && copy.faqs.length > 0)
    ? copy.faqs
    : indexCopy.faqs ?? [];

  const { example, related, gallery, guide } = page;
  // Background reading lives in the FAQ, below the tool, so it never sits in the way (#1354).
  const guideFaqs = guide ? getGuideFaqs(guide) : [];
  const intro = content.intro ?? guide?.intro;

  return (
    <div id="content-section" className="mt-12 border-t border-line-subtle pt-8 text-fg-soft">
      <Breadcrumbs pageId={toolId} />

      {intro && (
        <section className="mb-10">
          <h2 className="mb-3 text-2xl font-bold text-fg">A QR code generator that stays free</h2>
          <p className="mb-3 text-sm leading-relaxed">{intro}</p>
          <a href="/free-forever" className="text-sm font-semibold text-accent underline-offset-2 hover:underline">
            Read the no-ads pledge
          </a>
        </section>
      )}

      {content.name && content.name !== 'QRCraftly' && (
        <section className="mb-10">
          <h2 className="mb-3 text-2xl font-bold text-fg">{getAboutHeading(content.name)}</h2>
          {content.description && !guide && <p className="mb-4 text-sm leading-relaxed">{content.description}</p>}
          {example && (
            <img
              src={example.src}
              alt={example.alt}
              width={160}
              height={160}
              loading="lazy"
              decoding="async"
              className="mb-4 size-40 rounded-lg border border-line bg-surface"
            />
          )}
          {content.features && content.features.length > 0 && (
            <>
              <SectionHeading eyebrow="Key Features" level={3} className="mt-6 mb-3" />
              <ul className="list-none space-y-2 text-sm">
                {content.features.map((feature: string, idx: number) => (
                  <li key={idx} className="flex items-start">
                    <span className="mr-2 text-accent" aria-hidden="true">•</span>
                    {feature.trim()}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {copy.howTo && copy.howTo.steps && copy.howTo.steps.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-5 text-2xl font-bold text-fg">{copy.howTo.name}</h2>
          {copy.howTo.description && <p className="mb-5 text-sm text-fg-muted">{copy.howTo.description}</p>}
          <div className="space-y-4">
            {copy.howTo.steps.map((step, idx) => (
              <div key={idx} className="flex gap-4 rounded-xl border border-line bg-surface-sunken p-4">
                <div className="flex size-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">
                  {idx + 1}
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold text-fg">{step.name}</h3>
                  <p className="text-sm text-fg-muted">{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {gallery && (
        <section className="mb-10" aria-labelledby="gallery-heading">
          <h2 id="gallery-heading" className="mb-3 text-2xl font-bold text-fg">
            Examples
          </h2>
          <ul className="grid list-none gap-4 sm:grid-cols-2">
            {gallery.map((image) => (
              <li key={image.src}>
                <figure>
                  <img
                    src={image.src}
                    alt={image.alt}
                    width={396}
                    height={396}
                    loading="lazy"
                    decoding="async"
                    className="aspect-square w-full rounded-lg border border-line bg-surface"
                  />
                  <figcaption className="mt-2 text-sm text-fg-muted">{image.caption}</figcaption>
                </figure>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-fg-muted">
            Both are working codes for qrcraftly.com, made from a picture drawn in code. No AI was used.
          </p>
        </section>
      )}

      {(displayFaqs.length > 0 || guideFaqs.length > 0) && (
        <section className="mb-10">
          <h2 className="mb-5 text-2xl font-bold text-fg">Frequently Asked Questions</h2>
          <Accordion>
            {displayFaqs.map((q) => (
              <AccordionItem key={q.question} title={q.question} headingLevel={3}>
                {q.answer}
              </AccordionItem>
            ))}
            {guideFaqs.map((q) => (
              <AccordionItem key={q.question} title={q.question} headingLevel={3}>
                {q.paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mb-2 last:mb-0">
                    {paragraph}
                  </p>
                ))}
                {q.items && (
                  <ul className="list-disc space-y-1 pl-5">
                    {q.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {q.link && (
                  <a href={q.link.href} className="mt-2 inline-block font-semibold text-accent underline-offset-2 hover:underline">
                    {q.link.label}
                  </a>
                )}
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}

      {related.length > 0 && (
        <section className="mb-10" aria-labelledby="related-types-heading">
          <h2 id="related-types-heading" className="mb-3 text-2xl font-bold text-fg">
            More QR code types
          </h2>
          <ul className="list-none space-y-2 text-sm">
            {related.map((page) => {
              if (!isDangerousUrl(page.href)) {
                return (
                  <li key={page.id}>
                    <a href={page.href} className="font-semibold text-accent underline-offset-2 hover:underline">
                      {page.name}
                    </a>
                  </li>
                );
              }
              return null;
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
