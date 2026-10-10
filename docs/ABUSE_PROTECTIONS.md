# Abuse protections

This page describes what QRCraftly does today to stop people from using it to make harmful QR codes, and to protect people who scan codes or receive files with it. It describes the code as it is after the abuse-protection work of spec #1150 and is honest about the limits.

Everything below runs in the browser. QRCraftly has no server, sends nothing over the network and keeps no logs, so every check is local and works offline. That also means QRCraftly cannot look up a link's reputation or follow a redirect: it can only reason about the text in front of it.

## Threats in scope

| Threat                     | Example                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------- |
| Script or local-file links | `javascript:alert(1)`, `data:text/html,…`, `file:///etc/passwd`                                           |
| Field injection            | a vCard, calendar event, Wi-Fi or email code with extra fields smuggled in through a newline or separator |
| Dial-string injection      | a phone or SMS code with extra URI parameters                                                             |
| Hostile SVG                | an uploaded logo with `<script>`, event handlers or external references                                   |
| Lookalike links            | `https://xn--pple-43d.com` (`аpple.com` with a Cyrillic "а")                                              |
| Hostile file transfers     | a stream that claims a huge file, a crafted frame, or a received file with a misleading name              |
| Disguised links            | a shortener, an IP address, a `user@host` trick or a look-alike spelling of a brand                       |
| Misleading scanned content | hidden Bcc recipients, dialer codes, text-direction tricks, an address with a typo                        |
| Data leaving the device    | anything that would send scanned or generated content elsewhere                                           |

## Making codes

### Dangerous link schemes are refused

`isDangerousUrl` (`src/utils/url.ts`, re-exported by `src/utils/security.ts`) blocks `javascript:`, `vbscript:`, `jscript:`, `wscript:`, `mocha:`, `file:`, `data:`, `blob:`, `filesystem:`, `mk:`, `about:`, `intent:`, `itms-services:`, `ms-msdt:`, `search-ms:`, `ms-officecmd:`, `jar:` and `view-source:`. Before checking, it:

- decodes up to ten layers of percent-encoding and HTML entities (`&#x6A;`, `&colon;`, `&tab;` and so on, with or without `;`),
- removes control characters, all whitespace and zero-width characters,
- lowercases the result.

So `\tJAVASCRIPT:`, `java&#x09;script:` and `%6Aavascript:` are all caught.

The check runs for **every** type, not only link types: `validatePayload` (`src/packages/qr-payload/lib/registry.ts`) refuses a Text, Phone or Wi-Fi payload that starts with a blocked scheme. Prose that merely mentions `javascript:` mid-sentence still passes. The URL and Meeting types also use an **allowlist** of schemes (`LINK_SCHEME_ALLOWLIST`: http, https, ftp, mailto, tel, sms, geo, maps and the common meeting and chat schemes), so a scheme nobody listed is refused with a plain explanation.

A blocked payload never renders: the matrix worker and the main-thread fallback both run `validateConfig` and show "Generation Blocked". Export is blocked too, with no override: `useQRDownload` refuses every format (PNG, SVG, copy, share, templates and social formats) for a dangerous payload and says "This code contains a script or data link and can't be exported."

### Every payload is checked for hidden characters

`validatePayload` (`src/packages/qr-payload/lib/registry.ts`) rejects control characters and zero-width characters in every type. Text-direction controls (U+061C, U+200E/F, U+202A-202E, U+2066-2069) are refused where real text never needs them: Wi-Fi, Phone, SMS, border text and template text. Text, vCard names and Event titles keep them, because right-to-left text can need them, and the scanner spells them out on display instead. `sanitizeConfig` (`src/packages/qr-payload/lib/validators.ts`) strips them from input, keeping only tab and newline where the format allows them (vCard, Event).

### Formats are escaped, not concatenated

- **vCard and calendar events:** `escapeVCardEvent` (`src/packages/qr-payload/lib/rfcHelper.ts`) escapes backslashes, newlines, semicolons and commas, and lines are folded at 75 bytes, so a field cannot start a new property.
- **Wi-Fi:** `escapeWifi` escapes `\ ; , " :` and the security type must be one of the known values.
- **Email:** the recipient must look like an address and only `subject` and `body` are allowed, so a code cannot add hidden `cc`, `bcc` or extra `to` recipients.
- **Phone and SMS:** `cleanPhoneNumber` keeps only digits and `+ * # - ( ) .` (plus `; ,` for SMS), and `encodeDialString` percent-encodes `%` and `#`, so nothing can be appended as a URI parameter.
- **Payment:** only known networks are offered, amounts are converted or percent-encoded, and addresses are percent-encoded.

### Uploaded images and SVG are sanitised

`sanitizeSvg` (`src/utils/security.ts`) keeps a fixed allowlist of 25 SVG elements (no `script`, `foreignObject`, `a`, `animate` or `set`), removes every `on*` attribute, drops styles that use `@import`, and only allows local references or safe `data:image/*` URIs. It runs on uploaded logos and on every exported SVG. The build's static path tracker (`scripts/static-path-tracker.js`) fails if an SVG reaches the page without passing through it.

