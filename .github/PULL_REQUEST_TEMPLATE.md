# Pull Request Description

## 1. Summary of Changes
Please provide a brief, high-level summary of the modifications introduced by this pull request.

## 2. Component Reuse & Redundancy Check
All developers must consult the local [UI Component Registry & Catalog](docs/public/UI_CATALOG.md) prior to creating any new interface controls, slider elements, input fields, or custom color utility functions.

### Shared Assets Reused in this PR:
Please list all pre-existing UI elements or utilities from the [UI Component Registry & Catalog](docs/public/UI_CATALOG.md) that you reused in this submission:
*   *Component/Utility 1:* [e.g., RangeInput for size selection slider]
*   *Component/Utility 2:* [e.g., getContrastRatio from `@/packages/core/encoding` for contrast verification]

### Developer Verification Checklist:
- [ ] **Catalog Audit:** I have reviewed the [UI Component Registry & Catalog](docs/public/UI_CATALOG.md) and verified that no existing component matches the functionality of my additions.
- [ ] **No Slider Duplication:** I have NOT introduced any duplicate range slider logic or custom slider components; any sliders added in this PR reuse the pre-existing `RangeInput`.
- [ ] **No Button Duplication:** I have NOT introduced custom buttons; all buttons utilize standard `Button` primitives from `src/components/ui/`.
- [ ] **No Custom Color Math:** I have NOT written custom hex validation, relative luminance formulas, sRGB conversion, or contrast math. I have imported these from `src/packages/core/encoding.ts` or the scannability package (`auditModuleContrast` from `src/packages/scannability`) where necessary.

### Verification:
- [ ] This PR targets `main` and its title follows [Conventional Commits](https://www.conventionalcommits.org/).
- [ ] `pnpm run lint` passes.
- [ ] `pnpm exec vitest run` passes.
- [ ] `pnpm build` and `pnpm test:e2e` pass (required when touching build, routing, rendering, or input flows).

---

## 3. Peer Review Checklist (Reviewers Only)
Reviewers must manually verify the submission against the local UI catalog to prevent design drift and logical redundancy.

- [ ] **Component Audit:** Verified that the author did not implement duplicate buttons, inputs, or layout controls, and utilized components from `src/components/ui/` where applicable.
- [ ] **Slider Logic Check:** Confirmed that no redundant sliders or range controls are introduced (all slider inputs reuse `RangeInput`).
- [ ] **Color Logic Check:** Confirmed that no custom color parsing, hex validation, or relative luminance/contrast calculation logic was added (reused `src/packages/core/encoding.ts`).
- [ ] **Catalog Alignment:** Confirmed that any new reusable UI elements introduced are documented or aligned with the [UI Component Registry & Catalog](docs/public/UI_CATALOG.md).
