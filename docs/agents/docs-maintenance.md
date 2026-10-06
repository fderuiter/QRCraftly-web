# Documentation Maintenance

How to keep the repository docs in sync with the code, and how the doc checks run.

## `pnpm run docs:sync`: regenerate derived docs

Run it after changing any of these, then commit the files it rewrites:

| You changed                                                                                       | It updates                                                       |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A component in `src/components/ui/`, `src/components/inputs/` or `src/components/style-controls/` | Entries in `docs/public/UI_CATALOG.md`                           |
| A page in `docs/public/` or `docs/SECURITY.md`                                                    | `src/data/docs_manifest.json` (rendered on the `/security` page) |

`pnpm dev` also recompiles the docs manifest on start. `pnpm build` and `pnpm run lint` only verify it and fail if it is stale.

## `pnpm run docs:lint`: check the docs

It runs, in order:

1. `scripts/audit_markdown.js`: relative links, heading anchors, unfinished-work placeholder markers and type-checked `ts`/`tsx` snippets in `docs/*.md`, `docs/public/`, `docs/adr/`, `docs/agents/`, `docs/optical-transfer/`, `README.md`, `CONTEXT.md`, `AGENTS.md`, `src/packages/README.md`, `src/components/inputs/README.md` and `.github/rulesets/README.md`. Pages in `docs/public/` also need `publish-approved: true` frontmatter. Placeholders are allowed in files marked `draft: true`.
2. `scripts/validate_adrs.js`: ADR files are named `NNNN-kebab-title.md`, numbers start at `0001` with no gaps or duplicates, each ADR opens with a `# Title` heading, and an optional `status` is one of `proposed`, `accepted`, `deprecated` or `superseded`.
3. `scripts/validate_ui_catalog.js`: every UI component and its companion test is listed in `docs/public/UI_CATALOG.md`.
4. `scripts/compile_docs_manifest.js --check`: `src/data/docs_manifest.json` matches the current docs.

Every error names the file and prints a `Fix:` line with the remediation.

## Where the checks run

- `pnpm run lint` calls `docs:lint`.
- The Husky pre-commit hook runs lint-staged, which runs the Markdown audit, the ADR validator and the manifest check whenever a `*.md` file is staged.
- CI runs `pnpm run lint` on every pull request and on pushes that touch `docs/**` or any root `*.md` file, including `CONTEXT.md` and `AGENTS.md`.

## Adding an ADR

Take the next number after the highest existing ADR, name the file `NNNN-short-title.md`, and start it with optional `status` frontmatter and a `# Title` heading. Never delete or renumber an accepted ADR; supersede it with a new one instead.