### Export safety gate

Before export, the scannability check (`src/packages/scannability`) also runs the dangerous-scheme check. A failing code shows a warning modal before download, but a code with a script or data link is a hard block (see above), not a warning.

### Hints while typing

Under the URL, Meeting, vCard website and Event location and description fields, `analyseLink` (`src/packages/link-safety`, see below) shows a hint once typing pauses. A dialer code in a phone number, an SMS to several numbers or to a short number, and a wallet address that fails its checksum get a note too. Hints never block: the person can ignore every one, and the field points at them with `aria-describedby`.

### Event dates

`formatEventDateTime` never writes an unparseable date through as raw text: it returns nothing, and `EventContract.validate` reports `EVENT_INVALID_DATE_VIOLATION`, so a newline in a date cannot add calendar properties.

### Bulk CSV

Bulk generation is limited to 500 rows and 2 MiB. Every row goes through the same payload checks as the single generator (`validateConfig`), and `generateQRSvg` refuses a rejected payload as a last guard. Blocked rows are skipped and listed on screen, and rows whose address looks disguised are listed as a hint but still generated. File names are sanitised (`sanitizeFileName`: control, zero-width and bidirectional characters removed, `\ / ? : * " < > |` replaced, leading dots dropped, Windows reserved names prefixed, 100 characters max), the ZIP name too, and the ZIP writer refuses absolute paths, backslashes, `..` segments and duplicates.

## Scanning codes

### Blocked results

If a scanned code is a dangerous scheme (same `isDangerousUrl` check), the result sheet shows "Blocked QR code" with no link and only a Copy action (`src/components/scanner/describeScan.ts`, `ScanResultSheet.tsx`). The checker page and the arcade use the same check.

### Only web links can be opened

The result sheet only offers "Open" for `http://` and `https://` links. `tel:`, `sms:`, `mailto:`, `geo:`, `WIFI:`, `intent:`, `otpauth:`, crypto and every other scheme can be copied, shared or opened in the generator, but never launched. This is the main defence against codes that dial premium numbers, send texts, run USSD codes or open apps.

When a link is opened, it opens in a new tab with `rel="noopener noreferrer"`, after a second `isDangerousUrl` check in `ButtonLink`.

### The real destination is shown

The sheet shows the link's actual host as the browser parses it, so `https://paypal.com@evil.example` shows **evil.example**. Hosts written in punycode are shown in Unicode with the ASCII form beside them (`src/utils/hostname.ts`). The `link-safety` package (`src/packages/link-safety`, offline and synchronous) adds notes of two weights. **Cautions** (amber): a `user@host` trick, an IP address in any notation, mixed alphabets, a look-alike of about a hundred brands (UTS #39 confusables for Latin, Cyrillic, Greek and Armenian, plus digit swaps like `paypa1`), a brand named in a subdomain of another site, four or more subdomain levels, and plain `http`. **Notes** (grey): a shortener or redirector, a non-default port, international characters, and a brand named in a sign-in path.

The notes read the address the browser will open, not the raw text: tabs and line breaks are removed and spaces after the host are encoded first, and a trailing dot on the host name is ignored. The Open button uses that same parsed address.

An address with none of these gets neutral wording ("No warning signs found in the address. That is not a guarantee"). The sheet never calls a link safe, because offline text analysis cannot know that. A brand missing from the list is not detected, and a shortener's destination cannot be expanded without a network request.

### Other kinds of code are explained

The result sheet describes what a non-link code does before anyone acts on it (`src/components/scanner/contentNotes.ts`): every mailto recipient with Cc, Bcc and a pre-filled body called out (header names in any case, and every copy of a repeated field); dialer (USSD) codes in `tel:`; texts to several numbers or to a short number; Wi-Fi networks with no password or WEP; wallet addresses checked against their checksum (Base58Check, bech32 and bech32m, EIP-55; Solana has none, so only its shape is checked). Wi-Fi passwords and authenticator (`otpauth:`) secrets are hidden behind a Show button, and Share leaves them out unless the person includes them. Hidden direction and zero-width characters are spelled out as `[U+202E]` in the raw content and values, and the text is isolated with `<bdi>` so it cannot reorder what is around it.

### Content is shown as text

Decoded content is rendered as text, never as HTML. Handing a scanned code to the generator happens in memory, not through the URL, and the generator's own checks run again.

### Camera and images

Camera results need two agreeing reads. Images are decoded off the main thread, and a file over 50 MB or declaring more than 40 megapixels is refused before decoding (`assertImageWithinLimits` reads the size from the header of PNG, JPEG, GIF, WebP, BMP, AVIF, HEIC and TIFF files, so a small file that declares billions of pixels is caught). Other formats are checked as soon as they are decoded, and SVG files are drawn at a fixed 1024 px.

## Receiving files over the camera

