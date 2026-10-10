import { getMetadataForPageContext, type MetadataPageContext } from "../data/contentRegistry";

/**
 * Page description from the content registry (the 404 page uses the `_error` entry).
 * @param pageContext - Vike page context.
 * @returns The meta description.
 */
export default function description(pageContext: MetadataPageContext) {
  return getMetadataForPageContext(pageContext).description;
}
