// Allowed: a type-only import of the page content builder.
import type { PageContent } from '../data/pageContent';

export const badge = (content: PageContent) => content.title;
