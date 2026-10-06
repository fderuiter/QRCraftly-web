# QRCraftly — Product Specification

> **Version**: aligned with `v0.11.0`
> **Status**: Living document — update alongside every minor release.
> **Audience**: Engineering team, stakeholders, and open-source contributors.

---

## 1. Vision

**QRCraftly is the professional QR code studio — the most customizable, beautiful QR generator on the web.**

It delivers studio-grade visual output while upholding an uncompromising privacy-first architecture: all QR payloads are generated, rendered, and exported entirely inside the user's browser. No user input ever crosses the network. No account required. No tracking.

---

## 2. Mission Statement

Make beautiful, accessible, privacy-safe QR codes trivially easy to produce — for a single marketer crafting a campaign asset, a healthcare team distributing compliant patient materials, or a developer transmitting files across an air gap.

---

## 3. Positioning

| Dimension           | QRCraftly                                                                            |
| ------------------- | ------------------------------------------------------------------------------------ |
| **Category**        | Client-side QR code studio                                                           |
| **Differentiation** | Studio-grade visual customization + zero-knowledge privacy architecture              |
| **License**         | AGPL-3.0 open-source; every feature free for everyone ([the Pledge](docs/PLEDGE.md)) |
| **Deployment**      | Progressive web app on Cloudflare's global edge network (`qrcraftly.com`)            |
| **Maturity**        | Pre-release (`v0.x`); actively approaching `v1.0` stable                             |

---

## 4. Product Principles

Ordered by priority. When principles conflict, the earlier one wins.

### P1 — Privacy is non-negotiable

User payloads **never** leave the browser. This is a hard architectural invariant, not a marketing claim. The [Storage Allowlist](docs/adr/0001-client-side-storage-allowlist.md), [volatile memory guarantee](docs/public/COMPLIANCE.md), and [pre-build storage AST auditor](scripts/storage_privacy_ast_auditor.js) enforce this at build time and runtime. No feature may be shipped that weakens this guarantee.

### P2 — Visual quality is a competitive advantage

QRCraftly's output must be objectively the most polished in class. Scannability and aesthetics are jointly maximized — neither is sacrificed for the other. The [Scannability Worker](docs/public/SCALING.md) enforces optical health automatically; engineers must ensure new pattern styles pass **Print Simulation Verified** before release.

### P3 — Simplicity wins for the core flow

The path from landing to downloading a customized QR code must require zero account creation, zero configuration, and zero learning. Advanced features (Air-Gapped Transfer and the QR Arcade) are opt-in surfaces that do not interrupt the primary flow.

### P4 — Accessibility and compliance are first-class

WCAG 2.1 SC 1.4.11 contrast compliance is validated for every generated code and all UI states. HIPAA Technical Safeguard alignment (transmission security, data integrity, volatile memory) is maintained across all feature additions. See [`docs/public/COMPLIANCE.md`](docs/public/COMPLIANCE.md).

### P5 — Platform invariance

The product runs identically on every modern browser across desktop and mobile. The engineering toolchain runs identically on Windows, macOS, and Linux. No platform is a second-class citizen.

---

## 5. Target Personas

### 5.1 — The Brand Designer / Marketer

**Needs**: On-brand QR codes for campaigns, packaging, print, and event materials. Wants fine-grained color, pattern, and logo control. Exports to print-quality SVG or PNG.

**Success**: Generates a beautiful, on-brand code in under two minutes without reading documentation.

### 5.2 — The Healthcare / Compliance Professional

**Needs**: A QR generator that never transmits PHI to a server. Must be usable within a HIPAA-aligned environment. Needs confidence that nothing is stored, logged, or tracked.

**Success**: Can point to [`docs/public/COMPLIANCE.md`](docs/public/COMPLIANCE.md) as evidence of technical safeguards and use QRCraftly in a compliant workflow with confidence.

### 5.3 — The Developer / Technical Power User

**Needs**: Advanced QR data types (vCard RFC 6350, cryptocurrency, calendar events, GPS), fine-grained error-correction control, SVG export for programmatic manipulation, and access to experimental features (air-gapped optical transfer).

