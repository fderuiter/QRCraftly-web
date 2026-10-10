# Security Policy

## CI/CD Security Governance

To protect against supply-chain attacks, this project enforces immutable dependency pinning for all CI/CD components.

- **Versioning Standard**: All third-party GitHub Actions must be pinned to specific, immutable SHA-1 hashes instead of mutable version tags (e.g., `@v4`). Each pinned hash must be accompanied by a human-readable comment specifying the original version tag (e.g., `# v4.1.0`) to maintain readability.
- **Automated Monitoring**: Dependabot is configured to check for updates to external CI/CD dependencies weekly to ensure workflows are running the latest security patches.
- **Remediation**: In the event a vulnerable action is identified or an automated update PR is generated, developers must review the PR, verify the hash corresponds to the legitimate version update, and merge the update immediately. Any new workflows introduced must adhere to this pinning standard.

## Supply Chain

What ships to the browser is our code plus the packages in `pnpm-lock.yaml`, built by tools from the same lockfile. The policy below keeps a dependency or build tool from slipping code into the static bundle ([#1351](https://github.com/fderuiter/QRCraftly-web/issues/1351)). `tests/supply_chain_policy.test.ts` checks each rule against the files that carry it.

- **One lockfile, frozen in CI.** `packageManager` pins the exact pnpm version. CI installs only with `pnpm install --frozen-lockfile`, so a `package.json` change without the matching lockfile change (lockfile drift) fails the install. Every package resolves from the npm registry with a SHA-512 integrity hash; there are no git, tarball or directory dependencies.
- **Install scripts.** `strictDepBuilds: true` in `pnpm-workspace.yaml` fails an install when a package wants to run an install script that nobody approved. `allowBuilds` approves only `esbuild` and `workerd` (both download their native binary); `sharp` is listed as refused. Approving another package lets its script run on every developer machine and in CI, so it needs the script reviewed first.
- **Release age.** `minimumReleaseAge: 1440` makes pnpm refuse a version published less than a day ago, the window in which most hijacked releases are found and pulled. A pinned exception goes in `minimumReleaseAgeExclude` with the exact version.
- **New dependencies.** A runtime dependency needs its own ADR and an entry in `ALLOWED_DEPENDENCIES` (`scripts/dependency_compliance.js`); a dev dependency needs a reason in its PR and a row in [FOUNDRY.md](./FOUNDRY.md) ([ADR 0040](./adr/0040-in-house-first.md)). Our Rust crates use no third-party crates (`scripts/rust_no_deps_check.js`).
- **Updates and advisories.** Dependabot opens update PRs for npm (daily), GitHub Actions and pip (weekly); each goes through the full CI like any other PR, and the reviewer checks the changelog and that the new version comes from the expected publisher. `pnpm audit --audit-level=high` runs in every CI run, and the Audit workflow fails on moderate advisories. A finding is fixed by updating or overriding the package (`overrides` in `pnpm-workspace.yaml`), never by switching the audit off.
- **CI tooling.** Third-party Actions are pinned to commit SHAs (see above), Semgrep installs from a hash-pinned `requirements.txt`, and workflow scripts take untrusted values through `env:` only (`tests/workflow_hardening.test.ts`).
- **The emitted files.** The last postbuild step, `scripts/emitted_asset_audit.js`, reads `dist/client` as it will ship and fails the build if HTML loads a script, style, frame, image or form target from another origin, if CSS imports or references another origin, if JavaScript opens a WebSocket or names a host that is not on its reviewed list, or if any file holds a credential (the strict patterns from `scripts/secret-scanner.js`) or a private key. The reviewed hosts are link targets and payload formats (`wa.me`, `calendar.google.com`), XML namespaces and library error messages, each listed with its reason. A new host means a dependency or a change started naming it: check why, then add it with the reason or remove it.

The owner confirms the repository settings that code cannot check: Dependabot alerts and secret scanning on, and who may approve a Dependabot PR.

## Privacy & Compliance

This application is designed with a "Privacy First" architecture. Please refer to [COMPLIANCE.md](public/COMPLIANCE.md) for detailed information on how this application handles data and aligns with regulations like HIPAA.

## Content Security Policy (CSP)

Our application utilizes a multi-layered Content Security Policy (CSP) enforced via both meta tags and HTTP response headers. To protect production deployments from script-injection (XSS) attacks, our build pipeline automatically parses compiled static HTML assets and computes SHA-256 integrity hashes for all inline scripts (such as JSON-LD structured blocks, framework hydration elements and the pre-hydration theme initialisation script from `src/utils/theme.ts` and the deferred page-script loader from `scripts/defer_page_scripts.js`, both of which must remain static strings so their hashes are stable). Consequently, `script-src 'unsafe-inline'` is completely absent from production deployments. (`style-src 'unsafe-inline'` remains, because React renders dynamic preview styles as inline `style` attributes.) `script-src` also carries `'wasm-unsafe-eval'`, which allows WebAssembly compilation (never JavaScript `eval`) for QRCraftly's own Rust modules (`src/wasm/`, built from `crates/`, see [ADR 0033](./adr/0033-rust-webassembly-modules.md)). The scanner's third-party zxing-wasm reader, which first needed it, was replaced by our own decoder ([ADR 0036](./adr/0036-in-house-qr-decoder-replaces-zxing-wasm.md)), so no third-party WebAssembly ships. They import nothing from JavaScript, so they cannot reach the network or the DOM, and `src/packages/wasm-runtime` loads them from the site's own origin only. The modules are `selftest`, which proves the build and the loader; `qr-encode`, the QR encoder; `qr-decode`, the QR decoder ([#1178](https://github.com/fderuiter/QRCraftly-web/issues/1178)); `prism-fec`, the file transfer's outer code; and `modem`, the optical modem's kernels ([#1198](https://github.com/fderuiter/QRCraftly-web/issues/1198)). The decoder reads camera frames and uploaded images, so it treats every byte as untrusted: it checks claimed sizes before allocating, caps the frame size and the candidates it tries, and never panics on any input (`crates/qr-decode/tests/fuzz.rs` feeds it random and mutated requests, data streams and grids). In local development environments, a permissive fallback policy is utilized to allow unimpeded feature iteration.

The base policy lives in two places that must stay byte-identical: the meta tag in `src/layouts/Head.tsx` and `BASE_CSP_PATTERN` in `scripts/csp_hash_injector.js`. A unit test fails the build if they drift apart.

In the generated `_headers` file, only the global `/*` rule sets `Content-Security-Policy`, and it carries the inline script hashes of every page. Cloudflare joins a header set by several matching rules into one comma-separated value, and a browser enforces each policy in it, so a second, route-level rule would intersect with the global one and block that route's extra scripts. Each page's meta tag still lists only that page's hashes, so the effective policy on every page is its own. `scripts/csp_hash_injector.js` fails the build if more than one rule sets the CSP, or if `_headers` passes Cloudflare's 8 KB limit.

- **No third-party origins:** The app no longer loads web fonts from Google Fonts; text renders with the system font stack (Tailwind's default `font-sans` and `font-mono`). Every directive therefore allows only `'self'`, plus the `data:` and `blob:` schemes where they are needed. No visitor IP address or referrer is sent to a font CDN. If a brand typeface is added later, bundle it with the app (for example from an `@fontsource` package) and keep `font-src 'self'`.
- **`img-src 'self' data: blob:`:** SVG export rasterizes its `blob:` object URL to check that the code scans, and the logo resize fallback decodes uploads through `blob:` URLs.
- **`media-src 'self' blob:`:** The file-transfer receiver plays recorded video files through `blob:` object URLs. (The generator's scanner reads images only.)
- **Regression coverage:** The `chromium-csp` Playwright project runs `e2e/csp-enforcement.spec.ts` against the built app with `bypassCSP: false`, so a policy that breaks SVG export fails in CI. The other projects still bypass CSP.

## Permissions Policy

`public/_headers` sends `Permissions-Policy: camera=(self), microphone=(), geolocation=(self), payment=()`. The camera is available to the site itself for the optical scanner, and to no embedded or cross-origin frame. Geolocation is limited to the site itself, for "Use Current Location" on the Location QR type. The microphone and payment are disabled, since no feature uses them. An empty allowlist `()` turns a feature off for the site itself too, so never use `()` for a feature the app calls. `tests/security_headers.test.ts` checks these values.

## Production Headers & Deployment Integrity

The headers in `public/_headers` only matter if the host sends them, so the Verify Production Deployment job checks the live site after every merge to `main`, and the Release workflow checks `qrcraftly.com` after every release (`e2e/production-headers.spec.ts`, [#1353](https://github.com/fderuiter/QRCraftly-web/issues/1353)). Over plain HTTP, without a browser that could bypass the CSP, it checks:

- every page, the 404 page, `sw.js`, `manifest.json` and both kinds of redirect (a retired route from `_redirects` and a dropped trailing slash) carry each header in the `/*` block of `public/_headers` with the same value;
- every page sends a Content Security Policy with `default-src 'self'`, `object-src 'none'`, no `'unsafe-inline'` or `'unsafe-eval'` scripts and no third-party origin, identical to the page's own `<meta http-equiv>` policy;
- only `*.workers.dev` hosts send `X-Robots-Tag: noindex`;
- `/version.json` reports the commit (or release) being verified, and every file the service worker precaches is still served byte for byte: its SHA-256 must match the revision `sw.js` was built with.

`sw.js` is generated after every build step that rewrites HTML or `_headers`, and its build hash covers `_headers` and `_redirects` ([#1261](https://github.com/fderuiter/QRCraftly-web/issues/1261)), so a header-only fix still installs a new service worker and replaces returning visitors' cached homepage.

**Drift.** A failure in that job means production is not serving what `main` built: a header missing or changed by a dashboard rule (Transform Rules, Page Rules, a custom domain setting), a file changed after the build, or a deployment that did not come from Workers Builds. The failure lists every header or file that differs. To check by hand, compare `curl -sI https://qrcraftly.com/` with `public/_headers` and the `commit` in `https://qrcraftly.com/version.json` with `main`.

**Recovery.** First stop the cause: remove the dashboard rule, or find who deployed and with which token. Then put production back on a known build: roll back to the previous version in the Cloudflare dashboard (Workers & Pages, `qrcraftly`, Deployments) or with `wrangler rollback`, or merge a revert PR so Workers Builds redeploys `main`. Re-run the Verify Production Deployment job to confirm. These steps need Cloudflare access, so they are the owner's to take.

## Reporting a Vulnerability

If you discover a security vulnerability or a privacy leak, please report it immediately.

### How to Report

Please use the [GitHub Security Advisory](https://github.com/fderuiter/QRCraftly-web/security/advisories/new) to report vulnerabilities directly to the maintainers. We will acknowledge your report within 48 hours.

### Scope

- **In Scope:**
  - Data leaks (e.g., data being sent to a server).
  - XSS vulnerabilities.
  - Improper configuration of the client-side generator (including vCard 2.1, 3.0, 4.0, and MECard formats).
  - Bulk CSV processing (including the link or plain text content type), custom PNG export resolution settings, & batch ZIP generation privacy boundary violations.
- **Out of Scope:**
  - Physical security of the user's device.
  - Browser-level vulnerabilities.

## Phone & Social Handle Sanitization & Validation

To prevent injection of arbitrary characters or command payloads into telephone, SMS, or social profile QR codes, the application runs strict sanitization routines entirely on the client side:

- **General Phone Validation**: By default, general telephone input values are cleaned to remove all non-numeric and non-standard telephone symbols, and semicolons are stripped. A `,` dial pause is kept. An extension at the end (`x89`, `ext. 89`, `;ext=89`) is split off first and written as RFC 3966 `;ext=89`, so its digits are never run into the number. The phone and SMS forms list any typed characters the code leaves out.
- **SMS Multi-Recipient Isolation**: To support advanced client-side SMS campaign configurations, the SMS generator uses an isolated sanitization option that preserves semicolons and commas, while rejecting letters, other symbols, and line-break control characters.
- **URI Delimiter Encoding**: After sanitization, `#` in a dial string is percent-encoded as `%23` (RFC 3966) so it cannot start a URI fragment and truncate the number. Mailto recipients (including optional CC and BCC recipients) are percent-encoded (RFC 6068, keeping `@`) so `?`, `&`, and `#` in the address cannot inject headers, and crypto wallet addresses, SEPA transfer fields, and fiat payment handles (PayPal, Venmo, Cash App) are sanitized and percent-encoded so `&` or `#` cannot inject payment parameters.
- **Social Handle Sanitization**: Social profile handles (`SocialPlatform` in `src/types.ts`) strip leading `@` signs and path-injection characters using `sanitizeSocialHandle` before constructing deep link URLs for Instagram, Twitter / X, TikTok, LinkedIn, YouTube, Facebook, WhatsApp, and GitHub.

## SVG Sanitization & Path Tracking

To prevent custom SVG logo uploads and native vector exports from exposing users to DOM-XSS and structural XML injection, QRCraftly incorporates two security controls:

- **Static Path Tracking**: The build pipeline and pre-commit checks automatically trace data flows across files. They detect and block any unvalidated path where raw/external SVG code might reach rendering/storage sinks without passing through `sanitizeSvg()`.
- **Mosaic QR Images**: A mosaic design (`QRConfig.mosaicImageUrl`, ADR 0019) goes through the same `useImageUpload` validation, SVG sanitization and resizing as a logo. It is decoded on the device into an in-memory cache of at most four images, never written to browser storage and never sent over the network.
- **Runtime SVG Sanitization**: Uploaded logos and border images are processed entirely within the client browser to maintain offline privacy. The runtime parser enforces a zero-trust strict safe-element allowlist and zero-tolerance styling:
  - Discards any elements not present on a strict safe-element allowlist (such as `<foreignObject>`, `<embed>`, `<object>`, `<script>`, etc.).
  - Discards `<style>` blocks and element `style` attributes entirely if they contain `@import`, `image-set()` (which loads a bare string without `url()`), `expression()` or `javascript:`.
  - Limits nested data URIs to safe image MIME-types and strips any with active payload markers or script references. A base64 PNG, JPEG, GIF or WebP must start with that format's file signature and is not searched for text, because random base64 can spell `onload` by chance. SVG data and plain-text data are searched for script markers after decoding. This is validated by an optimized, localized helper function within the security utility to ensure clean code and prevent unused export overhead.
  - Strips all inline event handlers (attributes starting with `on`).
  - Neutralizes any remote or dangerous resource requests inside style blocks, style attributes, or `href`/`xlink:href` references (matched by local name, so the XLink attribute is caught under any prefix) while preserving standard layout paths, responsive viewBox attributes, linear gradients, and clip paths.

## Persistent Browser Storage Allowlist

The build and pre-commit pipelines run static AST analysis (`scripts/storage_privacy_ast_auditor.js`) on source code before compilation. It scans for browser persistent storage operations (`localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`, `caches`) and enforces an explicit allowlist of authorized keys (`qrcraftly:theme`, `qrcraftly:brand-templates`, `__test__`). The `qrcraftly:theme` key stores only the visitor's colour-theme preference (`light`, `dark` or `system`). The `qrcraftly:brand-templates` key stores user-saved visual brand templates (capped at 50 templates; visual styling parameters only, never QR payload content, border or template text, or uploaded images). Any attempts to persist transient QR payload data or use unapproved keys immediately abort the build.

## QR Animation Loops

Animation configuration structures in `types.ts` are strictly statically typed to prevent any runtime execution or script-injection pathways during high-frequency loop playbacks.

## Playable Maze Overlay & Web Calendar Integration

Maze overlay configurations in `types.ts` (e.g., `isMazeEnabled`, `isMazeBridgesEnabled`, `mazeColor`, `mazePathWidth`, `showMazeSolution`) are statically typed and strictly validated at runtime. This prevents injection or path manipulation during maze rendering. Web calendar providers and iCalendar event types (`EventData` and `CalendarProvider` in `types.ts`) construct direct calendar URLs and VEVENT payloads with optional explicit IANA / UTC timezones, validating all parameter links with `isDangerousUrl` to prevent URI injection attacks.

## Independent Eye Colors

Finder pattern color properties in `types.ts` (`eyeFrameColor` and `eyeBallColor`) are statically typed visual parameters. They allow distinct outer frame and inner eyeball styling while falling back safely to `eyeColor`.

## Custom Frame Shapes and CTA Badges

Custom frame shape and call-to-action (CTA) badge configurations in `types.ts` (e.g., `frameStyle`, `frameText`, `frameTextColor`, `frameBgColor`, `framePosition`, `frameIcon`) are strictly statically typed. The `frameText` field is validated via `validateConfig()` to reject control or BiDi characters, sanitized client-side without external persistence, and checked for minimum WCAG AA contrast (>= 4.5:1) in real time.

## Gradient Color Controls

Gradient color configurations in `types.ts` (`gradientType`, `gradientColorStops`, `gradientAngle`) are strictly statically typed and validated on the client side during canvas matrix rendering, preserving local processing with zero external script execution.

## JSON-LD Caching & Performance Security

Structured data is rendered by the server-only Head at prerender time ([ADR 0034](./adr/0034-page-content-at-prerender.md)). To keep repeated renders cheap, the application caches serialized and escaped JSON-LD schema strings. Since JSON-LD requires synchronous regex replacement of unsafe characters (such as `<` and `>`), caching the computed string primitives protects the main thread from CPU-heavy operations while keeping cache keys lightweight and clean of memory leaks. The escaping itself lives in `safeJsonLdStringify` (`src/utils/security.ts`): it serialises any JSON value and rewrites `<`, `>` and `&` as `\u003c`, `\u003e` and `\u0026`, so schema text can never close the surrounding `<script>` element. `JsonLdScript` (`src/components/ui/JsonLdScript.tsx`) is the component that injects the result.

## Browser Trust Boundaries

QRCraftly reads untrusted text from five places: what a person types, files they upload (logos, mosaic pictures, CSV, brand templates), pictures and camera frames they scan, files received through the file transfer, and the page's own URL. None of it may become script, markup or a navigation the person did not choose ([#1350](https://github.com/fderuiter/QRCraftly-web/issues/1350)). React renders all of it as text by default, so the risk sits in the few places that turn text into something else. These are all of them; `tests/xss_sink_inventory.test.ts` fails when a new one appears, until it is reviewed and listed here.

| Sink                   | Where                                                      | Input                                            | Control                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw HTML               | `JsonLdScript`, `Head.tsx`                                 | Build-time data, a static theme script           | `safeJsonLdStringify` escapes `<`, `>` and `&`; the theme script is a constant allowed by its CSP hash                                                                                                   |
| Raw HTML               | `SanitizedHtml` on `/security`                             | Docs compiled from this repository at build time | Never runs on user input; the page reads its own prerendered HTML back                                                                                                                                   |
| Markup parser          | `useImageUpload`, `sanitizeSvg`                            | An uploaded SVG logo or mosaic                   | Parsed into an inert document, then `sanitizeSvg` (below) before it is shown, stored in memory or exported                                                                                               |
| Markup parser          | `vectorScene` (EPS and PDF export)                         | Our own SVG export                               | Inert document; only shapes, colours, text and inlined image data URLs are read                                                                                                                          |
| Object URL             | Downloads, SVG rasterising, image resizing, a chosen video | Bytes we made or the person chose                | Used as a download, an `<img>` or a `<video>`, never as a document                                                                                                                                       |
| Object URL and new tab | `TransferComplete`                                         | A received file                                  | Only PNG, JPEG, GIF, WebP, PDF and plain text open in a tab; a type that disagrees with the name is saved as `application/octet-stream`; risky types need a second click to save (`analyseReceivedFile`) |
| Link                   | Scan results, payload previews                             | Text from a scanned code                         | `isDangerousUrl` refuses script and data links before an Open button exists; the text itself renders as text                                                                                             |
| Navigation             | `StressTestButton`, the scanner's Open in generator        | Fixed paths                                      | No user text reaches the URL                                                                                                                                                                             |
| Worker messages        | Every worker                                               | Messages from our own page                       | Workers are same-origin; there is no `window` message listener, so other sites cannot post into the app                                                                                                  |

There is no `eval`, `new Function` or string timer anywhere in `src/`.

**Tests.** `src/utils/xssRegression.test.ts` runs a corpus of known SVG and URL attacks (script and foreign elements, mixed-case handlers, `<animate>` and `<set>` rewriting a link, XLink under another prefix, remote images, `@import`, `image-set()`, `expression()`, entity- and whitespace-obfuscated `javascript:` links) and checks that nothing active survives. `e2e/xss-regression.spec.ts` types markup into the generator, uploads a hostile SVG logo and scans a code that holds markup, then checks that no script ran, no dialog opened, no request left for the attacker's host and the SVG export holds no active content. Those Playwright projects bypass the CSP on purpose: the app must stay safe on its own, and the CSP is a second layer.

**Trusted Types.** `require-trusted-types-for 'script'` stays off for now ([#1172](https://github.com/fderuiter/QRCraftly-web/issues/1172), the owner's call). Turning it on needs a policy for the worker and service worker script URLs and for the three `DOMParser` calls above, which also count as sinks under Trusted Types. The inventory test is the list a policy would have to cover.

## URL Sanitization & DOM-XSS Protection

To prevent DOM-based Cross-Site Scripting (DOM-XSS) via dynamic anchors and `href` bindings of user-controlled URLs, we enforce strict URL sanitization:

- **Link scheme check (`isDangerousUrl`)**: Every dynamic value destined for an anchor `href`, `window.open`, `location` or `navigate()` call must pass `isDangerousUrl`, which refuses `javascript:`, `data:`, `vbscript:` and the other blocked schemes after decoding obfuscation. Like a URL parser, it drops control and zero-width characters anywhere and whitespace only at the start, so `java\tscript:` is refused but prose such as `About: us` or `File: invoice.pdf` is not a scheme. Script schemes are refused even with a space after the colon. Semgrep enforces this (`require-isdangerousurl` in `semgrep.yml`, with fixtures in `tests/semgrep/`). The older `sanitizeHref` helper is gone: it would have let a protocol-relative `//host` address through and nothing used it.
- **HTML Meta-Character Escaping (`escapeHtml`)**: In addition to scheme enforcement, values rendered as text nodes or embedded inside anchor tag `href` links are escaped. This safely converts characters like `&`, `<`, `>`, `"`, and `'` into their respective HTML entity equivalents (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`), entirely neutralizing DOM reinterpretation risks and ensuring robust DOM-XSS protection.

## Network Requests

QRCraftly is a static site: the browser downloads its files and then works on the device ([#1352](https://github.com/fderuiter/QRCraftly-web/issues/1352)). This is every request it makes.

| When                          | What the browser requests                                                                                                                                                                          | What never happens                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Opening any page              | The page and its own scripts, styles, images and `manifest.json` from this site. The service worker then precaches the homepage shell.                                                             | No font, script, image or analytics from another site                                    |
| Moving between pages          | The next page's `pageContext.json` and scripts, from this site or the service worker's cache                                                                                                       | No query strings or form posts                                                           |
| Making and downloading a code | Scripts, workers and WebAssembly modules the generator loads on first use, from this site                                                                                                          | The content, colours and logo stay in memory; downloads are made on the device           |
| Scanning (camera or picture)  | The scanner worker and the `qr-decode` module on first use                                                                                                                                         | Camera frames and pictures never leave the device; scanned text is only shown and copied |
| File transfer                 | The transfer page's scripts, workers and modules on first use                                                                                                                                      | The file travels from screen to camera only                                              |
| "Use Current Location"        | Nothing from QRCraftly; the browser asks the device for a position                                                                                                                                 | The position goes into the code only                                                     |
| Following a link              | Only when the person clicks it: a link in the page, or Open on a scan result                                                                                                                       | Nothing opens by itself                                                                  |
| Updates                       | The browser rechecks `sw.js` on navigation; a new build replaces the cache ([#1259](https://github.com/fderuiter/QRCraftly-web/issues/1259))                                                       |                                                                                          |
| Offline                       | Nothing: after one visit the homepage generator works from the cache ([#1262](https://github.com/fderuiter/QRCraftly-web/issues/1262)), and other pages and tools after they were used once online |                                                                                          |

Every request goes to the site's own origin, as a `GET`, without a body. The host still sees each request's address, path, time and browser (see [COMPLIANCE.md](public/COMPLIANCE.md)), but never what a person typed, scanned or sent.

How this is enforced:

- The CSP sets `default-src 'self'` and `connect-src 'self'`, so the browser itself refuses other origins.
- `scripts/bundle_ast_audit.js` allows `fetch` only at reviewed call sites and refuses `WebSocket`, `XMLHttpRequest` and `sendBeacon`; `scripts/emitted_asset_audit.js` refuses resources from other origins in the built HTML and CSS (see Supply Chain).
- Every Playwright test runs behind `e2e/fixtures.ts`, which fails the test on any request to another origin (a person's click to another site aside) and on any request that is not a `GET` or `HEAD` or carries a body.
- `e2e/network-privacy.spec.ts` types a unique secret into the link, text and Wi-Fi generators and downloads the codes, and scans a picture that holds one; `e2e/file-transfer.spec.ts` sends a file whose name and bytes hold one. Each test fails if the secret appears in any request, even to this site, or if any request has a query string. The same spec checks that the QR code checker still reads a picture after the server has gone.

## No Server API

QRCraftly has no server code and no API: production serves static files only, and there are no dynamic (redirect) QR codes ([ADR 0022](adr/0022-no-dynamic-qr-codes-client-side-only.md)). There is therefore no database, bot check or rate limiter to defend. `scripts/bundle_ast_audit.js` fails the build if compiled code calls any same-origin `/api/` path.
