---
status: accepted
---

# Page Scripts Start After First Paint

## Context

Every page is pre-rendered, so its HTML and CSS are enough to paint it. Vike still lists the entry module and about 38 `modulepreload` links (about 215 KB) in the `<head>` of each page. Lighthouse's simulated throttling counts every request that starts before first paint, so those downloads pushed first contentful paint to about 3 s and kept generator pages near the 0.85 performance floor (#1058). Splitting page content per route ([ADR 0034](./0034-page-content-at-prerender.md)) cut bytes but not that request count.

## Decision

- **Postbuild rewrite.** `scripts/defer_page_scripts.js` runs after the build, before `csp_hash_injector.js`. It moves each page's startup tags (the entry `<script type="module">` and its `modulepreload` links) into an inert `<template id="deferred-scripts">` at the end of `<body>`.
- **Static loader.** A small inline script after the template recreates the tags in their original order once the page has painted (`requestAnimationFrame`, then `setTimeout`). A hidden tab paints nothing, so there it loads at once. The loader text is the same on every page, so the CSP needs one hash for it.
- **Same files, same references.** The tags keep their `src` and `href`, so the per-page budget (`check-bundle-size.js`) and the service worker shell still find every startup file.

## Consequences

- Local Lighthouse on generator pages rose from about 0.85 to 0.91–0.99. First contentful paint is about 1 s; time to interactive is unchanged. CI medians on every page were 0.92 or more, so the Lighthouse floor in `lighthouserc.json` rose from 0.85 to 0.9.
- The page is visible a moment before React hydrates it. The markup is identical, and the theme script in `<head>` still runs first, so nothing shifts.
- Client-side navigation is unaffected: it only applies to the HTML that the server sends.
- If Vike changes how it writes startup tags, the rewrite finds none and leaves the page as it was; `tests/defer_page_scripts.test.ts` and the e2e suite catch that.
