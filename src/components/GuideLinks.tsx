import { usePageContent } from '@/data/PageContentContext';
import { isDangerousUrl } from '@/utils/security';

/**
 * Links the page's guides in the page body (#1309), so each guide is reachable from the tools it
 * belongs with and not only from the `/guides` index.
 * @returns The guide links, or null on pages without guides.
 */
export function GuideLinks() {
  const guides = usePageContent()?.guides;
  if (!guides || guides.length === 0) return null;

  return (
    <section className="mb-10" aria-labelledby="page-guides-heading">
      <h2 id="page-guides-heading" className="mb-3 text-2xl font-bold text-fg">
        Guides
      </h2>
      <ul className="list-none space-y-2 text-sm">
        {guides.map((guide) => {
          if (isDangerousUrl(guide.href)) return null;
          return (
            <li key={guide.id}>
              <a href={guide.href} className="font-semibold text-accent underline-offset-2 hover:underline">
                {guide.name}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
