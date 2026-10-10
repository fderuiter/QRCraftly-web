---
publish-approved: true
---

# Privacy and Compliance

What QRCraftly does with the data you put into it, what our host can see, and what that means if you work under HIPAA or similar rules. The plain-language version is [the QRCraftly Pledge](https://qrcraftly.com/free-forever).

## Where your data goes

QRCraftly makes QR codes in your browser. What you type, upload or scan is not sent to a server, so it can be used for codes that hold protected health information (PHI) without that information reaching us.

- **Generating codes.** Every content type (links, text, Wi-Fi, contact cards in vCard 2.1, 3.0, 4.0 and MECARD, email, phone, SMS, events, locations, meetings, payments and social profiles) is encoded and drawn on your device.
- **Memory only.** QR content stays in the memory of the open tab and is gone when you close or reload it. The only values saved to browser storage are the two keys listed under [Technical safeguards](#technical-safeguards).
- **Undo and style files.** Undo and Redo keep up to 50 appearance steps in memory, without any QR content, and a reload clears them. A style file (`.qrcraftly.json`) is a download you choose to make. It holds colours, pattern and layout settings only, never the QR content, frame text or uploaded images, and loading one accepts only a fixed list of known settings.
- **Brand templates.** Templates you save are kept in your browser's `localStorage` under `qrcraftly:brand-templates`, up to 50 of them. They hold style settings only (colours, gradients, patterns, borders, logo size and padding), never QR content, frame or template text, or uploaded images such as logos and mosaic pictures.
- **Images you upload.** Logos and mosaic pictures, and the pixels decoded from them (at most four mosaic images), stay in memory. They are never saved or uploaded.
- **Frames and maze overlays.** Frame text is cleaned of control characters and drawn in the page. Maze overlays are computed in the page. Neither is saved or sent anywhere.
- **Bulk CSV.** An uploaded CSV, its rows (at most 500 per batch), and the codes and ZIP file built from them stay in memory. The parser and ZIP writer are our own code (`src/packages/bulk-csv/`) with no network access, and the download link is revoked as soon as the download starts.
- **Calendar events.** An iCalendar (.ics) code keeps the event inside the code. A web calendar code (Google Calendar, Outlook Web, Office 365 or Yahoo Calendar) is a link that carries the title, times, location and description, so when someone opens it, that provider receives those details. Use iCalendar, the default, for events that contain PHI. The generator says this next to the choice.
- **Social profiles.** Handles for the eight supported networks are turned into ordinary profile links in the page.
- **Scanning and checking.** Camera frames and pictures you pick are decoded on your device and never recorded or uploaded.

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
