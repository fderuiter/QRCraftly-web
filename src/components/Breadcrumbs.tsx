import { isDangerousUrl } from '@/packages/core/security';
import { formatPathName } from '@/utils/metadataEngine';

interface BreadcrumbsProps {
  /** Registry id of the page; slashes separate nested routes. */
  pageId: string;
}

/**
 * The visible trail from the home page to the current page, matching the BreadcrumbList data.
 * @param root0 - Component properties.
 * @param root0.pageId - Registry id of the page.
 * @returns A breadcrumb navigation, or null on the home page.
 */
export function Breadcrumbs({ pageId }: BreadcrumbsProps) {
  if (pageId === 'index') return null;
  const segments = pageId.split('/');
  return (
    <nav aria-label="Breadcrumb" className="mb-6 text-sm text-fg-muted">
      <ol className="flex flex-wrap items-center gap-x-2">
        <li>
          <a href="/" className="underline-offset-2 hover:underline">
            Home
          </a>
        </li>
        {segments.map((segment, index) => {
          const last = index === segments.length - 1;
          const href = `/${segments.slice(0, index + 1).join('/')}`;
          if (!isDangerousUrl(href)) {
            if (!last) {
              return (
                <li key={segment} className="flex items-center gap-x-2">
                  <span aria-hidden="true">/</span>
                  <a href={href} className="inline-block py-1 underline-offset-2 hover:underline">
                    {formatPathName(segment)}
                  </a>
                </li>
              );
            }
          }
          return (
            <li key={segment} className="flex items-center gap-x-2">
              <span aria-hidden="true">/</span>
              <span aria-current={last ? 'page' : undefined} className="font-medium text-fg">
                {formatPathName(segment)}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
