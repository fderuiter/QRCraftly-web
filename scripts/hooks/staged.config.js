/**
 * The pre-commit rules: which commands run on which staged files (ADR 0044).
 * `scripts/hooks/staged.js` reads this table.
 *
 * Each rule has a `name`, a `match` test on the staged path (POSIX, relative to
 * the repository root) and a list of commands, run in order. A command is:
 *
 * - `label`: shown in the hook output and in the failure summary.
 * - `run`: the command as an argument array. The first entry is `node` (this
 *   Node binary) or the name of a package in node_modules whose `bin` script
 *   runs with Node. No shell is involved, so file names need no quoting.
 * - `check` (optional): marks a fixer. `run` may rewrite files; `check` is the
 *   read-only form used on partly staged files, which are never rewritten.
 * - `files: false` (optional): run once without file arguments, for checks
 *   that audit a whole set of files.
 *
 * Rules run in table order, and the run stops at the first failing command.
 */

/** @typedef {{ label: string, run: string[], check?: string[], files?: boolean }} StagedCommand */
/** @typedef {{ name: string, match: (file: string) => boolean, commands: StagedCommand[] }} StagedRule */

/**
 * Builds the Prettier fixer.
 * @returns {StagedCommand}
 */
const prettier = () => ({
  label: 'Prettier',
  run: ['prettier', '--write'],
  check: ['prettier', '--check'],
});

/**
 * Builds the ESLint and Prettier fixer pair for code files.
 * @returns {StagedCommand[]}
 */
const eslintAndPrettier = () => [
  {
    label: 'ESLint',
    run: ['eslint', '--fix', '--no-warn-ignored'],
    check: ['eslint', '--no-warn-ignored'],
  },
  prettier(),
];

/** @type {StagedRule[]} */
export default [
  {
    name: 'every staged file',
    match: () => true,
    commands: [
      { label: 'secret scanner', run: ['node', 'scripts/secret-scanner.js'] },
      {
        label: 'storage privacy auditor',
        run: ['node', 'scripts/storage_privacy_ast_auditor.js'],
      },
      {
        label: 'UI catalog validator',
        run: ['node', 'scripts/validate_ui_catalog.js'],
      },
      {
        label: 'static path tracker',
        run: ['node', 'scripts/static-path-tracker.js'],
      },
      {
        label: 'git lineage auditor',
        run: ['node', 'scripts/git_lineage_auditor.js'],
      },
    ],
  },
  {
    name: 'JavaScript and TypeScript',
    match: (file) => /\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(file),
    commands: eslintAndPrettier(),
  },
  {
    name: 'CSS, JSON and YAML',
    match: (file) => /\.(?:css|json|yml|yaml)$/.test(file),
    commands: [prettier()],
  },
  {
    // The docs:lint suite minus the UI catalog check, which the first rule
    // already runs on the staged files. The audits cover the whole doc set,
    // so they run once without file arguments.
    name: 'Markdown',
    match: (file) => /\.md$/.test(file),
    commands: [
      prettier(),
      {
        label: 'Markdown audit',
        run: ['node', 'scripts/audit_markdown.js'],
        files: false,
      },
      {
        label: 'ADR validator',
        run: ['node', 'scripts/validate_adrs.js'],
        files: false,
      },
    ],
  },
];
