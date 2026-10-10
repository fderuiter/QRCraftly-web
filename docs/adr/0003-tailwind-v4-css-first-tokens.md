---
status: accepted
---

# Pure CSS-First Tailwind v4 Tokens

## Context

Tailwind CSS v4 replaces JavaScript configuration files (`tailwind.config.js`) with native CSS `@theme` and `@variant` directives. Supporting dual configuration modes or legacy wrapper files creates drift and tool fragmentation across build steps.

## Decision

We manage all design system tokens, typography scales, semantic color mappings, and dark mode variants exclusively in `src/layouts/index.css` using native `@theme` blocks, eliminating `tailwind.config.js` entirely.

> **Current state (September 2026):** `src/layouts/index.css` declares only `@variant dark`. The app uses Tailwind's default palette and has no `@theme` block yet; custom tokens, when added, go in an `@theme` block in that file.

## Rationale

A single CSS-first source of truth leverages native CSS cascade rules and removes build-time JavaScript translation overhead. Utility classes follow Tailwind's official order, enforced by the `qrcraftly/tailwind-classes` ESLint rule and `pnpm run format:classes` ([ADR 0046](./0046-own-tailwind-class-rule.md)).

## Consequences

- Direct, zero-config token definitions aligned with the modern CSS ecosystem.
- Custom design token additions must be authored in `src/layouts/index.css` rather than exported JavaScript objects.
