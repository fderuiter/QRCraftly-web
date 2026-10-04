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

import { describe, expect, it } from 'vitest';
import { BENCH_CALLS, runWasmBench } from './wasmBench';

describe('bench:wasm (#1182)', () => {
  it('reports size, cold start and per-call time for every committed module', async () => {
    const report = await runWasmBench({ coldRuns: 2, callMs: 1 });
    expect(report.bench).toBe('wasm');
    const selftest = report.modules.find((module) => module.module === 'selftest');
    expect(selftest).toBeDefined();
    expect(selftest?.bytes).toBeGreaterThan(selftest?.gzipBytes ?? Infinity);
    expect(selftest?.compileMs).toBeGreaterThanOrEqual(0);
    expect(selftest?.calls.map((call) => call.name)).toEqual(BENCH_CALLS.selftest.map((call) => call.name));
    for (const call of selftest?.calls ?? []) {
      expect(call.iterations).toBeGreaterThan(0);
      expect(call.microsPerCall).toBeGreaterThanOrEqual(0);
    }
  });

  it('measures only the modules asked for', async () => {
    expect((await runWasmBench({ coldRuns: 1, callMs: 1 }, ['nothing'])).modules).toEqual([]);
  });
});
