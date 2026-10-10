# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.12.0] - 2026-10-10

### Features

- feat(optical-transfer): measure the colour layer honestly on the camera's clock (#1385) (`084c107`)
- feat(content): move generator background reading into the FAQ and rewrite it plainly (#1379) (`4b40ef5`)
- feat: land reviewed Stitch batch (IBAN check, never-expires note, render perf) (#1358) (`2753fff`)
- feat(bulk-csv): implement CSV preflight summary card and row categorization engine (#1348) (`f6c6030`)
- feat(event): add timezone selector control and payload handling (#1331) (`4e4cb14`)
- feat: add CC and BCC recipient fields to email QR codes (#1345) (`31aa1b4`)
- feat(style): add linear and radial gradient fill color controls (#1325) (`3c77a74`)
- feat: add transparent background toggle and renderer background guard (#1337) (`c03e415`)
- feat: add preset logo gallery with category filters for brand icons (#1321) (`a43de3f`)
- feat(bcur): implement inverted index map and ripple queue for peeling decoder (#1347) (`8904bb1`)
- feat(ui): implement custom frame shapes and call-to-action badges (#1328) (`ba8fb6d`)
- feat(bulk-csv): add bulk PNG export resolution dropdown selector (#1318) (`d873d39`)
- feat(qr): add independent eye frame and eye ball color controls (#1326) (`ef8ecea`)
- feat: expand SocialPlatform enum and presets for extended social networks (#1320) (`1e2c67f`)
- feat: add EPC SEPA QR and fiat payment presets (#1327) (`08cbb6b`)
- feat(vcard): add contact format selector for vCard 2.1, 3.0, 4.0, and MECard (#1323) (`aad682b`)
- feat(event): add web calendar provider options for Google, Outlook, and Yahoo (#1315) (`7d682e6`)
- feat(bulk-csv): add downloadable sample CSV template button to upload drop zone (#1319) (`97dc8ac`)
- feat(export): add native client-side EPS and PDF vector export support (#1316) (`191c1bf`)
- feat(transfer): send wallet-compatible BC-UR animated QR codes (#1149) (#1236) (`420b57a`)
- feat(transfer): let the receiver steer the sender through a webcam back channel (#1146) (#1234) (`e4d3fc8`)
- feat(transfer): add beacon frames and speed profiles to the multi-code preview (#1143) (#1233) (`271a27c`)
- feat(transfer): send several QR codes per frame behind preview switches (#1142) (#1232) (`bc65ce5`)

### Bug Fixes

- fix(generator): show the sample for empty forms and gate mockup and refused-content exports (#1388) (`01c6f24`)
- fix: harden template import and storage, fix Cyber Circuit finders, and make logo backings distinct (#1387) (`706de75`)
- fix(docs): build the /security docs manifest at load time instead of committing it (#1386) (`37fef4e`)
- fix: export the current code at full size with readable errors (#1383) (`9f91076`)
- fix(payment): check payment amounts and require the SEPA beneficiary (#1382) (`2594d29`)
- fix(bulk-csv): encode what the preview shows, read more files, and skip bad rows one at a time (#1381) (`17951c9`)
- fix(optical-transfer): keep transfers, keys and the webcam safe in receiver and sender edge cases (#1378) (`888d596`)
- fix(ci): close CI test gaps in workflow hardening, sitemap, git and branch cleanup (#1357) (`1b39e53`)
- fix(optical-modem): bind an identity checksum to every modem block (#1372) (`a2da5e6`)
- fix(scanner): confirm codes on slow phones, read SVG files and close six other scanner gaps (#1380) (`1a16d0e`)
- fix(sw): precache the generator's workers and wasm, and hash the final HTML and headers (#1377) (`acfe530`)
- fix(qr-payload): keep text line breaks and stop refusing valid text, e-mail and links (#1370) (`27a2def`)
- fix(logos): replace brand lookalike presets with generic icons (#1376) (`b61810d`)
- fix(qr-payload): read structured payloads faithfully and stop silent data loss (#1373) (`4e258d0`)
- fix(sw): load the current build after an update and draw the QR when a worker file is gone (#1369) (`31f17ec`)
- fix: keep the quiet zone inside borders and publish only the newest scan verdict (#1375) (`5ce1dc2`)
- fix(qr-matrix): keep frames visible and transparent codes scannable (#1371) (`b7363fd`)
- fix: land reviewed Stitch batch 2 (vector path parser, release tagging, Playwright cache) (#1374) (`f2555c7`)
- fix(qr-payload): conditionally emit vcard and mecard property tags (#1333) (`6150065`)
- fix(export): flatten JPEG transparent background to solid white before scannability check (#1322) (`b088829`)
- fix(arcade): propagate matrix fallback state to target settings and scanner HUD (#1317) (`55bf4c0`)
- fix(file-transfer): keep transfer frames one size and harden scan warnings (#1308) (`1e55138`)
- fix(scannability): give a print fix when only the print simulation fails (#1310) (`99caf7b`)
- fix(scannability): make the print simulation judge the code, not the canvas (#1275) (`d8cd1c7`)

### Performance

- perf(viewing-conditions): implement canvas pool and streamline condition evaluation (#1314) (`534a0f0`)
- perf(modem): run the modem and colour kernels in Rust (#1198) (#1237) (`d473ddf`)

### Maintenance

- test(edge): check production headers and deployment integrity (#1353) (#1384) (`221efb2`)
- refactor(link-safety): restrict uncalled utility functions to module scope (#1334) (`b5bcd1e`)
- refactor(compliance): implement TypeScript AST parsing in dependency audit (#1340) (`9433f11`)
- docs: document the issue label convention (#1247) (`5971255`)
- docs: refresh stale documentation across the repository (#1242) (`035f8c4`)
- docs: add the Optical Transfer design pages and rewrite the README (#1239) (`63f68bf`)
- chore(deps): freeze the BC-UR test vectors, drop @ngraveio/bc-ur and adopt "In-house first" (#1181) (#1235) (`2c2f965`)
- ci: run the @prod E2E flows against production after each deploy (#1228) (#1231) (`0e7fc52`)

---

## [0.11.0] - 2026-10-06

### Features

- feat(transfer): send Prism with the outer code as an opt-in preview (#1141) (#1227) (`71c779b`)
- feat(transfer): add Prism's outer code, an LT code over an LDPC precode (#1176) (#1218) (`4dc575d`)

### Bug Fixes

- fix(security): resolve open code-scanning alerts (#1219) (`8ebdfb0`)

---

## [0.8.0] - 2026-09-03

### Features

- feat(docs): add rateless fountain codes and multi-tier scanning for air-gapped optical transfer (`b88086f`)

### Maintenance

- chore(release): adopt SemVer 2.0.0 baseline, automated release engine, and fast-forward promotion model

---

## [0.7.0] - 2026-08-01

> Note: Tags `v0.7.0.0` through `v0.7.0.3` used a legacy 4-digit scheme; they are consolidated here as the canonical `v0.7.0` minor release.

### Features

- feat(scannability): harden scannability worker protocol with ACK, watchdog, and graceful degradation (`b46960d`)
- feat(ci): configure online dev deployment and harden scannability worker protocols (`5086c27`)
- feat(ci): standardize edge routing, branch hierarchy, and authoritative quality gates (`d5ead0c`)

### Bug Fixes

- fix(security): exclude setup and wizard identifiers from secret scanner false positives (`7d01fd9`)
- fix(ci): resolve unit test coverage gate, e2e worker recovery, and bundle budget (`7f229f2`)
- fix(scannability): resolve fluid ink geometry, jsQR crash, and density scaling (`d7ca348`)

### Maintenance

- docs(learn): record learned deployment invariants and ADRs in AGENTS.md and CONTEXT.md (`2f42462`)
- feat(docs): enhance syncAll function to capture and report errors during documentation synchronization (`3a8c6bf`)
- chore(docs): regenerate docs manifest after compliance sync (`1bfac79`)

---

## [0.6.3] - 2026-07-01

> Note: Tags `v0.6.3.0` and `v0.6.3.1` are consolidated as `v0.6.3`.

### Features

- feat: offload FSK demodulation to dedicated Web Worker with zero-copy memory transfers (`2a30bc7`)
- feat: enforce zero-transit direct redirection counter-only logging (`ea783eca`)

### Bug Fixes

- fix(arcade): main-thread optimistic token management and buffer replenishment (`d8b274b`)
- fix(scanner): targeted listener detachment and shared worker singleton safeguards (`08a7d05`)
- fix(worker): slice reassembled ArrayBuffer to exact target file size (`32e481b`)
- fix(vcard): enforce RFC 6350 CRLF formatting, UTF-8 octet line folding, and preserve URL parameters (`66103a8`)
- fix(security): map inline workflow context values to step-level environment variables (`e03b68e`)
- fix(security): resolve false positive in secret scanner for storage privacy AST auditor (`3823c79`)

### Maintenance

- ci: extract multi-line shell steps into modular scripts with strict failure flags and shellcheck analysis (`5cb4022`)

---

## [0.6.2] - 2026-06-01

> Note: Tags `v0.6.2` and `v0.6.2.1` are consolidated as `v0.6.2`.

### Features

- feat: implement style-adaptive maze clearance, canvas halo masking, and path width slider (`32a655e`)
- feat(audio-qr): isolate hardware lifecycles and unify DSP synthesis engine (`74d0b50`)
- feat(security): implement pre-build storage privacy AST auditor (`a50d792`)

### Bug Fixes

- fix(dynamic-qr): temporarily suppress dynamic QR UI and redirect dashboard (`f8a51a9`)
- fix(docs): implement targeted case-safety patches for auditing and compilation (`a5b41a4`)
- fix(ci): optimize docs manifest payload and adjust bundle size budget threshold (`1dec809`)
- fix(e2e): set fullPage false for viewport visual regression tests (`8df66c0`)
- fix(dashboard): remove unused TrendChart and internalize luminance calculation export (`29af9c7`)
- fix(build): resolve build dependency chain for CSP hash injection (`0cf1d97`)

### Maintenance

- docs: establish root domain glossary (CONTEXT.md) and foundational ADRs (`5aff4d8`)

---

## [0.6.1] - 2026-05-01

> Initial public pre-release milestone.

---

## [0.6.0] - 2026-04-01

> Foundational release establishing the Two-Tier Staged Promotion Model (dev/main), Cloudflare Workers edge hosting, and client-side QR generation pipeline.
