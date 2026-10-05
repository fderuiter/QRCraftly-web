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

import { describe, expect, it } from 'vitest';
import { checkShipped, describePackages, packageOfModule, renderLicenseFile, repositoryUrl } from '../scripts/vite/thirdPartyLicenses';
import list from '../scripts/vite/shipped-packages.json';

const root = process.cwd();

describe('packageOfModule', () => {
  it('names the package of an installed module, scoped or not, on any platform', () => {
    expect(packageOfModule('/repo/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode/lib/core/mode.js?commonjs-exports')).toEqual({
      name: 'qrcode',
      dir: '/repo/node_modules/.pnpm/qrcode@1.5.4/node_modules/qrcode',
    });
    expect(packageOfModule('\\repo\\node_modules\\@brillout\\json-serializer\\dist\\parse.js')).toEqual({
      name: '@brillout/json-serializer',
      dir: '/repo/node_modules/@brillout/json-serializer',
    });
  });

  it('attributes build-generated modules and leaves first-party code alone', () => {
    expect(packageOfModule('\0vite/preload-helper.js')).toEqual({ name: 'vite' });
    expect(packageOfModule('\0commonjsHelpers.js')).toEqual({ name: '@rollup/plugin-commonjs' });
    expect(packageOfModule('\0virtual:vike:page-entry:client:/src/pages/about')).toEqual({ name: 'vike' });
    expect(packageOfModule('/repo/src/pages/about/+Page.tsx')).toBeNull();
    expect(packageOfModule('\0virtual:shipped-packages')).toBeNull();
    expect(packageOfModule('\0some-new-virtual')).toEqual({ unknown: 'some-new-virtual' });
  });
});

describe('repositoryUrl', () => {
  it('turns package.json repository forms into https links', () => {
    expect(repositoryUrl({ repository: { url: 'git://github.com/soldair/node-qrcode.git' } })).toBe('https://github.com/soldair/node-qrcode');
    expect(repositoryUrl({ repository: { url: 'git+https://github.com/vitejs/vite.git', directory: 'packages/vite' } })).toBe(
      'https://github.com/vitejs/vite/tree/HEAD/packages/vite',
    );
    expect(repositoryUrl({ repository: 'cozmo/jsQR' })).toBe('https://github.com/cozmo/jsQR');
    expect(repositoryUrl({ repository: 'http://example.com/repo' })).toBeUndefined();
  });
});

describe('describePackages', () => {
  it('describes every listed package with a version, a license and license text', () => {
    const entries = describePackages(list, root);
    expect(entries.map((entry) => entry.name)).toEqual([...list].sort((a, b) => a.localeCompare(b)));
    for (const entry of entries) {
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(entry.license).not.toBe('Not stated');
      expect(entry.licenseText).toBeTruthy();
    }
  });

  it('shows only the core license of a package that appends its bundled dependencies', () => {
    const vite = describePackages(['vite'], root)[0];
    expect(vite.licenseText).toContain('MIT License');
    expect(vite.licenseText).not.toContain('Licenses of bundled dependencies');
  });

  it('refuses a package that is not installed', () => {
    expect(() => describePackages(['not-a-real-package-qrcraftly'], root)).toThrow(/not installed/);
  });
});

describe('renderLicenseFile', () => {
  it('writes every package with its version, license, source and full license text', () => {
    const entries = describePackages(list, root);
    const text = renderLicenseFile(entries);
    for (const entry of entries) {
      expect(text).toContain(`${entry.name} ${entry.version}\nLicense: ${entry.license}`);
      expect(text).toContain(entry.licenseText);
    }
    expect(text).toContain('Included in the build output of vite.');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('checkShipped', () => {
  it('reports packages that ship unlisted, listed packages that no longer ship, and unknown virtual modules', () => {
    const seen = new Map<string, Set<string | undefined>>(list.filter((name) => name !== 'lucide-react').map((name) => [name, new Set([undefined])]));
    seen.set('left-pad', new Set([undefined]));
    const problems = checkShipped(seen, new Set(['mystery']), root);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('mystery'),
        'left-pad ships to the browser but is not in shipped-packages.json.',
        'lucide-react is in shipped-packages.json but no longer ships to the browser.',
      ]),
    );
  });

  it('passes when the bundle matches the list', () => {
    const seen = new Map<string, Set<string | undefined>>(list.map((name) => [name, new Set([undefined])]));
    expect(checkShipped(seen, new Set(), root)).toEqual([]);
  });
});
