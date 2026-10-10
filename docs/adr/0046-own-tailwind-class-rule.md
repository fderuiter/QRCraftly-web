---
status: accepted
---

# Our Own Tailwind Class Rule, in Tailwind's Official Order

## Context

Tailwind classes were checked by `eslint-plugin-tailwindcss` 4.2, using its recommended rules with `no-custom-classname` off. The plugin brought its own tree into the lockfile (`tailwind-api-utils`, `synckit`, `postcss-nested`, `jiti`, `enhanced-resolve` and more) and called Tailwind through a worker thread for every class list, which made its three slowest rules about 35 s of a full `eslint .` run. Its `callees` setting was also misspelt in our config (the plugin reads `functions`), so `mergeClasses(...)` arguments were never checked.

A second formatter, `pnpm run format:classes` (`scripts/sort_tailwind_classes.js`), carried an alphabetical sorter beside the plugin's order, so the two could disagree.

[ADR 0040](./0040-in-house-first.md) asks us to replace packages that do small jobs we can do ourselves (#1175, #1194).

## Decision

- **One rule, `qrcraftly/tailwind-classes`** (`eslint/rules/tailwind-classes.js`, registered in the one `qrcraftly` plugin in `eslint/rules/index.js`), checks the static class lists in `className` and `class` attributes and in calls to `classnames`, `clsx`, `ctl` and `mergeClasses`, including the static parts of template literals. A class glued to an interpolation (`bg-${tone}`) stays where it is. The checks are:
  - **order**: Tailwind's official order from the design system's `getClassOrder`, which groups classes by variant; unknown classes go first, in their original order;
  - **duplicates**, removed;
  - **important**: `!p-2` is written `p-2!`;
  - **negative arbitrary values**: `-top-[5px]` is written `top-[-5px]`;
  - **unnecessary arbitrary values**: `p-[8px]` is written `p-2` when a theme token gives the same CSS. The snapshot compiles both classes and compares their declarations with theme variables and `calc()` resolved (1rem = 16px). It tries named keys (`w-[100%]` is `w-full`), bare numbers (`z-[10]` is `z-10`) and whole spacing steps plus the classic half steps 0.5 to 3.5, so `w-[17px]` is not rewritten as `w-4.25`;
  - **shorthands**: `px-2 py-2` is `p-2`, `w-4 h-4` is `size-4`;
  - **contradictions**: two classes that set the same CSS properties under the same variants, such as `p-2 p-4` or `flex block`. This one has no auto-fix.

  Custom and unknown classes are never reported.

- **A cached design-system snapshot.** ESLint rules are synchronous and Tailwind's loader is asynchronous. `scripts/tailwind/design_system.js` loads the design system from `src/layouts/index.css` through Tailwind's own `__unstable__loadDesignSystem` and writes `node_modules/.cache/qrcraftly/tailwind.json`, keyed by a hash of the stylesheet, the Tailwind version and the generator's own source. The snapshot holds each known class's rank in the official order and, for each utility, the CSS properties it sets and its token equivalent. When the key is stale or a file uses a class the snapshot has not seen, the rule rebuilds it in one short synchronous child process (through `scripts/utils/execHelper.js`). A fresh snapshot is seeded from the string literals in `src/`, `tests/`, `e2e/` and `scripts/`, so a cold run spawns the child about once.

- **One source of order.** `pnpm run format:classes` is a thin CLI that runs only this rule with `--fix`, so it and `eslint --fix` always produce the same classes. The alphabetical sorter is gone.

- `eslint-plugin-tailwindcss` is removed.

## Consequences

- The lockfile loses 24 packages. On a warm snapshot the rule takes about 0.6 s of a full `eslint .` run instead of about 35 s.
- A cold snapshot takes about 2 s to build. Later rebuilds, when a file uses a new class, reuse the cached utility entries. We do not use Tailwind's own `canonicalizeCandidates`: its first call in a process takes 5 to 10 s, and it took 11 s on one compound grid value.
- `__unstable__loadDesignSystem` is not a stable API. If a Tailwind release moves it or the methods the snapshot uses, the snapshot step throws with the Tailwind version and a pointer to this ADR. It never passes silently.
- The shorthand families and negative-value utilities are a fixed table in the rule, taken from the plugin. A new Tailwind shorthand needs a new row.
- Contradictions are checked within one string. `mergeClasses` resolves conflicts between its arguments on purpose, so separate arguments may override each other.
