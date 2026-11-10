# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

## [0.15.0] - 2026-11-10

### Features

- feat(security): enforce Trusted Types with a same-origin script URL policy (#1692) (`13a1063`)
- feat(logo): place the matching preset logo when the QR type changes (#1678) (`2110b9d`)
- feat(vcard): fill the contact form from a dropped or chosen .vcf file (#1676) (`3b21c8d`)
- feat(pwa): complete the manifest, dark theme-color and favicon set (#1672) (`ef46716`)
- feat(videos): add 12 more feature shorts to /videos (#1582) (`8404d1e`)
- feat(site): add a /videos page with self-hosted product videos (#1570) (`182a260`)
- feat(generator): code-split YouTube URL parser in Social generator (#1553) (#1562) (`dea8d57`)
- feat(foundry): add zero-allocation fountain-bcur WebAssembly kernel (#1182) (#1550) (`da77b28`)
- feat(color): implement single-click WCAG contrast auto-fix using HSL lightness binary search (#1542) (`f4412d9`)
- feat(event): add RFC 5545 RRULE recurrence controls to event input and generator (#1544) (`8fc2aa7`)
- feat(bulk-csv): add client-side Excel spreadsheet parsing with in-house WebAssembly kernel (#1546) (`500b7ae`)
- feat(location): add Google Maps URL and location string parser for LocationInput (#1537) (`dae43d8`)
- feat(bulk-csv): add downloadable CSV error log export for skipped and failed rows (#1536) (`7d3336c`)
- feat(export): add CMYK color space selection and export support for EPS and PDF vector downloads (#1538) (`7bcec65`)
- feat(bulk-csv): add downloadable preflight validation report CSV export (#1534) (`8ad5a55`)
- feat(style-controls): auto-elevate ECC level and warn when adding logos (#1495) (`ba934f6`)
- feat(bulk-csv): interactive column mapping UI and auto-matching heuristics (#1496) (`e9d8a1e`)
- feat(scanner): add CSV export action for scan history logs (#1492) (`ab5af5a`)
- feat(qr-matrix): add quiet zone margin control to QRConfig and AdvancedControls (#1494) (`4f29025`)
- feat(vcard): add photo avatar field and PHOTO attribute serialization (#1493) (`322df01`)

### Bug Fixes

- fix(videos): load posters, not players, until someone presses play (#1688) (`9516179`)
- fix(a11y): keep focus where the user is when a lazy form arrives late (#1687) (`c107e83`)
- fix(deps): clear nightly audit advisories for vite and minimatch (#1685) (`aa00411`)
- fix(vcard): prerender the contact form and load the file reader on demand (#1680) (`5e9ab49`)
- fix(seo): drop the probe from production, date pages by shared copy, match sitemap exclusions by segment (#1660) (`d9b995b`)
- fix(wasm): fuzz the BC-UR decoder and reuse freed memory in the module allocator (#1654) (`b40b417`)
- fix(a11y): name the video picker by its text and make the arcade boards applications (#1635) (`6d01a4b`)
- fix(security): neutralise external url() in every SVG attribute (#1633) (`0e1ef24`)
- fix(transfer): widen the risky-file list, confirm risky archives, refuse impossible sizes (#1632) (`08f8544`)
- fix(ui): count scroll locks so stacked modals restore page scroll (#1631) (`9125fd0`)
- fix(scanner): cancel the running scan on a refused image and reset copy state per scan (#1630) (`f5ce2a2`)
- fix(generator): drop stale async results in uploads, logo preview, bulk CSV and exports (#1629) (`cadf314`)
- fix(preview): clear the preview when the QR encoder fails to load (#1628) (`9601aa1`)
- fix(camera): one error table and the hidden-tab rule for every webcam (#1627) (`1a1cc4a`)
- fix(excel): cap cell references, convert once, and test DEFLATE input (#1626) (`835cdd6`)
- fix(templates): keep all visual settings when a template is imported (#1625) (`5d439b0`)
- fix(export): split canvas font shorthand into SVG font attributes (#1559) (`4296224`)
- fix(headers): reject malformed route matchers in _headers validation (#1543) (`254ce30`)

### Performance

- perf(lint): run eslint, tsc and the static checks side by side (#1658) (`9cc3837`)
- perf(guides): ship each guide page only its own article (#1638) (`db5df39`)
- perf(edge): cache fixed-name media, icons and the manifest for a day (#1637) (`b977f55`)
- perf(build): ship each WebAssembly module once, at one URL (#1636) (`e41ebe3`)
- perf(build): split React into a cached vendor chunk and count startup WebAssembly in the page budget (#1621) (`8209924`)

### Maintenance

- ci(release): publish the GitHub Release only once Cloudflare serves it (this release)
- test(e2e): take the Trusted Types navigation routes from the shared list (#1693) (`1cb54d0`)
- ci(e2e): pin the E2E runner to ubuntu-24.04 (#1690) (`f4a35c2`)
- ci(e2e): run the full tier as one job per browser (#1689) (`368df93`)
- test(e2e): wait for the scannability verdict before visual screenshots (#1686) (`5316534`)
- chore(deps): bump semgrep from 1.182.0 to 1.183.0 (#1684) (`a8d2f53`)
- refactor(scannability): run the optical print simulation in a Rust WebAssembly module (#1679) (`b253c83`)
- docs(scaling): state the Workers Builds allowance per plan (#1673) (`5d5ee8b`)
- docs(product): drop the undecided paid self-hosting licence (#1670) (`9ede22e`)
- docs(edge): record Cloudflare zone features and the real trailing-slash status (#1663) (`b064687`)
- refactor(tooling): one source walker, AST path audit, design tokens in ESLint (#1661) (`6e9e503`)
- refactor(ci): share the alert-issue cycle and test the quota report (#1659) (`1d74171`)
- chore(deps): bump semgrep from 1.181.0 to 1.182.0 (#1649) (`18306ce`)
- chore(deps): bump actions/setup-python from 7.0.0 to 7.1.0 (#1648) (`4b49902`)
- chore(scripts): make every auditor failure say how to fix it (#1657) (`db3f7d0`)
- test(ci): ratchet coverage floors to CI's numbers and replace the E2E sleeps (#1656) (`ce37750`)
- test(generator): sweep every QR type from form to encoder, and time out a stuck image resize (#1655) (`e74f7df`)
- test(export): decode PNG, PDF and raster exports back to the original payload (#1653) (`ee35214`)
- refactor(optical-scanner): replace contract casts with guards, and give the assertion rule a fix line (#1652) (`53b939f`)
- refactor(render): type the shared drawing surface instead of casting SvgContext (#1651) (`0991adc`)
- refactor: remove dead roundRect and parsePayload, and name the shape sizes (#1650) (`5fb2e64`)
- refactor(qr-export): split the vector scene into reader, font and operator layers (#1647) (`2cc0815`)
- refactor(scanner): split QRScanner.tsx into focused hooks and views (#1646) (`406a9af`)
- test: give lazy-loaded generator UI 10 s to appear in every test (#1645) (`acee5cb`)
- refactor(optical-transfer): split the root barrel so experimental layers stay private (#1643) (`94eae2b`)
- refactor(scannability): split the evaluator closure into named modules (#1642) (`51aa970`)
- refactor(scannability): one shared scan check for exports, wallet and handshake (#1641) (`6de30a3`)
- refactor(core): move crc32 and the ZIP writer into core, and the CSV preview into qr-payload (#1640) (`33e06ae`)
- refactor(wasm): give URL resolution for every module one owner (#1639) (`5ef1b1a`)
- ci(snapshots): keep the write token out of the steps that run branch code (#1634) (`b857a90`)
- docs(agents): add CLAUDE.md, check inline paths, and fix stale ADR claims (#1624) (`51d2773`)
- test: move slow and timing-based tests out of the unit shards (#1623) (`eb5bd87`)
- test: run the checks on the built site after the build instead of skipping them (#1622) (`7dfc27c`)
- refactor(file-transfer): split the receive page into components (#1581) (`1072f05`)
- refactor(file-transfer): split useOpticalReceiver into worker, frame source, telemetry and delivery hooks (#1580) (`6a42c5f`)
- refactor(file-transfer): split the send page into focused components (#1579) (`8cd96bb`)
- refactor(file-transfer): add a pure receiver phase reducer with a typed completion result (#1578) (`ff3db72`)
- refactor(file-transfer): split useOpticalSender into worker, frame loop, steering and settings hooks (#1577) (`ecd4fa7`)
- refactor(file-transfer): add a pure sender phase reducer and expose phase from useOpticalSender (#1576) (`50494d2`)
- refactor(file-transfer): extract pure helpers, one duration formatter and a shared useFileDrop hook (#1575) (`e011b9a`)
- refactor(inputs): type the input registry by key so validation and commits need no casts (#1574) (`8a3ff63`)
- refactor(generator): split QRToolInner's markup into PreviewCard, ExportBar and SafetyGateModal (#1573) (`9a47036`)
- refactor(generator): move export flow and preview state into two hooks (#1572) (`4825786`)
- refactor(generator): extract export and preview decisions from QRToolInner (#1571) (`d18c77e`)
- refactor(boundaries): delete the app-root allowlist now that it is empty (#1569) (`9d4e322`)
- refactor(link-safety): move the hostname helpers into link-safety (#1568) (`2a0d082`)
- refactor(scannability): move the scoring constants out of src/constants.ts (#1567) (`a6d5819`)
- refactor(qr-export): move the asset cache into qr-export (#1566) (`a775f6c`)
- refactor(qr-payload): move payload data types, meeting parser and type labels into qr-payload (#1565) (`6ec2adc`)
- refactor(core): move shared QR types, DEFAULT_CONFIG and file-name helpers into core (#1564) (`595c73f`)
- refactor(core): move the security sanitizers and URL helpers into core (#1563) (`9e81c52`)
- refactor(core): move bytes, SHA-256, colour maths and ECC levels into core (#1561) (`fb678ab`)
- refactor(packages): add ADR 0052 and a shrink-only rule against packages importing app code (#1560) (`2db3677`)
- chore(deps): bump certifi from 2026.7.22 to 2026.10.19 in the pip group across 1 directory (#1552) (`6ddd4cc`)
- test(link-safety): retain pure TS architecture with automated CI performance guardrails (#1541) (`c059adc`)
- chore(deps): bump vitest and @vitest/coverage-v8 to 4.1.12 (#1551) (`3cbbb20`)
- refactor: one blob hand-off helper, shared transfer formatters and real e2e waits (#1531) (`65c3fde`)
- chore(rulesets): match the live Main branch and Release tags rulesets (#1530) (`01dd5d1`)
- docs: bring the repository docs back in line with the code (#1501) (`c76de66`)
- chore(claude): add a SessionStart hook for cloud sessions (#1506) (`0c409b8`)
- test(e2e): read back eye-shape, UPI and vCard codes made in the generator (#1502) (`f4bc5fa`)
- docs: the maintainer merges every PR; teach steward the CI tiers (#1499) (`ac376b1`)
- refactor: pay down tech debt in BulkCsvInput, QRCanvas, coverage, lint and CI (#1505) (`ee06aea`)
- chore(agents): add a run-qrcraftly skill with a headless browser driver (#1500) (`3f03d83`)
- ci: drop the Stitch-only PR gate and agent files (#1498) (`8c2a865`)
- chore(deps): bump semgrep from 1.180.0 to 1.181.0 (#1491) (`7e5ec7a`)

---

## [0.14.0] - 2026-10-17

### Features

- feat(generator): shape the finder eyes' frame and ball apart from the pattern (#1488) (`e18953e`)
- feat(seo): QR code size calculator, no-subscription guide and schema fixes (#1483) (`dbc06c2`)
- feat(vcard): add X, LinkedIn, Instagram, Facebook and GitHub profile fields (#1484) (`6fe4dcf`)
- feat(payment): add a UPI preset that builds static upi://pay codes (#1479) (`9231a45`)
- feat: land reviewed Stitch batch 5 (email validation, WhatsApp message, frame fonts, bulk EPS/PDF, Wi-Fi card, WPA3) (#1477) (`21ded9a`)

### Bug Fixes

- fix: tidy the Stitch quality-pass leftovers (vCard and social round trips, bulk preflight, scan chime) (#1487) (`34c7ad2`)
- fix: polish what Stitch landed (frames, transparent codes, typing errors, focus, bulk cancel, PDF/EPS text) (#1485) (`ec02662`)
- fix: land reviewed Stitch batch 4 (gradient stops, Wi-Fi password warning, location retry, privacy grid, scan chime, SEPA refusal) (#1476) (`2ccf7fb`)
- fix: land reviewed Stitch batch 3 (vCard checks, toast Escape, export width, canvas, wallet fillRect) (#1473) (`473eebc`)
- fix(ui): add blur validation and state reset to ColorInput (#1434) (`016be5e`)
- fix(ui): restrict className prop to outer field wrapper containers (#1433) (`78adea0`)

### Maintenance

- test(optical-transfer): wait for the manifest before showing the wallet code (#1489) (`1273ab3`)
- refactor(utils): consolidate byte concatenation into shared bytes utility module (#1457) (`13101de`)
- test(optical-modem): give the image-simulation tests room under coverage (#1475) (`adb0d7d`)
- ci: shard unit tests, run quick checks on unreviewed Stitch PRs, trust only maintainer approvals (#1474) (`c20230f`)
- ci: refresh visual baselines on CI and stop superseded runs queueing (#1443) (`326ca51`)
- ci: keep unreviewed Stitch PRs pending instead of failing (#1472) (`9d12fa3`)

---

## [0.13.0] - 2026-10-16

### Features

- feat(bulk-csv): add pre-flight logo asset validation and error isolation (#1429) (`c2e7032`)
- feat(seo): static and SVG QR code pages, install button and guide links (#1424) (`e51b57b`)
- feat(ui): UI/UX overhaul: clearer generator, fixes with every warning, one consistent visual system (#1425) (`70b149e`)
- feat(optical-modem): cut torn captures on a slant for a phone held upright (#1423) (`c77aa02`)
- feat(optical-modem): Ultra Mono, a black-and-white 4K profile for phones that smear colour (#1422) (`86963bd`)
- feat(copy): closed-source wording, a contact address and search fixes (#1420) (`9065fea`)
- feat(optical-modem): torn-capture recovery, a robust large-grid finder and phone camera effects in the simulator (#1419) (`f17a89a`)
- feat(generator): move signed wallet passes into a developer section (#1418) (`e12f17b`)
- feat(generator): Google Wallet passes signed in the browser with your own issuer (#1417) (`0794779`)
- feat(generator): sign Apple Wallet passes in the browser with your own certificate (#1416) (`84f9d32`)
- feat(generator): Wallet card image for phone wallets (#1415) (`fd95df3`)
- feat(content): honest About and Security copy, guide links, sitemap dates and share image sizes (#1392) (`d0b9f80`)

### Bug Fixes

- fix(content): plain template blurbs, clearer messages and screen-reader names, US spelling (#1407) (`009f2c6`)
- fix(generator): draw the Grunge eyes the same way every time (#1400) (`d4473fb`)
- fix(test): run the sitemap lastmod check on Node type stripping, not tsx (#1398) (`c8f5092`)
- fix(generator): current scan verdict, faithful EPS/PDF export, MECARD address and Stitch UI lapses (#1390) (`c10c244`)

### Performance

- perf(optical-modem): tracked fiducial search, 1080p and 4K profiles and a ceiling bench (#1414) (`68ec87f`)

### Maintenance

- docs(agents): add rules from Stitch PR reviews (#1468) (`0ce7614`)
- ci: hold Stitch PRs for review and prepare main for a merge queue (#1461) (`1dd6fb0`)
- docs(foundry): list every kept dependency with its decision and effort (#1430) (`bfd8a19`)
- ci: tiered CI for the private repository (#1421) (`94a2015`)
- chore(deps): bump CI tooling (artifact actions, codeql upload-sarif, semgrep) (#1405) (`7776a33`)
- ci(release): weekly release preview, uncached version.json and explained deploy timeouts (#1399) (`852a2c2`)
- refactor: own duplicate checker, package-boundary checker and Tailwind class rule (#1396) (`1c5c976`)
- refactor: own git hooks, Markdown parser and Node type stripping (#1395) (`62911f4`)
- refactor: replace six test, CI and lint packages with our own code (#1393) (`9c0e9a1`)

---

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
