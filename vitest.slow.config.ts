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
 * Vitest configuration for the slow tests and the benchmarks (#1608). Tests that take 5 s or more
 * on a laptop are named `*.slow.test.ts` and stay out of the default unit run; benchmarks are
 * `*.bench.ts` and never assert a time. CI runs both with `pnpm run test:slow` nightly, on the
 * full tier and on any pull request that changes the optical transfer code they cover
 * (`slowTests` in scripts/ci/ci_plan.js).
 */
import path from 'path';
import { defineConfig } from 'vitest/config';
import { foundryDefines } from './scripts/utils/rustWorkspace.js';

export default defineConfig({
  // The same Foundry switches vite.config.ts defines, which the transfer code reads (ADR 0033).
  define: foundryDefines(),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    name: 'slow',
    environment: 'node',
    include: ['src/**/*.slow.test.ts', 'tests/**/*.slow.test.ts'],
    testTimeout: 300_000,
    benchmark: {
      include: ['src/**/*.bench.ts'],
    },
  },
});
