/**
 * `pnpm run lint` (#1616): every static check, in parallel groups.
 *
 * Nothing in the chain reads another step's output, and only ESLint and tsc are slow, so
 * each runs in its own group while the third group runs the other checks one after another.
 * Every command runs even when an earlier one fails. Each command's output is printed as one
 * block, in the order below, followed by a summary; the run fails if any command failed, and
 * the summary names every one that did.
 *
 * Usage: node scripts/lint.js
 */
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { runBinary } from './utils/execHelper.js';

/** Groups run at the same time; the commands inside a group run in order. */
export const LINT_GROUPS = [
  [['eslint', '.', '--max-warnings', '0']],
  [['tsc', '--noEmit']],
  [
    ['node', 'scripts/dependency_compliance.js'],
    ['node', 'scripts/rust_no_deps_check.js'],
    ['node', 'scripts/git_lineage_auditor.js'],
    ['node', 'scripts/storage_privacy_ast_auditor.js'],
    ['node', 'scripts/path_invariance_auditor.js'],
    ['node', 'scripts/static-path-tracker.js'],
    ['pnpm', 'run', 'docs:lint'],
    ['pnpm', 'run', 'lint:boundaries'],
    ['knip'],
    ['knip', '--production', '--include', 'files'],
    ['node', 'scripts/contrast_check.js'],
    ['node', 'scripts/design_token_audit.js'],
    ['prettier', '--check', '.'],
    ['node', 'scripts/check-duplication.js'],
  ],
];

/**
 * Runs the groups and returns each command's result in declaration order.
 * @param {string[][][]} groups - Groups of [file, ...args] commands
 * @param {(file: string, args: string[]) => Promise<{ status: number, output: string }>} [run]
 * @returns {Promise<{ command: string, status: number, output: string, ms: number }[]>}
 */
export async function runLintGroups(groups, run = (file, args) => runBinary(file, args)) {
  const results = await Promise.all(
    groups.map(async (group) => {
      const done = [];
      for (const [file, ...args] of group) {
        const start = performance.now();
        const { status, output } = await run(file, args);
        done.push({ command: [file, ...args].join(' '), status, output, ms: performance.now() - start });
      }
      return done;
    }),
  );
  return results.flat();
}

/**
 * Prints each command's block, then the summary.
 * @param {{ command: string, status: number, output: string, ms: number }[]} results
 * @param {(line: string) => void} [print]
 * @returns {string[]} The commands that failed
 */
export function report(results, print = (line) => console.log(line)) {
  for (const { command, output } of results) {
    print(`\n$ ${command}`);
    if (output.trim()) print(output.trimEnd());
  }
  print('\nLint summary:');
  for (const { command, status, ms } of results) {
    print(`${status === 0 ? '✅' : '❌'} ${command} (${(ms / 1000).toFixed(1)} s)`);
  }
  const failed = results.filter((r) => r.status !== 0).map((r) => r.command);
  if (failed.length > 0) print(`\n❌ ${failed.length} lint step(s) failed: ${failed.join('; ')}`);
  return failed;
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const failed = report(await runLintGroups(LINT_GROUPS));
  process.exitCode = failed.length > 0 ? 1 : 0;
}
