/**
 * `pnpm run format:classes`: sorts Tailwind classes in Tailwind's official order (ADR 0046).
 *
 * A thin CLI around the `qrcraftly/tailwind-classes` ESLint rule's fixer, run on its own, so this
 * command and `eslint --fix` always produce the same classes.
 *
 * Usage: `node scripts/sort_tailwind_classes.js [--check] [files or directories...]` (default: `src`).
 */
import { ESLint } from 'eslint';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import qrcraftly from '../eslint/rules/index.js';

const RULE_ID = 'qrcraftly/tailwind-classes';

/**
 * Runs the class rule (and only it) over the targets.
 * @param {object} options Options.
 * @param {string[]} [options.targets] Files or directories, relative to `cwd` (default `src`).
 * @param {boolean} [options.check] Report instead of writing fixes.
 * @param {string} [options.cwd] Repository root.
 * @param {Record<string, unknown>} [options.ruleOptions] Options passed to the rule.
 * @returns {Promise<{ problems: Array<{ file: string, line: number, message: string }>, fixedFiles: string[] }>}
 *   Remaining problems and the files whose classes changed.
 */
export async function formatClasses({ targets = ['src'], check = false, cwd = process.cwd(), ruleOptions } = {}) {
  const eslint = new ESLint({
    cwd,
    fix: !check,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        linterOptions: { reportUnusedDisableDirectives: 'off' },
        plugins: { qrcraftly },
        rules: { [RULE_ID]: ruleOptions ? ['error', ruleOptions] : 'error' },
      },
    ],
  });
  const results = await eslint.lintFiles(targets);
  if (!check) await ESLint.outputFixes(results);
  const problems = [];
  for (const result of results) {
    for (const message of result.messages) {
      if (message.ruleId === RULE_ID || message.fatal) {
        problems.push({ file: path.relative(cwd, result.filePath).split(path.sep).join('/'), line: message.line, message: message.message });
      }
    }
  }
  const fixedFiles = results.filter((r) => typeof r.output === 'string').map((r) => path.relative(cwd, r.filePath).split(path.sep).join('/'));
  return { problems, fixedFiles };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const targets = args.filter((arg) => arg !== '--check');
  formatClasses({ targets: targets.length > 0 ? targets : ['src'], check })
    .then(({ problems, fixedFiles }) => {
      for (const file of fixedFiles) console.log(`sorted ${file}`);
      for (const p of problems) console.error(`${p.file}:${p.line} ${p.message}`);
      if (problems.length > 0) {
        console.error(`${problems.length} Tailwind class problem(s)${check ? '' : ' need a manual fix'}.`);
        process.exit(1);
      }
      console.log(check ? 'Tailwind classes are in order.' : 'Tailwind classes sorted.');
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
