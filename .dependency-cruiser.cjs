// @ts-check
// Deep-module enforcement for dependency-cruiser.
//
// Each package under the packages root is a DEEP MODULE: a lot of behaviour
// behind a small interface. A package's PUBLIC SURFACE is its ENTRY POINTS:
// the files at the package root. Implementation lives in SUBFOLDERS and is
// private (by convention `lib/` for implementation and `tests/` for tests,
// though any subfolder is private). A package may expose several small entry
// points (index.ts, client.ts, server.ts, …); prefer that over one giant
// barrel index.

/** Where packages live. One immediate child dir per package (flat, no nesting). */
const PACKAGES_ROOT = "src/packages";

// --- derived patterns (no need to edit) -------------------------------------
const R = PACKAGES_ROOT;
/**
 * A package's private internals: anything nested inside a package subfolder.
 * The package's root files are its entry points and are NOT matched here:
 * they stay importable from outside.
 */
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

/** App layers that packages must never import (see packages-must-not-import-app-layers). */
const APP_LAYERS = "^src/(context|hooks|components|pages)/|^src/registry\\.tsx?$";

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-app",
      comment:
        "App/root code may import a package's entry points (its root files), but nothing inside its subfolders.",
      severity: "error",
      from: { pathNot: `^${R}/` },
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment:
        "A package's own files import each other freely, but may reach OTHER packages only through their entry points, never their internals.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/`,
      },
    },
    {
      name: "tests-through-entrypoints",
      comment:
        "A package's tests exercise it through its entry points like everyone else: they may import any package's entry points and their own tests/ fixtures, but never any package's internals, not even their own.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/tests/` },
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/tests/`,
      },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "A package's tests/ folder is reachable only from tests: nothing else may import fixtures.",
      severity: "error",
      from: { pathNot: `^${R}/[^/]+/tests/` },
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: "no-circular",
      comment: "No dependency cycles. Scope to `^${R}/` if you want to allow cycles outside packages.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    {
      name: "packages-must-not-import-app-layers",
      comment:
        "Packages are app-independent deep modules: they never import the app's React layers (context, hooks, components, pages, registry). Inject stores, capabilities and callbacks from the call site instead.",
      severity: "error",
      from: { path: `^${R}/` },
      to: { path: APP_LAYERS },
    },
    {
      name: "cross-package-imports-use-alias",
      comment:
        "A package reaches another package only through the `@/packages/<name>` alias to its entry points, never a relative path such as `../../other/index`. Relative paths hide the package seam and break when either package moves (GitHub issue #980).",
      severity: "error",
      from: { path: `^${R}/([^/]+)/` },
      to: {
        path: `^${R}/`,
        pathNot: `^${R}/$1/`,
        dependencyTypesNot: ["aliased"],
      },
    },

    {
      name: "page-content-stays-on-server",
      comment:
        "The content registry, type guides, landing copy and schema builder describe every page. Browser code reads its own page's share through usePageContent() (filled by src/pages/+data.ts), and Head renders the structured data, so these modules never ship to the browser (#1058). Type-only imports are fine.",
      severity: "error",
      from: {
        path: "^src/(components|hooks|context|layouts|pages)/",
        pathNot: "^src/layouts/Head\\.tsx$|^src/pages/\\+(data|description)\\.ts$|\\.test\\.tsx?$",
      },
      to: {
        path: "^src/(data/(contentRegistry|typeGuides|landingPageContent|relatedPages|pageContent)|utils/schemaGenerator)\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },

    // Layering controls WHICH packages may depend on which; add repo-specific
    // rules here when that concern has a concrete seam.
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