**Success**: QRCraftly handles every data type they need and exposes the raw architectural capability of the platform.

### 5.4 — The Event Organizer / Small Business Owner

**Needs**: Quick generation of WiFi, URL, or contact QR codes for physical spaces. Needs it to work on mobile, look great, and be downloadable immediately.

**Success**: Opens the site on a phone, generates a scannable WiFi code with a logo, and saves it in under 60 seconds.

---

## 6. Feature Inventory

Features are tagged with a maturity tier:

| Tag          | Meaning                                                  |
| ------------ | -------------------------------------------------------- |
| `[STABLE]`   | Production-ready, fully supported                        |
| `[BETA]`     | Available but with known rough edges; use with awareness |
| `[INTERNAL]` | Architecture exists; not yet user-facing                 |
| `[PLANNED]`  | On the roadmap, not yet implemented                      |

### 6.1 Core QR Generation `[STABLE]`

- **Data types**: URL, plain text, WiFi (WPA/WEP/EAP/Open), email, vCard (RFC 6350 CRLF + UTF-8 line folding), phone, SMS, cryptocurrency payments, calendar events (iCal), GPS coordinates, video meeting links (Zoom, Microsoft Teams, Google Meet), social profiles (Instagram, X / Twitter, TikTok).
- **Error correction levels**: L / M / Q / H (user-selectable).
- **Live preview**: QR matrix re-renders in real time with every input change.
- **Off-thread analysis**: Scannability auditing runs in the Scannability Worker (`src/packages/scannability/`) and camera or file decoding runs in the optical scanner worker (`src/packages/optical-scanner/`). Pixel data moves to the workers as transferable `ArrayBuffer`s, keeping the UI responsive.
- **Scan to fill**: The input panel can scan an existing QR code from the webcam or an image file and load its content into the matching form.
- **Bulk CSV**: At `/bulk-csv-qr-code`, upload a CSV (at most 500 rows) and download one QR code per row as a ZIP, all in the browser (`src/packages/bulk-csv/`).

### 6.2 Visual Customization `[STABLE]`

- **Pattern styles**: Standard Industrial, Modern Soft, Swiss Dot, Fluid Ink, Cyber Circuit, The Hive, Grunge, Starburst.
- **Color control**: Independent foreground, background, and finder pattern (eye) colors. Accessibility-checked preset themes included. WCAG contrast enforcement with live warnings.
- **Logo embedding**: Upload JPEG, PNG, WebP, SVG (max 2 MB). Configurable size (max 30% of matrix to preserve scannability), padding, and border style (Square, Circle, None).
- **Scannability Health indicator**: Real-time badge showing **Print Simulation Verified**, **Screen Scan Verified**, or **Scan Verification Failed** with explanatory guidance.

### 6.3 Export & Share `[STABLE]`

- **Formats**: PNG (high-quality), JPEG, WebP, vector SVG (via custom `SvgContext` Canvas 2D emulation).
- **File System Access API**: Native "Save As" dialog on supported browsers.
- **Web Share API**: One-tap mobile sharing to any installed app.

### 6.4 Air-Gapped Optical Transfer `[BETA]`

User-facing at `/file-transfer` (send) and `/file-transfer/receive` (receive), linked from the header navigation (tagged "Beta") and the site footer.

- **Mechanism**: Transmits arbitrary binary files across physical air gaps as animated QR streams — no network, Bluetooth, or USB required.
- **Reliability**: Each frame is protected by the QR code's own Reed-Solomon error correction. The received file is checked against a SHA-256 hash before it is offered for download.
- **Stream design**: The rateless fountain codec (Luby Transform over GF(2)) and its rollout status are described in [ADR 0014](docs/adr/0014-rateless-fountain-codes-for-airgapped-optical-transfer.md) and [ADR 0017](docs/adr/0017-consolidated-air-gapped-optical-transfer-package.md).
- **Near-term roadmap**: Taking this feature out of Beta is the current #1 priority (see Section 8).

