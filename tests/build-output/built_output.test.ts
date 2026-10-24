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
 * Checks on the real build in `dist/client` (#1609). The unit run has no build, so these used to
 * pass there without asserting anything; they now run only after a build and fail without one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST_DIR = path.join(ROOT, 'dist/client');

const readBuilt = (relativePath: string): string => fs.readFileSync(path.join(DIST_DIR, relativePath), 'utf8');

beforeAll(() => {
  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error('No build in dist/client. Fix: run `pnpm run build`, then `pnpm run test:build`.');
  }
});

describe('Built WebAssembly modules (#1595)', () => {
  it('ships each module once, at the URL the page and its workers share', () => {
    const files = (fs.readdirSync(path.join(DIST_DIR, 'assets'), { recursive: true }) as string[]).map((file) => file.replace(/\\/g, '/'));
    const modules = files.filter((file) => file.endsWith('.wasm')).map((file) => path.basename(file).replace(/[.-][\w-]{8}\.wasm$/, ''));
    expect(modules.length).toBeGreaterThan(0);
    expect(new Set(modules).size).toBe(modules.length);
  });
});

describe('Built service worker', () => {
  it('precaches every icon the manifest declares', () => {
    const sw = readBuilt('sw.js');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/manifest.json'), 'utf8')) as { icons: Array<{ src: string }> };
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) expect(sw).toContain(icon.src);
  });
});

describe('Pre-rendered pages', () => {
  it.each(['index.html', 'about/index.html', 'arcade/index.html', 'wifi-qr-code/index.html'])('%s has a canonical link and a main landmark', (page) => {
    const html = readBuilt(page);
    expect(html.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/qrcraftly\.com[^"]*"/);
    expect(html).toContain('<main');
  });
});
