---
status: accepted
---

# Client-Side Generation and Storage Allowlist

## Context

QR code payloads frequently contain sensitive personal data, such as Wi-Fi passwords, contact cards, healthcare identifiers, and authentication tokens. Storing user payloads on remote servers or unencrypted in browser storage creates severe HIPAA/GDPR compliance liabilities.

## Decision

We execute all QR code generation, canvas rendering, and scannability evaluation strictly client-side in volatile browser memory. Persistent browser storage (`localStorage`, `sessionStorage`, `IndexedDB`) is restricted to an explicit allowlist of keys verified by an AST build auditor (`scripts/storage_privacy_ast_auditor.js`).

## Rationale

Client-side execution eliminates data transit across external networks and ensures zero server-side data retention liability. An automated AST auditor prevents accidental persistence of user payloads during development.

## Consequences

- Zero backend database liability or exposure to transit intercept attacks for static QR codes.
- Batch or headless generation cannot be performed server-side without a client rendering context.
- Unapproved persistent storage keys fail the automated build pipeline closed.
- The allowlist holds preference, template and probe keys only: `qrcraftly:theme` (colour-theme preference: `light`, `dark` or `system`), `qrcraftly:brand-templates` (up to 50 saved style templates: colours, patterns, borders and logo sizing, never QR content, text or uploaded images) and `__test__`. The dynamic-link keys `qrcraftly:dynamic-redirects` and `qrcraftly:dynamic-consent-accepted` were removed with dynamic QR codes ([ADR 0022](./0022-no-dynamic-qr-codes-client-side-only.md)). Adding a key requires updating the auditor, its tests, `AGENTS.md` and the privacy documentation together.
