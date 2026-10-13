import type { FaqCopy } from '@/data/copy/types';
import { Accordion, AccordionItem } from './ui/Accordion';

/**
 * The visible questions behind a page's FAQPage structured data. Search engines only use
 * FAQ markup whose questions and answers are also on the page, so the page renders the
 * same list its JSON-LD is built from.
 * @param root0 - Component properties.
 * @param root0.faqs - Questions and answers.
 * @returns The questions as an accordion.
 */
export function PageFaq({ faqs }: { faqs: readonly FaqCopy[] }) {
  return (
    <Accordion>
      {faqs.map((q) => (
        <AccordionItem key={q.question} title={q.question} headingLevel={3}>
          {q.answer}
        </AccordionItem>
      ))}
    </Accordion>
  );
}
