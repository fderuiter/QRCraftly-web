# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
