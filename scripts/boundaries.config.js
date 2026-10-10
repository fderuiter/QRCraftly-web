// @ts-check
// Deep-module enforcement for scripts/check_boundaries.js.
//
// Each package under the packages root is a DEEP MODULE: a lot of behaviour
// behind a small interface. A package's PUBLIC SURFACE is its ENTRY POINTS:
// the files at the package root. Implementation lives in SUBFOLDERS and is
// private (by convention `lib/` for implementation and `tests/` for tests,
// though any subfolder is private). A package may expose several small entry
// points (index.ts, client.ts, server.ts, …); prefer that over one giant
// barrel index.
//
// A rule is one object: its name, its comment (printed with every violation),
// a `Fix:` hint, and `forbids(edge)`, a plain function over one import edge.
// Adding a rule is adding one object. The `no-circular` rule is the one graph
// rule: it sets `circular: true` instead and the checker runs Tarjan's
// strongly connected components algorithm over the edges its `follows` keeps.

/**
 * One import edge of the graph. Paths are POSIX and relative to the checked root.
 * @typedef {object} Edge
 * @property {string} from The importing file.
 * @property {string} to The imported file, as TypeScript resolves it.
 * @property {number} line 1-based line of the import in `from`.
 * @property {string} specifier The import specifier as written.
 * @property {boolean} aliased True when the specifier goes through a tsconfig `paths` alias (`@/…`).
 * @property {boolean} typeOnly True for `import type`, `export type`, all-`type` specifier lists and `import('…')` types.
 * @property {boolean} dynamic True for `import()` and `require()`.
 */

/**
 * @typedef {object} EdgeRule
 * @property {string} name
 * @property {string} comment
 * @property {string} fix
 * @property {(edge: Edge) => boolean} forbids
 */

/**
 * @typedef {object} CircularRule
 * @property {string} name
 * @property {string} comment
 * @property {string} fix
 * @property {true} circular
 * @property {(edge: Edge) => boolean} follows Which edges a cycle may run through.
 */

/** @typedef {EdgeRule | CircularRule} Rule */

/** Where packages live. One immediate child dir per package (flat, no nesting). */
export const PACKAGES_ROOT = 'src/packages';

// --- derived helpers (no need to edit) --------------------------------------
const PACKAGE_FILE = new RegExp(`^${PACKAGES_ROOT}/([^/]+)/`);
/**
 * A package's private internals: anything nested inside a package subfolder.
 * The package's root files are its entry points and are NOT matched here:
 * they stay importable from outside.
 */
const PACKAGE_INTERNALS = new RegExp(`^${PACKAGES_ROOT}/[^/]+/[^/]+/`);
const PACKAGE_TESTS = new RegExp(`^${PACKAGES_ROOT}/([^/]+)/tests/`);

/** App layers that packages must never import (see packages-must-not-import-app-layers). */
const APP_LAYERS = /^src\/(context|hooks|components|pages)\/|^src\/registry\.tsx?$/;

/**
 * The package a file belongs to, or null outside the packages root.
 * @param {string} file
 * @returns {string | null}
 */
export function packageOf(file) {
  return PACKAGE_FILE.exec(file)?.[1] ?? null;
}

/**
 * @param {string} file
 * @returns {boolean}
 */
const isInternal = (file) => PACKAGE_INTERNALS.test(file);

/**
 * The package whose tests/ folder holds a file, or null.
 * @param {string} file
 * @returns {string | null}
 */
const testsPackageOf = (file) => PACKAGE_TESTS.exec(file)?.[1] ?? null;