- **Strict frame parsing.** Fountain frames must match a strict pattern; CBOR is parsed with a depth limit and no indefinite lengths or trailing bytes; lengths must agree (`src/packages/optical-transfer/lib/prism/frame.ts`, `lib/bcur/uri.ts`, `lib/fountain/cbor.ts`).
- **Size caps.** A receive is limited to 100 MiB (`MAX_RECEIVE_BYTES`, `lib/limits.ts`). A header that claims more, an implausible droplet length, and a video file over 500 MB are refused before anything is allocated. Decompression is streamed into a buffer sized by the header and cancelled at that limit, so a small stream cannot expand into gigabytes. A stream with more than 65,536 blocks needs 8 identical frames in a row before the receiver builds tables for it.
- **Integrity.** A file is only offered once its size and SHA-256 match the manifest (`prism/manifest.ts`). Corrupted frames fail their CRC-32C first, and a manifest whose hash does not match its session ID is ignored.
- **Stream switching.** A different stream must appear for 8 consecutive frames before the receiver switches to it, and a finished stream is ignored afterwards.
- **Names and types.** The file name is sanitised (`sanitizeFileName`) and shown in full with its real extension. A claimed type that does not match the extension is replaced by `application/octet-stream` with a notice, and a double extension like `invoice.pdf.exe` is called out. Executable and script types (`.exe`, `.msi`, `.bat`, `.ps1`, `.js`, `.jar`, `.apk`, `.html` and the rest of the list in `src/utils/fileNames.ts`) are never saved automatically: the Save button asks "This kind of file can run programs on your device. Only save it if you trust the sender." and then reads "Save anyway".
- **No preview of active content.** Only PNG, JPEG, GIF, WebP, PDF and plain text can be opened in a tab or shown as a thumbnail, using the effective type. SVG, HTML and everything else is saved, never rendered. Downloads use a Blob URL with the `download` attribute, and the site sends `X-Content-Type-Options: nosniff`.
- **Old formats.** The `H|`/`F|` carousel and the old `ur:bytes/` droplets are no longer read. Real BC-UR streams from wallets go to their own decoder (`lib/bcur`), which refuses a part claiming more than the receive limit or more than 65,536 fragments.

## Platform protections

| Protection                                                                                                                                                                                                                                                                                                    | Where                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Content Security Policy: scripts only from the site plus hashes of its own inline scripts, `wasm-unsafe-eval` for the site's own WebAssembly modules only, `object-src 'none'`, `connect-src 'self'`, `form-action 'self'`                                                                                    | `scripts/csp_hash_injector.js`, `src/layouts/Head.tsx` |
| `X-Frame-Options: DENY`, `nosniff`, strict referrer policy, HSTS with `includeSubDomains`, Permissions-Policy (camera and location for this site only; microphone and payment off)                                                                                                                            | `public/_headers`                                      |
| The production bundle may not call `fetch`, XHR, WebSocket or `sendBeacon` except at reviewed call sites, and never `/api/`                                                                                                                                                                                   | `scripts/bundle_ast_audit.js`                          |
| Semgrep rules (severity ERROR, with fixtures in `tests/semgrep/`, run by `pnpm run test:semgrep`): anchors, `ButtonLink`, `window.open`, `location` and `navigate()` targets must pass `isDangerousUrl`; JSON-LD must use `safeJsonLdStringify`; `tel:`, `sms:` and `smsto:` URIs must use `cleanPhoneNumber` | `semgrep.yml`                                          |
| `eslint-plugin-security`                                                                                                                                                                                                                                                                                      | `eslint.config.js`                                     |

## Known limits

- The receiver checks integrity, not who sent the file: any stream in front of the camera can replace the current one after 8 identical frames.
- Link analysis is text only. It cannot expand a shortener, check a site's reputation or know a brand that is not on its list, and it never says a link is safe.
- The Semgrep phone rule matches only simple `tel:${x}` and `sms:${x}` shapes, not a longer template with a query string.
- Trusted Types (`require-trusted-types-for 'script'`) was evaluated and is **not** enabled. With it on, every `new Worker(url)` (matrix, maze, scanner, scannability, image-resize and file-transfer workers) and the service worker registration throw, because their script URLs are plain strings. Enabling it needs a reviewed policy that wraps same-origin script URLs, plus a Playwright run for each worker. The app has no other known sink, so this is a defence in depth item, tracked as a follow-up.
- HSTS `preload` is a separate decision that affects the whole domain and is left to the site owner.

## What QRCraftly will never do to fix these

No link reputation lookups, no URL expansion through a server, no analytics on what people scan or make, and no accounts. Every protection must work offline and must not get in the way of someone making or scanning an ordinary code.

## Private transfers and bundles

Private mode and bundle handling are specified in [ADR 0025](./adr/0025-private-transfers-and-bundles.md). A receiver with a key set accepts only private transfers, and bundle paths are sanitized before any file is offered for saving.

The sender shows the key code's words, and its key QR, only while their button is held, so they are not on screen beside the stream by default. From the moment Start is pressed until the transfer stops, Private, Wallet-compatible, density and the other stream settings cannot be changed, so a switch never shows a setting the running stream does not use.
