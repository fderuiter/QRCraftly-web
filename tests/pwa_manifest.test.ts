/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GRID, faviconSvg, markRects } from '../scripts/generate_icons';

/**
 * Reads PNG dimensions directly from PNG IHDR chunk header bytes.
 */
function getPngDimensions(filePath: string): { width: number; height: number } {
  const buffer = fs.readFileSync(filePath);
  // Check PNG magic header: \x89PNG\r\n\x1a\n
  if (
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47 ||
    buffer[4] !== 0x0d ||
    buffer[5] !== 0x0a ||
    buffer[6] !== 0x1a ||
    buffer[7] !== 0x0a
  ) {
    throw new Error(`File ${filePath} is not a valid PNG file.`);
  }

  // Width is 4 bytes at offset 16 (big-endian), Height is 4 bytes at offset 20 (big-endian)
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

describe('PWA Manifest & Static Brand Icon Compliance Suite', () => {
  const publicDir = path.join(__dirname, '../public');
  const manifestPath = path.join(publicDir, 'manifest.json');

  it('Requirement 2 & AC2: Manifest contains all core PWA metadata fields', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(manifestContent).toHaveProperty('name', 'QRCraftly');
    expect(manifestContent).toHaveProperty('short_name', 'QRCraftly');
    expect(manifestContent).toHaveProperty('start_url', '/');
    expect(manifestContent).toHaveProperty('display', 'standalone');
    expect(manifestContent).toHaveProperty('background_color', '#f8fafc');
    expect(manifestContent).toHaveProperty('theme_color', '#0f766e');
    expect(manifestContent).toHaveProperty('icons');
    expect(Array.isArray(manifestContent.icons)).toBe(true);
    expect(manifestContent.icons.length).toBeGreaterThan(0);
  });

  it('Requirement 2 & AC3: Theme color metadata matches #0f766e brand color across manifest and Head layout', () => {
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifestContent.theme_color).toBe('#0f766e');

    const headPath = path.join(__dirname, '../src/layouts/Head.tsx');
    const headContent = fs.readFileSync(headPath, 'utf8');
    expect(headContent).toContain('<meta name="theme-color" content="#0f766e" />');
  });

  it('gives the browser chrome a dark theme-color and both colour schemes before scripts run (#1667)', () => {
    const headContent = fs.readFileSync(path.join(__dirname, '../src/layouts/Head.tsx'), 'utf8');
    const dark = headContent.indexOf('<meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)" />');
    const light = headContent.indexOf('<meta name="theme-color" content="#0f766e" />');
    expect(dark).toBeGreaterThan(-1);
    // Browsers use the first theme-color whose media matches, so the unconditional one goes last.
    expect(light).toBeGreaterThan(dark);
    expect(headContent).toContain('<meta name="color-scheme" content="light dark" />');
  });

  it('identifies the app and its scope, and offers a shortcut to each main task (#1667)', () => {
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    expect(manifestContent.id).toBe('/');
    expect(manifestContent.scope).toBe('/');

    const shortcuts: Array<{ name: string; short_name: string; url: string; icons: Array<{ src: string }> }> =
      manifestContent.shortcuts;
    expect(shortcuts.map((shortcut) => shortcut.url)).toEqual(['/', '/file-transfer', '/file-transfer/receive', '/qr-code-scanner']);
    for (const shortcut of shortcuts) {
      expect(shortcut.name.trim()).not.toBe('');
      expect(shortcut.short_name.trim()).not.toBe('');
      const page = shortcut.url === '/' ? 'index' : shortcut.url.slice(1);
      expect(fs.existsSync(path.join(__dirname, '../src/pages', page, '+Page.tsx'))).toBe(true);
      for (const icon of shortcut.icons) expect(fs.existsSync(path.join(publicDir, icon.src.slice(1)))).toBe(true);
    }
  });

  it('lists a narrow and a wide screenshot whose files match their declared sizes (#1667)', () => {
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const screenshots: Array<{ src: string; sizes: string; type: string; form_factor: string; label: string }> =
      manifestContent.screenshots;
    expect(screenshots.map((shot) => shot.form_factor).sort()).toEqual(['narrow', 'wide']);
    for (const shot of screenshots) {
      expect(shot.type).toBe('image/png');
      expect(shot.label.trim()).not.toBe('');
      const { width, height } = getPngDimensions(path.join(publicDir, shot.src.slice(1)));
      expect(`${width}x${height}`).toBe(shot.sizes);
      // Chrome shows a wide screenshot only when it is landscape, and a narrow one only when it is portrait.
      expect(shot.form_factor === 'wide' ? width > height : height > width).toBe(true);
    }
  });

  it.each([
    ['favicon-32x32.png', 32],
    ['apple-touch-icon.png', 180],
    ['favicon.png', 192],
  ])('ships %s at %i px and links it from the head (#1667)', (file, size) => {
    expect(getPngDimensions(path.join(publicDir, file))).toEqual({ width: size, height: size });
    if (file === 'favicon.png') return; // Kept for old links; the head now points at the SVG and 32 px icons.
    const headContent = fs.readFileSync(path.join(__dirname, '../src/layouts/Head.tsx'), 'utf8');
    expect(headContent).toContain(`href="/${file}"`);
  });

  it('ships an SVG favicon with its own dark variant, written by the icon script (#1667)', () => {
    const svg = fs.readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8');
    expect(svg).toBe(faviconSvg());
    expect(svg).toContain('@media (prefers-color-scheme: dark)');
    const headContent = fs.readFileSync(path.join(__dirname, '../src/layouts/Head.tsx'), 'utf8');
    expect(headContent).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  });

  describe('icon mark geometry (#1667)', () => {
    const dark = new Set(markRects().flatMap(({ x, y, w, h }) =>
      Array.from({ length: w * h }, (_, i) => `${x + (i % w)},${y + Math.floor(i / w)}`)
    ));
    const isDark = (x: number, y: number): boolean => dark.has(`${x},${y}`);

    it.each([
      ['top-left', 0, 0],
      ['top-right', GRID - 7, 0],
      ['bottom-left', 0, GRID - 7],
    ])('draws the %s finder as a ring around a light gap and a centre dot', (_name, left, top) => {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          const ring = x === 0 || y === 0 || x === 6 || y === 6;
          const centre = x >= 2 && x <= 4 && y >= 2 && y <= 4;
          expect(isDark(left + x, top + y)).toBe(ring || centre);
        }
      }
    });
  });

  it('Requirement 1 & AC1: Declared manifest icons exist and physical pixel dimensions match 192x192 and 512x512 declarations', () => {
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const icons = manifestContent.icons;

    for (const icon of icons) {
      expect(icon).toHaveProperty('src');
      expect(icon).toHaveProperty('sizes');
      expect(icon).toHaveProperty('type', 'image/png');

      const relativeSrc = icon.src.startsWith('/') ? icon.src.slice(1) : icon.src;
      const iconFilePath = path.join(publicDir, relativeSrc);
      expect(fs.existsSync(iconFilePath)).toBe(true);

      const [declaredWidthStr, declaredHeightStr] = icon.sizes.split('x');
      const declaredWidth = parseInt(declaredWidthStr, 10);
      const declaredHeight = parseInt(declaredHeightStr, 10);

      const { width, height } = getPngDimensions(iconFilePath);
      expect(width).toBe(declaredWidth);
      expect(height).toBe(declaredHeight);
    }
  });

  it('Requirement 3: Manifest includes maskable icon definitions aligned with primary brand colors', () => {
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const icons = manifestContent.icons;

    const maskableIcons = icons.filter((i: any) => i.purpose && i.purpose.includes('maskable'));
    expect(maskableIcons.length).toBeGreaterThanOrEqual(2);

    const maskableSizes = maskableIcons.map((i: any) => i.sizes);
    expect(maskableSizes).toContain('192x192');
    expect(maskableSizes).toContain('512x512');
  });

  // Requirement 4 & AC5, that the built service worker precaches every icon, reads dist/client and
  // runs after the build: tests/build-output/built_output.test.ts (#1609).
});
