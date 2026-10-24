/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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
 * Every test file must belong to exactly one Vitest project (#1608). The include lists are kept by
 * hand, so a new directory or file name could otherwise fall out of every project and never run,
 * or land in two and run twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import viteConfig from '../vite.config';
import buildConfig from '../vitest.build.config';
import slowConfig from '../vitest.slow.config';

const ROOT = path.resolve(__dirname, '..');
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', '.claude', 'e2e', 'coverage']);

interface Project {
  name: string;
  include: string[];
  exclude: string[];
}

/** Test files under `dir`, as POSIX paths relative to the repository root. */
function testFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const relativePath = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...testFiles(relativePath));
    else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) found.push(relativePath);
  }
  return found;
}

function projects(): Project[] {
  const resolved = typeof viteConfig === 'function' ? viteConfig({ command: 'serve', mode: 'test' }) : viteConfig;
  const unit = (resolved.test?.projects ?? []).map((project) => {
    const test = (project as { test: { name: string; include: string[]; exclude?: string[] } }).test;
    return { name: test.name, include: test.include, exclude: test.exclude ?? [] };
  });
  const separate = [slowConfig, buildConfig].map((config) => {
    const test = config.test ?? {};
    return { name: String(test.name), include: test.include ?? [], exclude: test.exclude ?? [] };
  });
  return [...unit, ...separate];
}

const matches = (file: string, project: Project): boolean =>
  project.include.some((glob) => path.matchesGlob(file, glob)) && !project.exclude.some((glob) => path.matchesGlob(file, glob));

describe('Vitest projects', () => {
  it('run every test file exactly once', () => {
    const all = projects();
    expect(all.map((project) => project.name)).toEqual(['unit-logic', 'browser-ui', 'slow', 'build-output']);
    const files = testFiles('');
    expect(files.length).toBeGreaterThan(400);
    const misplaced = files
      .map((file) => ({ file, in: all.filter((project) => matches(file, project)).map((project) => project.name) }))
      .filter((entry) => entry.in.length !== 1);
    expect(misplaced, 'Fix: rename the file to a pattern one project includes, or add it to exactly one project in vite.config.ts, vitest.slow.config.ts or vitest.build.config.ts').toEqual([]);
  });

  it('notices a file that no project runs', () => {
    const all = projects();
    expect(all.filter((project) => matches('src/packages/x/tests/a.test.ts', project)).map((project) => project.name)).toEqual(['unit-logic']);
    expect(all.filter((project) => matches('src/packages/x/tests/a.slow.test.ts', project)).map((project) => project.name)).toEqual(['slow']);
    expect(all.filter((project) => matches('tests/build-output/a.test.ts', project)).map((project) => project.name)).toEqual(['build-output']);
    expect(all.filter((project) => matches('src/packages/x/tests/a.test.mjs', project))).toEqual([]);
  });
});