### 6.5 Accessibility `[STABLE]`

- WCAG 2.1 SC 1.4.11 Non-Text Contrast enforcement on all generated codes and UI states.
- Full keyboard navigation and screen reader support.
- Vitest-axe automated accessibility assertions on all components.

### 6.6 Progressive Web App `[STABLE]`

- Fully responsive — desktop and mobile.
- Dark mode supported.
- Core generation works offline once static assets are cached.

### 6.7 QR Arcade `[BETA]`

- At `/arcade` (the old `/game` and `/destroy-the-qr` links redirect here): damage a QR design in the Blaster or the Damage Simulator while Reed-Solomon analytics and a real scanner report whether it still decodes.

---

## 7. Privacy & Compliance Architecture

This section is **non-negotiable**. Any feature proposal must be evaluated against these invariants before planning begins.

| Invariant                                 | Enforcement Mechanism                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| User payloads never transmitted to server | Client-side Canvas / Web Worker generation only                                                       |
| No QR content stored server-side          | QR content is held in browser memory only and is gone when the tab closes                             |
| No user input in URL query parameters     | Architectural constraint; prevents history/proxy leakage                                              |
| Storage keys explicitly allowlisted       | Pre-build AST auditor (`scripts/storage_privacy_ast_auditor.js`) blocks unapproved keys at build time |
| No analytics, telemetry or ads            | [The QRCraftly Pledge](docs/PLEDGE.md); CSP `connect-src 'self'` and the bundle network audit         |

HIPAA Technical Safeguard alignment is documented in [`docs/public/COMPLIANCE.md`](docs/public/COMPLIANCE.md). This is a _technical_ safeguard; organizational HIPAA certification remains the responsibility of the deploying organization.

---

## 8. Roadmap

### Now — Current Sprint

- **Take Air-Gapped Optical Transfer out of Beta**: The send and receive pages ship with Beta labels. Make the Optical Transfer Engine reliable and easy for non-technical users. This is the #1 priority.

### Next — Near-Term (next 1–3 minor releases)

- **SEO & content marketing**: The generator pages (e.g., `/wifi-qr-code`), landing pages and guides are live; grow organic acquisition from them (see [`docs/SEO_MEASUREMENT.md`](docs/SEO_MEASUREMENT.md)). Lighthouse CI scores must remain green.

### Later — Medium-Term

- **Commercial self-hosting licence (undecided)**: A possible licence for organizations that want to self-host or white-label QRCraftly with commercial support. It would never gate a feature on `qrcraftly.com` ([the Pledge](docs/PLEDGE.md): no paid upgrades, every feature for everyone).
- **Expand QR data types**: Additional social platforms, structured data types, and AR marker support as demand warrants.
- **v1.0 stable release**: Graduate from `v0.x` pre-release when Air-Gapped Optical Transfer is out of Beta and the core studio feature set is considered complete.

### Icebox — Under Evaluation

- Team workspaces / collaborative QR management.
- Programmatic API (CLI or REST) for power users.

---

## 9. Non-Goals

The following are explicitly **out of scope** and should not be planned, specced, or built without a deliberate product decision to revise this list:

| Non-Goal                                               | Rationale                                                                                                                                                                                                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic / trackable QR redirection                     | Any server-side redirection requires storing a destination URL server-side and logging scan events, which cannot be reconciled with the privacy-first invariant. Decided and removed in [ADR 0022](docs/adr/0022-no-dynamic-qr-codes-client-side-only.md). |
| Server-side QR generation                              | Violates the privacy-first invariant; payloads must never leave the client                                                                                                                                                                                 |
| Native mobile apps in this repository                  | The web app is a responsive PWA. The App Store app for iPhone, iPad and Mac ("QRCraftly: QR Code Studio") is a separate project; this repository only hosts its `/privacy` and `/support` pages                                                            |
| Batch / bulk QR generation via a server API            | Needs server code; bulk generation from a CSV upload runs in the browser instead (`/bulk-csv-qr-code`)                                                                                                                                                     |
| Ads, analytics, telemetry or diagnostics reporting     | Violates [the QRCraftly Pledge](docs/PLEDGE.md): the project shuts down before it becomes ad supported                                                                                                                                                     |
| Server-side storage of user QR codes or cloud accounts | Violates volatile memory guarantee                                                                                                                                                                                                                         |

