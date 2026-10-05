import type { PageContext } from 'vike/types';
import type { PageContent } from '../data/pageContent';

/**
 * The document title, from the page's content (see `+data.ts`). It runs in the browser on
 * client-side navigation, so it must not import the content registry itself.
 * @param pageContext - The page being rendered.
 * @returns The title.
 */
export default function title(pageContext: PageContext): string {
  return (pageContext.data as PageContent | undefined)?.title ?? 'QRCraftly';
}
