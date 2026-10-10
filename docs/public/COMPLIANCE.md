---
publish-approved: true
---

# Privacy and Compliance

What QRCraftly does with the data you put into it, what our host can see, and what that means if you work under HIPAA or similar rules. The plain-language version is [the QRCraftly Pledge](https://qrcraftly.com/free-forever).

## Where your data goes

QRCraftly makes QR codes in your browser. What you type, upload or scan is not sent to a server, so it can be used for codes that hold protected health information (PHI) without that information reaching us.

- **Local Processing:** All QR code generation (including vCard 2.1, 3.0, 4.0, and MECard contact payloads) happens locally within the user's browser using HTML5 Canvas and JavaScript.
- **Data Transmission:** The sensitive data you enter to generate a QR code (which may include PHI) remains strictly in your device's memory and is not sent to our servers.
- **Volatile Memory:** QR content you enter is held only in memory and is cleared when the browser tab is closed or refreshed. The only values written to persistent browser storage are the keys listed under Technical Safeguards below.
- **Undo History and Style Files:** The generator keeps up to 50 appearance steps for Undo and Redo in volatile memory only; QR content is never part of a step, and a reload clears them. A style file (`.qrcraftly.json`) is a download you choose to make: it holds colours, pattern and layout settings only (never the QR value, text or uploaded images), and loading one accepts only a fixed set of known settings.
- **Brand Template Gallery Records:** Custom brand design templates saved by users are persisted in browser `localStorage` under `qrcraftly:brand-templates` (capped at 50 templates). Stored template records contain visual style settings only (colors including independent eye frame and ball colors, linear and radial gradient settings, pattern styles, borders, logo size and padding) and never store QR payload content, border or template text, or uploaded images such as logos and mosaic pictures. The style values in a record are the fixed strings defined in `src/types.ts` (for example `circuit` or `H`), which did not change when those value sets moved from TypeScript enums to plain constant objects.
- **Mosaic QR Images:** An uploaded mosaic design and its decoded pixels are kept only in volatile memory (at most four decoded images) and are never persisted or uploaded.
- **Animation Loop Frames:** Any cached frames or matrices generated for animation loops are also kept solely in volatile client-side memory.
- **Playable Maze Overlay:** All coordinates, keep-out boundary zones, scannability-audited finder pattern bridge channels, and solutions computed for the playable maze overlay are processed completely in-memory locally in the user's browser, ensuring absolute privacy and data isolation.
- **Custom Frame Shapes and CTA Badges:** Frame CTA text (`frameText`) and styling parameters are rendered locally in browser volatile memory, sanitized against control characters, and never transmitted over the network or saved to persistent storage.
- **Bulk CSV Batch Processing:** An uploaded CSV, the rows parsed from it (at most 500 per batch), the chosen content type (link or plain text), configured PNG export resolution settings, and the QR codes and ZIP archive built from them stay in volatile memory on the main thread. The parser and ZIP writer are local code (`src/packages/bulk-csv/`) with no network access, nothing is persisted, and the download's Blob URL is revoked right after the download starts.
- **Calendar Event Processing:** Calendar events (including explicit IANA or UTC timezone selections) and web calendar links (Google Calendar, Outlook Web, Office 365, Yahoo Calendar) are built in client-side memory; QRCraftly sends them nowhere. An iCalendar (.ics) code keeps the event inside the code. A web calendar code is a link that carries the title, times, location and description, so when someone scans it and opens the link, that provider (Google, Microsoft or Yahoo) receives those details. Use iCalendar, the default, for events that contain PHI. The generator says this under the calendar choice.
- **Social Media Profile Links:** Social profile handles entered for supported platforms (Instagram, Twitter / X, TikTok, LinkedIn, YouTube, Facebook, WhatsApp, GitHub) are processed entirely in browser memory to construct standard HTTPS universal profile links and are never transmitted over the network or saved to persistent storage.

Anyone who scans a code can read what is in it. Keeping a code private is up to where you print or show it.

## What the host can see

QRCraftly has no analytics, telemetry, diagnostics or logs of its own. The site is static files served by Cloudflare (Workers Static Assets, with no server code of ours).

- Cloudflare handles every request for a page or file. Like any web host it processes the IP address, browser user agent, page address (such as `/` or `/about`) and time, to deliver the site and protect it from attacks, under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/). The project owner sees only totals such as request counts in the Cloudflare dashboard.
- If Cloudflare's bot protection is switched on, it may set a short-lived security cookie. It is not used for tracking.

What is never part of a request:

- Anything you type, including email CC and BCC addresses, Wi-Fi passwords and WPA2-Enterprise identity fields, and payment details such as crypto addresses, IBANs and payment handles.
- The QR codes and files you make.
- Diagnostics. Scan and scannability failures are handled on your device and not reported.

## Technical safeguards

- **HTTPS.** Every connection to the site uses HTTPS.
- **Nothing in the address bar.** User input is never put in URL query parameters (such as `?data=...`), so it cannot end up in browser history, proxy logs or server logs.
- **Storage allowlist.** Before every build, `scripts/storage_privacy_ast_auditor.js` checks every use of persistent browser storage against an allowlist: `qrcraftly:theme` (light, dark or system), `qrcraftly:brand-templates` and the `__test__` probe key. Anything else fails the build.
- **No unreviewed network calls.** The site's Content Security Policy lets the browser connect only to QRCraftly itself, and `scripts/bundle_ast_audit.js` fails the build if shipped code gains a network call that has not been reviewed.

## Private file transfers

File transfer can encrypt the stream with a key code that stays on the two screens (AES-256-GCM, with the key derived by HKDF-SHA-256). The sender shows the key code only while a button is held. This protects against a camera that sees the sender's screen but does not have the key. It does not hide that a transfer is happening, and anyone who learns the key code can read the file. The key code is never saved or sent over the network.

## HIPAA and other rules

No software is "HIPAA compliant" or "HIPAA certified" on its own. HIPAA applies to covered entities and their business associates and to how they handle PHI. QRCraftly never receives PHI, so there is nothing for it to store, transmit or protect on a server. Whether using it fits your obligations depends on your devices, your policies and where the codes end up. The same goes for GDPR: QRCraftly does not receive what you put in a code, but Cloudflare does process IP addresses to serve the site.

## Legal disclaimer

**No legal advice.** Nothing in this document is legal advice.

**No warranty.** This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.

**Your responsibility.** Compliance with HIPAA is the responsibility of the covered entity or business associate. Using this tool does not by itself make you compliant.
