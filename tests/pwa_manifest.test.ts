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
