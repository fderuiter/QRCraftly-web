import { landingPageContent } from '../../src/data/landingPageContent';
import type { ToolCopy } from '../../src/data/copy/types';

const modules = import.meta.glob<{ copy: ToolCopy }>('../../src/data/copy/*.ts', { eager: true });

/**
 * Looks up the how-to steps and FAQs of a page, whether it has its own copy module or is a
 * landing page.
 * @param id - Registry id of the page.
 * @returns Its copy, or an empty object when the page has none.
 */
export function pageCopy(id: string): ToolCopy {
  const own = modules[`../../src/data/copy/${id}.ts`]?.copy;
  if (own) return own;
  const landing = (landingPageContent as Record<string, ToolCopy | undefined>)[id];
  return landing ?? {};
}