/** @type {Rule[]} */
export const rules = [
  {
    name: 'entrypoint-boundary-from-app',
    comment:
      "App/root code may import a package's entry points (its root files), but nothing inside its subfolders.",
    fix: 'import the package through an entry point at its root (`@/packages/<name>` or `@/packages/<name>/<entry>`), and export what you need from there.',
    forbids: (edge) => packageOf(edge.from) === null && isInternal(edge.to),
  },
  {
    name: 'entrypoint-boundary-across-packages',
    comment:
      "A package's own files import each other freely, but may reach OTHER packages only through their entry points, never their internals.",
    fix: "import the other package through one of its root entry points, and export what you need from there instead of reaching into its subfolders.",
    forbids: (edge) => {
      const own = packageOf(edge.from);
      return own !== null && testsPackageOf(edge.from) === null && isInternal(edge.to) && packageOf(edge.to) !== own;
    },
  },
  {
    name: 'tests-through-entrypoints',
    comment:
      "A package's tests exercise it through its entry points like everyone else: they may import any package's entry points and their own tests/ fixtures, but never any package's internals, not even their own.",
    fix: "test through the package's root entry points (`../index` or `@/packages/<name>`); move shared fixtures into the package's own tests/ folder.",
    forbids: (edge) => {
      const own = testsPackageOf(edge.from);
      return own !== null && isInternal(edge.to) && testsPackageOf(edge.to) !== own;
    },
  },
  {
    name: 'tests-folder-is-private',
    comment: "A package's tests/ folder is reachable only from tests: nothing else may import fixtures.",
    fix: "move what you need out of the tests/ folder into the package's implementation and export it from an entry point.",
    forbids: (edge) => testsPackageOf(edge.from) === null && testsPackageOf(edge.to) !== null,
  },
  {
    name: 'no-circular',
    comment:
      'No dependency cycles. Type-only imports are erased at build time, so a cycle through one is not a cycle. Scope `follows` to the packages root if you want to allow cycles outside packages.',
    fix: 'break the cycle: move the shared code into a module that both sides import, inject it from the call site, or make a type import `import type`.',
    circular: true,
    follows: (edge) => !edge.typeOnly,
  },
  {
    name: 'packages-must-not-import-app-layers',
    comment:
      "Packages are app-independent deep modules: they never import the app's React layers (context, hooks, components, pages, registry). Inject stores, capabilities and callbacks from the call site instead.",
    fix: 'pass the store, capability or callback in from the app code that calls the package.',
    forbids: (edge) => packageOf(edge.from) !== null && APP_LAYERS.test(edge.to),
  },
  {
    name: 'cross-package-imports-use-alias',
    comment:
      'A package reaches another package only through the `@/packages/<name>` alias to its entry points, never a relative path such as `../../other/index`. Relative paths hide the package seam and break when either package moves (GitHub issue #980).',
    fix: 'write the import as `@/packages/<name>` (or `@/packages/<name>/<entry>`).',
    forbids: (edge) => {
      const own = packageOf(edge.from);
      const target = packageOf(edge.to);
      return own !== null && target !== null && target !== own && !edge.aliased;
    },
  },
  {
    name: 'page-content-stays-on-server',
    comment:
      'The content registry, type guides, landing copy and schema builder describe every page. Browser code reads its own page\'s share through usePageContent() (filled by src/pages/+data.ts), and Head renders the structured data, so these modules never ship to the browser (#1058). Type-only imports are fine.',
    fix: 'read the page\'s share through usePageContent(), add what is missing to src/pages/+data.ts, or make the import `import type`.',
    forbids: (edge) =>
      /^src\/(components|hooks|context|layouts|pages)\//.test(edge.from) &&
      !/^src\/layouts\/Head\.tsx$|^src\/pages\/\+(data|description)\.ts$|\.test\.tsx?$/.test(edge.from) &&
      /^src\/(data\/(contentRegistry|typeGuides|landingPageContent|relatedPages|pageContent)|utils\/schemaGenerator)\.ts$/.test(
        edge.to,
      ) &&
      !edge.typeOnly,
  },

  // Layering controls WHICH packages may depend on which; add repo-specific
  // rules here when that concern has a concrete seam.
];
