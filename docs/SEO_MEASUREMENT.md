# Search measurement

QRCraftly measures search performance without adding anything to its pages: no analytics script, no beacon, no cookie. Everything below comes from the search engines' own consoles and from Cloudflare's zone-level request counts, which need no page code. See the [No-Ads Pledge](./PLEDGE.md) for why.

## Tools

| Tool                     | What it gives us                                                                                               | Setup                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Google Search Console    | Impressions, clicks, CTR and average position per query and page; page indexing; Core Web Vitals field data    | `qrcraftly.com` **Domain property**, verified with a DNS TXT record in Cloudflare. Sitemap: `https://qrcraftly.com/sitemap.xml` |
| Bing Webmaster Tools     | The same for Bing, plus IndexNow submissions it received                                                       | Imported from Search Console. Same sitemap                                                                                      |
| Cloudflare Crawler Hints | Tells IndexNow engines (Bing, Yandex, Seznam, Naver) when a URL has changed, so they recrawl after each deploy | One toggle under **Caching → Configuration** for the `qrcraftly.com` zone. No key file or code in this repository               |

Only `qrcraftly.com` is indexed. Every page's canonical link points there, and `public/_headers` sends `X-Robots-Tag: noindex` on every `*.fpderuiter.workers.dev` host, so preview builds and the workers.dev copy of production stay out of search results.

## KPIs

| KPI                                                                                                                 | Where                                                                      | Goal                                                            |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Indexed pages vs sitemap URLs                                                                                       | Search Console → Pages                                                     | Every sitemap URL indexed; every "not indexed" reason explained |
| Non-brand clicks and impressions                                                                                    | Search Console → Performance, with queries containing "qrcraftly" excluded | Rising month on month                                           |
| Top-10 positions for the P1 query clusters (Wi-Fi, vCard, free QR code without sign-up, QR codes that never expire) | Search Console → Performance, filtered by query                            | More P1 queries in the top 10 each quarter                      |
| Core Web Vitals "good" share                                                                                        | Search Console → Core Web Vitals (mobile and desktop)                      | 100% of URLs good                                               |
| Referring domains                                                                                                   | Search Console → Links → Top linking sites                                 | Rising                                                          |

## Monthly review

Once a month:

1. Export Search Console **Performance** for the last 28 days (queries and pages).
2. Check the KPIs above against last month and note them in the SEO tracking issue.
3. Move pages with many impressions but a CTR well below their position's norm into a title and description rewrite queue.
4. Check **Pages** for new "Crawled, currently not indexed" or "Duplicate" reasons and file an issue for each pattern.
5. Check Bing Webmaster Tools → **IndexNow** to confirm Crawler Hints is still submitting URLs after deploys.

## Share images and internal links

Every page that points its `image` at `/og/<id>.png` gets a 1200 by 630 share image when `pnpm build` runs (`scripts/generate_social_images.ts`, run by `postbuild`). It shows the page heading beside a real QR code of the page's own address, so a shared link previews as something that scans. The images are plain Node with no image library and no system fonts, so they are byte-for-byte reproducible. Each generator page also gets `dist/client/examples/<id>.svg`, a QR code of its sample data, shown in the page with descriptive alt text. Neither folder counts toward the bundle-size total, since only a crawler or an image tag fetches them.

Generator pages show a breadcrumb trail that mirrors the `BreadcrumbList` data and a "More QR code types" list. The list comes from `getRelatedTypePages` in `src/data/relatedPages.ts`: each page links to the four generators after it, wrapping round, so every generator is linked from at least four others.

## Generator page template

Each of the eleven generator pages (Wi-Fi, vCard, email, SMS, phone, event, location, meeting, crypto payment, social and text) follows one on-page template, rendered below the tool by `SidebarContent`. The title is "Free {Type} QR Code Generator: No Sign-up, Never Expires | QRCraftly", the description is at most 155 characters, and the sections are an intro of 40 to 60 words, how to make one, what happens when it is scanned, use cases, printing tips, a pre-share checklist, privacy, the FAQ and related types. The page-specific text lives in `src/data/typeGuides.ts`; `SidebarContent.test.tsx` holds each page to 600 to 1,000 words. When you write or change a claim there, check it against the generator in `src/packages/qr-payload` (for example, event times are saved without a time zone), and keep the text for people, not for keywords.

## Landing pages

Ten pages target searches the generic pages cannot: `/mosaic-qr-code` (image QR codes), `/qr-code-with-logo`, `/google-review-qr-code`, `/menu-qr-code`, `/instagram-qr-code`, `/whatsapp-qr-code`, `/pdf-qr-code`, `/static-qr-code-generator` (what a static code is and why it never expires), `/svg-qr-code` (vector downloads for print) and `/qr-code-checker`. Each has one block of copy in `src/data/landingPageContent.ts`, and `contentRegistry` builds its entry from that, so the sitemap, breadcrumbs, schema.org data and share image come for free. The generator pages among them (`src/data/landingPages.ts`) open the generator with presets: high error correction and the Logo section expanded for the logo and image pages, the Instagram handle field, and a `https://wa.me/` start for WhatsApp. They use the generator page template above (intro, what happens when it is scanned, use cases, printing, checks, privacy, FAQ).

A page exists only when it adds something to the generic URL page: a preset, instructions or examples. Keep the copy honest: the image page says "no AI" because the picture is tiled into the code with plain arithmetic, the PDF and menu pages say QRCraftly hosts no files, and none of them promises tracking or analytics. The mosaic examples (`/examples/mosaic-halftone.png`, `/examples/mosaic-tiles.png`) are built at deploy time from a picture drawn in code and scan to the site address.
