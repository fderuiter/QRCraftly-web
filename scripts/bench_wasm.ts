/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * Rust module benchmark (#1182, ADR 0033): `pnpm run bench:wasm [options]`.
 *
 * For every module in `src/wasm/`, reports its size, its cold start (compile plus instantiate,
 * median of several runs) and the time per call of the exports listed in
 * `tests/foundry/wasmBench.ts`. Times are from Node's V8 and vary by machine; sizes are exact.
 *
 * Options:
 *   --module <name>   Only this module (repeatable).
 *   --quick           Fewer cold runs and shorter call loops.
 *   --json <file>     Also write the report as JSON.
 */
import fs from 'node:fs';
import { runWasmBench } from '../tests/foundry/wasmBench.ts';

const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const only = argv.flatMap((arg, i) => (arg === '--module' && argv[i + 1] ? [argv[i + 1]] : []));
const jsonAt = argv.indexOf('--json');
const jsonPath = jsonAt >= 0 ? argv[jsonAt + 1] : undefined;

const report = await runWasmBench({ coldRuns: quick ? 5 : 25, callMs: quick ? 50 : 500 }, only);

console.log(`Rust module benchmark (${report.runtime})\n`);
console.log(`${'Module'.padEnd(16)} | ${'Bytes'.padStart(8)} | ${'Gzip'.padStart(8)} | ${'Compile ms'.padStart(10)} | ${'Instantiate ms'.padStart(14)}`);
console.log('-'.repeat(68));
for (const module of report.modules) {
  console.log(
    `${module.module.padEnd(16)} | ${String(module.bytes).padStart(8)} | ${String(module.gzipBytes).padStart(8)} | ${module.compileMs.toFixed(3).padStart(10)} | ${module.instantiateMs.toFixed(3).padStart(14)}`
  );
}
for (const module of report.modules) {
  if (module.calls.length === 0) continue;
  console.log(`\n${module.module} per call:`);
  for (const call of module.calls) console.log(`  ${call.name.padEnd(20)} ${call.microsPerCall.toFixed(3).padStart(10)} µs  (${call.iterations} calls)`);
}
if (jsonPath) {
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${jsonPath}`);
}
