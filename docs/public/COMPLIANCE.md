---
publish-approved: true
---

# Privacy and Compliance

## HIPAA Compliance Alignment

This application is designed to **support** HIPAA-compliant workflows through a **Privacy First Client-Side Architecture**.

### 1. Data Privacy (The "Won't Use Your Data" Guarantee)

- **Local Processing:** All QR code generation happens locally within the user's browser using HTML5 Canvas and JavaScript.
- **Data Transmission:** The sensitive data you enter to generate a QR code (which may include PHI) remains strictly in your device's memory and is not sent to our servers.
- **Volatile Memory:** QR content you enter is held only in memory and is cleared when the browser tab is closed or refreshed. The only values written to persistent browser storage are the keys listed under Technical Safeguards below.
- **Undo History and Style Files:** The generator keeps up to 50 appearance steps for Undo and Redo in volatile memory only; QR content is never part of a step, and a reload clears them. A style file (`.qrcraftly.json`) is a download you choose to make: it holds colours, pattern and layout settings only (never the QR value, text or uploaded images), and loading one accepts only a fixed set of known settings.
- **Brand Template Gallery Records:** Custom brand design templates saved by users are persisted in browser `localStorage` under `qrcraftly:brand-templates` (capped at 50 templates). Stored template records contain visual style settings only (colors, pattern styles, borders, logo size and padding) and never store QR payload content, border or template text, or uploaded images such as logos and mosaic pictures.
- **Mosaic QR Images:** An uploaded mosaic design and its decoded pixels are kept only in volatile memory (at most four decoded images) and are never persisted or uploaded.
- **Animation Loop Frames:** Any cached frames or matrices generated for animation loops are also kept solely in volatile client-side memory.
- **Playable Maze Overlay:** All coordinates, keep-out boundary zones, scannability-audited finder pattern bridge channels, and solutions computed for the playable maze overlay are processed completely in-memory locally in the user's browser, ensuring absolute privacy and data isolation.
- **Bulk CSV Batch Processing:** An uploaded CSV, the rows parsed from it (at most 500 per batch) and the QR codes and ZIP archive built from them stay in volatile memory on the main thread. The parser and ZIP writer are local code (`src/packages/bulk-csv/`) with no network access, nothing is persisted, and the download's Blob URL is revoked right after the download starts.

### 2. Logging & Metrics Policy

QRCraftly runs no analytics, telemetry or diagnostics of its own, and keeps no logs of its own. The site is static files served by Cloudflare (Workers Static Assets, with no server code of ours). See [the QRCraftly Pledge](https://qrcraftly.com/free-forever) for the plain-language version.

- **What the host sees:**
  - Cloudflare handles every request for a page or file. Like any web host it processes the IP address, user agent, request path (e.g. `/`, `/about` - which are static) and time, to deliver the site and protect it from attacks, under [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/). The project owner sees only aggregate totals such as request counts in the Cloudflare dashboard.
  - If Cloudflare's bot protection is enabled, it may set a short-lived security cookie. It is not used for tracking.
- **What is stored on your device:**
  - Only the colour-theme preference (`qrcraftly:theme`) and any brand templates you save (`qrcraftly:brand-templates`, see above). QR content is never stored.
- **What is NOT Logged:**
  - **User Input:** Since the application runs client-side, the text, URLs, or WiFi passwords (including WPA2-Enterprise EAP method, phase 2 and identity fields) you type are never part of the HTTP request to the server.
  - **Generated Images:** The QR codes created are generated in the browser and never uploaded.
  - **Diagnostics:** Scannability failures are handled on the device and never reported.

### 3. Technical Safeguards

- **HTTPS:** All connections are secured via HTTPS.
- **State Isolation:** The application does not store user input in URL query parameters (e.g., `?data=...`), ensuring that sensitive data does not leak into browser history, proxy logs, or server access logs.
- **Pre-Build Storage Privacy AST Auditor:** Automated static analysis (`scripts/storage_privacy_ast_auditor.js`) inspects all browser persistent storage calls prior to compilation. Detected storage operations are validated against an explicit allowlist of authorized preference, theme, and brand template identifiers (`qrcraftly:theme`, `qrcraftly:brand-templates`, `__test__`), preventing unapproved storage patterns or transient QR payload data from reaching persistent storage.

### 4. Private file transfers

File transfer can encrypt the stream with a key code that stays on the two screens (AES-256-GCM, key derived with HKDF-SHA-256). This protects against a camera that sees the sender's screen but does not have the key. It does not hide that a transfer is happening, and anyone who learns the key code can read the file. The key code is never written to storage or sent over the network.

## Certification Note

While this software is architected to support HIPAA compliance by preventing PHI from reaching the server, "HIPAA Certification" is a process that applies to the _organization_ and its _practices_, not just the software. This tool provides the _technical safeguards_ (specifically regarding Transmission Security and Data Integrity) to allow you to use it within a compliant environment.

## Legal Disclaimer

**NO LEGAL ADVICE:** The information provided in this document does not constitute legal advice.

**NO WARRANTY:** This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.

**USER RESPONSIBILITY:** Compliance with HIPAA is the responsibility of the covered entity or business associate. Using this tool does not automatically ensure compliance. Users must ensure that their specific use case, device security, and internal policies align with regulatory requirements.
