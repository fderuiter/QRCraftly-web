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
 * The unit run has no build, so a unit test that reads `dist/` behind an `existsSync` guard passes
 * without checking anything (#1609). Checks on the built site belong in `tests/build-output/`,
 * which runs after `pnpm run build` and fails when there is no build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// This file names such a path in its own self-test.
const SELF = 'tests/build_output_guard.test.ts';
const READS_REAL_BUILD = /['"`](?:\.\.\/)+dist\//;

/** Unit test files under `dir`, as POSIX paths relative to the repository root. */
function unitTestFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relativePath = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && relativePath !== 'tests/build-output') found.push(...unitTestFiles(relativePath));
    } else if (/\.test\.tsx?$/.test(entry.name) && relativePath !== SELF) {
      found.push(relativePath);
    }
  }
  return found;
}

describe('Checks on the build', () => {
  it('live in tests/build-output, not in the unit run that has no build', () => {
    const offenders = [...unitTestFiles('tests'), ...unitTestFiles('src')].filter((file) =>
      READS_REAL_BUILD.test(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    );
    expect(offenders, 'Fix: move the check into tests/build-output/, which runs after pnpm run build').toEqual([]);
  });

  it('notices a test that reads the real build', () => {
    expect(READS_REAL_BUILD.test("path.join(__dirname, '../dist/client/sw.js')")).toBe(true);
    expect(READS_REAL_BUILD.test("path.join(work, 'dist', 'client')")).toBe(false);
  });
});