---

## 10. Success Metrics

QRCraftly is healthy and growing when all of the following trend in the right direction:

### Technical Quality

| Metric                                             | Target                                                                                                            | Enforced in CI today                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Lighthouse Performance                             | >= 90                                                                                                             | >= 90 (`lighthouserc.json`)                  |
| Lighthouse Accessibility                           | >= 95                                                                                                             | >= 90 (`lighthouserc.json`)                  |
| Lighthouse SEO                                     | >= 90                                                                                                             | >= 95 (`lighthouserc.json`)                  |
| Lighthouse Best Practices                          | >= 90                                                                                                             | >= 90 (`lighthouserc.json`)                  |
| Page first load                                    | <= 260 KB gzipped per page (HTML, CSS and startup scripts); <= 650 KB for the JavaScript and CSS in `dist/client` | Same limits (`scripts/check-bundle-size.js`) |
| Scannability pass rate (Print Simulation Verified) | >= 95% across all pattern styles in CI visual regression                                                          | No CI check measures this rate               |

### Reach

QRCraftly has no analytics ([the Pledge](docs/PLEDGE.md)), so it cannot count users, sessions or codes generated. Reach is measured from search consoles and Cloudflare's aggregate request counts only; see [`docs/SEO_MEASUREMENT.md`](docs/SEO_MEASUREMENT.md).

| Metric                                               | Cadence |
| ---------------------------------------------------- | ------- |
| Non-brand search clicks and impressions              | Monthly |
| Indexed pages vs sitemap URLs                        | Monthly |
| Mobile vs. desktop search clicks (Search Console)    | Monthly |
| Page requests (Cloudflare zone totals, no page code) | Monthly |

### Community & Repository Health

| Metric                                 | Cadence      |
| -------------------------------------- | ------------ |
| GitHub stars                           | Monthly      |
| Open issues resolved (time-to-close)   | Monthly      |
| Contributor count                      | Quarterly    |
| CI green rate (no flaky test failures) | Continuously |

---

## 11. Monetization Model

QRCraftly is **open-source under AGPL-3.0**. The base product is free forever for individuals and non-commercial use.

Every feature on `qrcraftly.com` is free for everyone, with no account, no ads and no paid upgrades, now and later ([the Pledge](docs/PLEDGE.md)). That includes the full studio, every data type, every visual option and Air-Gapped Transfer.

> A commercial licence for organizations that want to self-host or white-label QRCraftly with support is undecided. If it ever exists, it covers only self-hosting, white-labelling and support, never a feature of the public site. No SaaS subscription or per-code pricing is planned.

---

## 12. Related Documents

| Document                                                 | Purpose                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`CONTEXT.md`](CONTEXT.md)                               | Canonical domain glossary — use correct terminology                      |
| [`docs/PLEDGE.md`](docs/PLEDGE.md)                       | The no-ads, no-tracking, free-forever pledge and how CI enforces it      |
| [`AGENTS.md`](AGENTS.md)                                 | Engineering operating instructions and hard invariants for AI agents     |
| [`docs/public/COMPLIANCE.md`](docs/public/COMPLIANCE.md) | HIPAA technical safeguard documentation                                  |
| [`docs/public/SCALING.md`](docs/public/SCALING.md)       | Scannability Worker, Web Workers, and performance architecture           |
| [`docs/public/UI_CATALOG.md`](docs/public/UI_CATALOG.md) | Canonical UI component catalog                                           |
| [`docs/adr/`](docs/adr/)                                 | Architectural Decision Records — rationale for every major design choice |
| [`CHANGELOG.md`](CHANGELOG.md)                           | Release history                                                          |

---

_This document is the single source of truth for QRCraftly's product direction. Update it as a required step in the release process whenever scope, priorities, or principles change._
