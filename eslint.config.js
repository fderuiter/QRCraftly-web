import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import securityPlugin from "eslint-plugin-security";
import jsdoc from "eslint-plugin-jsdoc";
import jsxA11y from "eslint-plugin-jsx-a11y";
import tailwind from "eslint-plugin-tailwindcss";
import { NODE_GLOBALS, COMMONJS_GLOBALS } from "./eslint/node-globals.js";

// Unit/integration tests and their support code (Vitest + Testing Library).
const TEST_FILES = [
  "**/*.test.{ts,tsx}",
  "tests/**/*.{ts,tsx}",
  "src/**/tests/**/*.{ts,tsx}",
  "src/**/__mocks__/**/*.{ts,tsx}",
  "src/test/**/*.{ts,tsx}",
  "vitest.setup.ts"
];

// Node-side tooling: build/audit scripts and root config files.
const NODE_FILES = ["scripts/**/*.{js,ts,cjs}", "*.config.{js,ts}"];

// JSDoc rules that catch real documentation bugs. The stylistic "require-*" rules are deliberately
// not enabled: they generated hundreds of empty `/** */` and `@param x` stubs (#982, #992).
const JSDOC_CORRECTNESS_RULES = {
  "jsdoc/check-param-names": ["error", { checkDestructured: false }],
  "jsdoc/check-tag-names": ["error", { typed: true }],
  "jsdoc/check-alignment": "error",
  "jsdoc/escape-inline-tags": "error",
  "jsdoc/no-types": "error",
  "jsdoc/require-param-name": "error",
  "jsdoc/no-multi-asterisks": "error",
  "jsdoc/empty-tags": "error",
  "jsdoc/no-blank-blocks": "error",
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-ssr/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".wrangler/**",
      ".vike/**",
      ".agents/**",
      // Agent worktrees are copies of the repository, not part of it.
      ".claude/**",
      ".jules/**",
      ".dependency-cruiser.cjs"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      // ignoreReadBeforeAssign: a `let` read by a closure before its single deferred assignment (e.g. a
      // watchdog timer cleared in `cleanup`) cannot become `const` without a temporal-dead-zone hazard.
      "prefer-const": ["error", { ignoreReadBeforeAssign: true }]
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react": reactPlugin,
      "react-hooks": reactHooksPlugin,
      "security": securityPlugin,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      // The TypeScript compiler reports undefined names, more accurately than this rule
      // (typescript-eslint's advice), and typecheck runs in lint, CI and the pre-commit hook.
      "no-undef": "off",
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...securityPlugin.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/display-name": "off",
      "react/no-unescaped-entities": "off",
      "react/no-danger": "error",

      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-this-alias": "off",

      "react-hooks/exhaustive-deps": "error",
      // React Compiler rules. The app does not use the React Compiler, and these flag patterns that
      // are correct without it (ref-driven arcade game loops, effects that sync external state:
      // ~26 hits in 20 files), so they stay off until the compiler is adopted.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",

      // Flags every `obj[key]` access, typed keys included (~170 hits, effectively all false positives).
      "security/detect-object-injection": "off",

      "no-useless-escape": "off",
      "no-case-declarations": "off",
      "no-empty": "off",
      "no-useless-assignment": "off",
      "no-control-regex": "off",
    },
    settings: {
      react: {
        version: "detect"
      }
    }
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: TEST_FILES,
    plugins: { jsdoc },
    settings: { jsdoc: { mode: "typescript" } },
    rules: JSDOC_CORRECTNESS_RULES
  },
  {
    files: TEST_FILES,
    rules: {
      // Tests stub browser/worker APIs, build partial fixtures and destructure unused helpers;
      // type-safety and the security heuristics (fs paths, regexes built from fixtures) add noise there.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off",
      "security/detect-unsafe-regex": "off",
      // `vi.mock` factories define fake `use*` hooks at module scope.
      "react-hooks/rules-of-hooks": "off"
    }
  },
  {
    files: ["e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Playwright fixtures call `use()`, which the hooks plugin mistakes for React's `use`.
      "react-hooks/rules-of-hooks": "off",
      "security/detect-non-literal-fs-filename": "off",
      "security/detect-non-literal-regexp": "off"
    }
  },
  {
    files: NODE_FILES,
    languageOptions: {
      globals: NODE_GLOBALS
    },
    rules: {
      // Build tooling reads and writes paths derived from the repository layout, never user input.
      "security/detect-non-literal-fs-filename": "off"
    }
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...NODE_GLOBALS, ...COMMONJS_GLOBALS }
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off"
    }
  },
  {
    files: ["src/pages/dev-sandbox/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off"
    }
  },
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    ignores: ["src/pages/dev-sandbox/**/*"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/dev-sandbox", "**/dev-sandbox/**"],
              message: "Developer sandbox assets cannot be imported into production modules."
            }
          ]
        }
      ]
    }
  },
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: {
      tailwindcss: tailwind,
    },
    rules: {
      ...tailwind.configs.recommended.rules,
      "tailwindcss/no-custom-classname": "off"
    },
    settings: {
      tailwindcss: {
        callees: ["classnames", "clsx", "ctl", "mergeClasses"],
        cssConfigPath: "src/layouts/index.css"
      }
    }
  }
);
