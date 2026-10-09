# Security Policy

## CI/CD Security Governance

To protect against supply-chain attacks, this project enforces immutable dependency pinning for all CI/CD components.

- **Versioning Standard**: All third-party GitHub Actions must be pinned to specific, immutable SHA-1 hashes instead of mutable version tags (e.g., `@v4`). Each pinned hash must be accompanied by a human-readable comment specifying the original version tag (e.g., `# v4.1.0`) to maintain readability.
- **Automated Monitoring**: Dependabot is configured to check for updates to external CI/CD dependencies weekly to ensure workflows are running the latest security patches.
- **Remediation**: In the event a vulnerable action is identified or an automated update PR is generated, developers must review the PR, verify the hash corresponds to the legitimate version update, and merge the update immediately. Any new workflows introduced must adhere to this pinning standard.

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

## Reporting a Vulnerability

If you discover a security vulnerability or a privacy leak, please report it immediately.

### How to Report

Please use the [GitHub Security Advisory](https://github.com/fderuiter/QRCraftly-web/security/advisories/new) to report vulnerabilities directly to the maintainers. We will acknowledge your report within 48 hours.

### Scope

- **In Scope:**
  - Data leaks (e.g., data being sent to a server).
  - XSS vulnerabilities.
  - Improper configuration of the client-side generator (including vCard 2.1, 3.0, 4.0, and MECard formats).
  - Bulk CSV processing, custom PNG export resolution settings, & batch ZIP generation privacy boundary violations.
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
  - Discards `<style>` blocks and element `style` attributes entirely if they contain any `@import` reference.
  - Limits nested data URIs to safe image MIME-types and strips any with active payload markers or script references. This is validated by an optimized, localized helper function within the security utility to ensure clean code and prevent unused export overhead.
  - Strips all inline event handlers (attributes starting with `on`).
  - Neutralizes any remote or dangerous resource requests inside style blocks, style attributes, or `href`/`xlink:href` references while preserving standard layout paths, responsive viewBox attributes, linear gradients, and clip paths.

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

## URL Sanitization & DOM-XSS Protection

To prevent DOM-based Cross-Site Scripting (DOM-XSS) via dynamic anchors and `href` bindings of user-controlled URLs, we enforce strict URL sanitization:

- **Link scheme check (`isDangerousUrl`)**: Every dynamic value destined for an anchor `href`, `window.open`, `location` or `navigate()` call must pass `isDangerousUrl`, which refuses `javascript:`, `data:`, `vbscript:` and the other blocked schemes after decoding obfuscation. Like a URL parser, it drops control and zero-width characters anywhere and whitespace only at the start, so `java\tscript:` is refused but prose such as `About: us` or `File: invoice.pdf` is not a scheme. Script schemes are refused even with a space after the colon. Semgrep enforces this (`require-isdangerousurl` in `semgrep.yml`, with fixtures in `tests/semgrep/`). The older `sanitizeHref` helper is gone: it would have let a protocol-relative `//host` address through and nothing used it.
- **HTML Meta-Character Escaping (`escapeHtml`)**: In addition to scheme enforcement, values rendered as text nodes or embedded inside anchor tag `href` links are escaped. This safely converts characters like `&`, `<`, `>`, `"`, and `'` into their respective HTML entity equivalents (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`), entirely neutralizing DOM reinterpretation risks and ensuring robust DOM-XSS protection.

## No Server API

QRCraftly has no server code and no API: production serves static files only, and there are no dynamic (redirect) QR codes ([ADR 0022](adr/0022-no-dynamic-qr-codes-client-side-only.md)). There is therefore no database, bot check or rate limiter to defend. `scripts/bundle_ast_audit.js` fails the build if compiled code calls any same-origin `/api/` path.
