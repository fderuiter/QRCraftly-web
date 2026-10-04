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

// pnpm run bench:qr-encode [--quick] [--json <file>]: QR encoder time per encode (#1177).
import fs from 'node:fs';
import { runQrEncodeBench } from '../tests/foundry/qrEncodeBench.ts';
import { qrEncoder } from '../tests/fixtures/qrEncoder.ts';

const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const jsonAt = argv.indexOf('--json');
const jsonPath = jsonAt >= 0 ? argv[jsonAt + 1] : undefined;

const report = runQrEncodeBench(qrEncoder, { samples: quick ? 50 : 1000 });

console.log(`QR encoder benchmark (${report.runtime})\n`);
console.log(`${'Case'.padEnd(16)} | ${'Bytes'.padStart(6)} | ${'Version'.padStart(7)} | ${'p50 µs'.padStart(9)} | ${'p95 µs'.padStart(9)}`);
console.log('-'.repeat(60));
for (const c of report.cases) {
  console.log(`${c.name.padEnd(16)} | ${String(c.bytes).padStart(6)} | ${String(c.version).padStart(7)} | ${c.p50Micros.toFixed(1).padStart(9)} | ${c.p95Micros.toFixed(1).padStart(9)}`);
}
if (jsonPath) {
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${jsonPath}`);
}
