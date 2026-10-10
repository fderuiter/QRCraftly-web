/**
 * The Node globals our plain JavaScript files use, replacing the `globals`
 * package (GitHub issue #1192). TypeScript files leave undefined names to the
 * compiler, so this list only serves `scripts/**`, the root config files and
 * the CommonJS files. It was built from what ESLint flagged with an empty
 * list; add a name here when a script starts using a new one.
 */

/** Globals in every Node module. */
export const NODE_GLOBALS = Object.freeze({
  Buffer: "readonly",
  console: "readonly",
  process: "readonly",
  TextDecoder: "readonly",
  URL: "readonly",
});

/** Globals that only CommonJS modules have. */
export const COMMONJS_GLOBALS = Object.freeze({
  __dirname: "readonly",
  __filename: "readonly",
  exports: "writable",
  module: "readonly",
  require: "readonly",
});
