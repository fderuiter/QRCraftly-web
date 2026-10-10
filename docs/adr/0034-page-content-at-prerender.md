---
status: accepted
---

# Page Content Is Built at Prerender Time

## Context

The content registry (`src/data/contentRegistry.ts`), the type guides (`src/data/typeGuides.ts`) and the landing copy (`src/data/landingPageContent.ts`) describe every page. Generator pages, `+title.ts` and each page's structured data imported them in the browser. As a result, every generator page downloaded every other page's text, about 42 KB gzipped of a 255 KB first load. Lighthouse's simulated throttling charges that download to first paint, and the performance floor (#1058) had little room left.

## Decision

- **One server-side builder.** `src/data/pageContent.ts` exports `buildPageContent(pageContext)`. It returns one page's title, registry entry, guide, landing copy, example picture, gallery and related links.
- **Global `+data` hook.** `src/pages/+data.ts` calls the builder at prerender time. Vike serializes the result into the page's HTML and `index.pageContext.json`. `LayoutDefault` provides it through `PageContentContext`, and components read it with `usePageContent()`. `+title.ts` reads `pageContext.data.title`.
- **Structured data in Head.** `getPageSchema(urlPathname)` builds a page's own JSON-LD (application, how-to, FAQ or article). The server-only Head renders it after the site-wide graph, so pages and components no longer render `JsonLdScript` themselves.
- **Enforced boundary.** The package-boundary rule `page-content-stays-on-server` (`scripts/boundaries.config.js`) stops components, hooks, contexts, layouts and pages from importing the registry, type guides, landing copy, related pages, page content builder or schema generator. The exceptions are Head, `+data.ts`, `+description.ts` and tests. Type-only imports are allowed.

## Consequences

- Generator pages' first load fell from about 255 KB to 231 KB gzipped, and the shared chunk of all pages' text is gone.
- A page's own content is in its HTML twice: once rendered and once serialized for hydration. That costs a few kilobytes of HTML, which the site-wide budget does not count (only per-page first load, which stays well under 260 KB).
- Component tests that need page content wrap the component with `withPageContent(path, …)` from `tests/utils/pageContent.tsx`. Tests for structured data call `getPageSchema` instead of querying the rendered page.
- On client-side navigation, Head is not re-rendered, so the JSON-LD stays the first page's. Crawlers load each URL fresh, so they always see the right data.
