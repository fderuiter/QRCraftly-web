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

import fs from 'fs';
import path from 'path';
import type { Plugin, Rollup } from 'vite';

/**
 * Third-party packages that ship to the browser, and their licenses: the acknowledgements page
 * (`/acknowledgements`) lists them and `/third-party-licenses.txt` holds their full license texts.
 *
 * `shipped-packages.json` lists the package names. Everything else (version, license, license
 * text) is read from the installed packages when the site is built, so neither goes stale after
 * a dependency bump. Each client build then checks the list
 * against the modules that actually landed in the browser bundle (pages, web workers and CSS) and
 * fails if a shipped package is missing from the list, a listed one no longer ships, or the
 * installed copy the page describes is not the copy in the bundle.
 *
 * `pnpm run licenses:sync` rewrites the list from a fresh build.
 */

/** One third-party package that ships in the client bundle, with its license. */
export interface ShippedPackage {
  /** npm package name. */
  name: string;
  /** Installed version. */
  version: string;
  /** SPDX license expression from the package, or `Not stated`. */
  license: string;
  /** Source repository or homepage (https only). */
  url?: string;
  /** Full license text shipped with the package. */
  licenseText?: string;
  /** NOTICE file text, for licenses (such as Apache-2.0) that require it to be passed on. */
  noticeText?: string;
  /** Package whose build output carries this code, when it is not installed on its own. */
  bundledIn?: string;
  /** Reviewed explanation for anything unusual, such as a package that states no license. */
  note?: string;
}

/** What the acknowledgements page needs: everything but the license texts, which live in {@link LICENSES_FILE}. */
export type ShippedPackageSummary = Omit<ShippedPackage, 'licenseText' | 'noticeText'>;

/** Site path of the generated license texts. */
export const LICENSES_FILE = 'third-party-licenses.txt';

import { DOCS_MANIFEST_ID } from './docsManifest';

const VIRTUAL_ID = 'virtual:shipped-packages';
const RESOLVED_VIRTUAL_ID = `\0${VIRTUAL_ID}`;
const SYNC_ENV = 'QRCRAFTLY_SYNC_SHIPPED_PACKAGES';
const FIX_HINT = 'Fix: run `pnpm run licenses:sync`, review the change to scripts/vite/shipped-packages.json and commit it.';
const LIST_FILE = path.join(__dirname, 'shipped-packages.json');
const NODE_MODULES = '/node_modules/';

/** Vite build output that carries code from @rollup/plugin-commonjs (the CommonJS interop helpers). */
const COMMONJS_HELPERS = '@rollup/plugin-commonjs';

/** A person's review of a package that ships without a license field or license file. */
interface LicenseReview {
  /** What the reviewer found, shown on the page. */
  note: string;
  /** License text to show in place of the missing file, with its source named in `note`. */
  licenseText?: string;
}

/**
 * Packages that publish no license field or no license file. A build fails on any such package
 * that is not listed here, so each one is looked at by a person before it ships.
 */
const REVIEWED_LICENSES: Readonly<Record<string, LicenseReview>> = {
  '@brillout/picocolors': {
    note: 'The package declares the ISC license (author Alexey Raspopov) but ships no license file. It is a fork of picocolors; the text below is the license file of the picocolors project. QRCraftly ships only its browser build, a few lines that return text unchanged.',
    licenseText: `ISC License

Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  },
};

/**
 * Converts a path to forward slashes so module ids compare the same on every platform.
 * @param value - A file path or module id.
 * @returns The path with POSIX separators.
 */
const toPosix = (value: string): string => value.replace(/\\/g, '/');

/**
 * Works out which third-party package a bundled module belongs to.
 * @param moduleId - A Rollup module id (absolute path or virtual id, possibly with a query).
 * @returns The package name and, for installed packages, its directory; `null` for first-party
 *   code; or `{ unknown }` for a virtual module this file does not know how to attribute.
 */
export function packageOfModule(moduleId: string): { name: string; dir?: string } | { unknown: string } | null {
  const isVirtual = moduleId.startsWith('\0');
  const id = toPosix(isVirtual ? moduleId.slice(1) : moduleId).split('?')[0];
  const index = id.lastIndexOf(NODE_MODULES);
  if (index >= 0) {
    const segments = id.slice(index + NODE_MODULES.length).split('/');
    const name = segments[0].startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
    return { name, dir: id.slice(0, index + NODE_MODULES.length) + name };
  }
  // Vite's own runtime helpers, such as the module preload helper.
  if (id.startsWith('vite/')) return { name: 'vite' };
  if (id === 'commonjsHelpers.js') return { name: COMMONJS_HELPERS };
  // This file's own data module.
  if (id === VIRTUAL_ID) return null;
  // The /security page's docs, compiled from our own Markdown (scripts/vite/docsManifest.ts).
  if (id === DOCS_MANIFEST_ID) return null;
  // Entry glue Vike generates for each page.
  if (id.startsWith('virtual:vike:')) return { name: 'vike' };
  return isVirtual ? { unknown: moduleId.slice(1) } : null;
}

/**
 * Finds an installed package the way Node does: `node_modules/<name>` in `fromDir` or any parent.
 * @param name - Package name.
 * @param fromDir - Directory to start from.
 * @returns The package's real directory, or undefined.
 */
function findPackageDir(name: string, fromDir: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return toPosix(fs.realpathSync(candidate));
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolves every listed package from the project root, then from the packages already found,
 * so transitive dependencies (for example `scheduler` from `react-dom`) resolve to the copy
 * their parent uses.
 * @param names - Package names.
 * @param root - Project root.
 * @returns Package directories by name.
 */
export function resolvePackageDirs(names: readonly string[], root: string): Map<string, string> {
  const found = new Map<string, string>();
  const bases = [root];
  let progress = true;
  while (progress) {
    progress = false;
    for (const name of names) {
      if (found.has(name)) continue;
      for (const base of bases) {
        const dir = findPackageDir(name, base);
        if (dir) {
          found.set(name, dir);
          bases.push(dir);
          progress = true;
          break;
        }
      }
    }
  }
  return found;
}

/**
 * Turns a package.json `repository` or `homepage` value into an https URL.
 * @param pkg - Parsed package.json.
 * @returns An https URL, or undefined.
 */
export function repositoryUrl(pkg: { repository?: string | { url?: string; directory?: string }; homepage?: string }): string | undefined {
  const repo = typeof pkg.repository === 'string' ? { url: pkg.repository } : pkg.repository;
  let url = repo?.url?.trim();
  if (url) {
    url = url
      .replace(/^github:/, 'https://github.com/')
      .replace(/^git\+/, '')
      .replace(/^git:\/\//, 'https://')
      .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
      .replace(/\.git$/, '');
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`;
    if (repo?.directory && url.startsWith('https://github.com/')) url = `${url}/tree/HEAD/${repo.directory}`;
  }
  const candidate = url ?? pkg.homepage;
  return candidate?.startsWith('https://') ? candidate : undefined;
}

/**
 * Reads the first file in a package directory whose name matches a pattern.
 * @param dir - Package directory.
 * @param pattern - File name pattern.
 * @returns The file's text with LF line endings, trimmed, or undefined.
 */
function readMatchingFile(dir: string, pattern: RegExp): string | undefined {
  const file = fs.readdirSync(dir).sort().find((entry) => pattern.test(entry));
  return file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim() : undefined;
}

/**
 * Vite and Rollup append the licenses of the code they bundle into their own builds to their
 * license file. Only Vite's own runtime helpers ship to the browser, so the page shows the core
 * license and the section below is left out.
 * @param text - License file text.
 * @returns The text before any bundled-dependency section.
 */
const coreLicense = (text: string): string => text.split(/\n# Licenses of bundled dependencies/)[0].trim();

/**
 * Reads the @rollup/plugin-commonjs entry from Vite's license file, where Vite records the license
 * of the plugin it bundles.
 * @param viteDir - Vite's package directory.
 * @returns The entry, or undefined when Vite's license file has no such section.
 */
function commonjsHelpersEntry(viteDir: string): ShippedPackage | undefined {
  const vitePkg = JSON.parse(fs.readFileSync(path.join(viteDir, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
  const viteLicense = readMatchingFile(viteDir, /^licen[cs]e(\.md)?$/i) ?? '';
  const section = viteLicense.split(/\n(?=## )/).find((part) => part.startsWith('## ') && part.split(/\r?\n/)[0].includes(COMMONJS_HELPERS));
  if (!section) return undefined;
  const license = /^License: (.+)$/m.exec(section)?.[1];
  const quoted = section
    .split(/\r?\n/)
    .filter((line) => line.startsWith('>'))
    .map((line) => line.replace(/^> ?/, ''))
    .join('\n')
    .trim();
  return {
    name: COMMONJS_HELPERS,
    version: (vitePkg.devDependencies?.[COMMONJS_HELPERS] ?? '').replace(/^[\^~]/, ''),
    license: license ?? 'Not stated',
    url: 'https://github.com/rollup/plugins/tree/HEAD/packages/commonjs',
    licenseText: quoted || undefined,
    bundledIn: 'vite',
  };
}

/**
 * Builds the acknowledgements data for the listed packages from what is installed.
 * @param names - Package names from `shipped-packages.json`.
 * @param root - Project root.
 * @returns One entry per package, sorted by name.
 * @throws When a package cannot be found, or states no license and has not been reviewed.
 */
export function describePackages(names: readonly string[], root: string): ShippedPackage[] {
  const dirs = resolvePackageDirs([...names, 'vite'], root);
  const problems: string[] = [];
  const entries: ShippedPackage[] = [];
  for (const name of names) {
    if (name === COMMONJS_HELPERS) {
      const viteDir = dirs.get('vite');
      const entry = viteDir ? commonjsHelpersEntry(viteDir) : undefined;
      if (entry) entries.push(entry);
      else problems.push(`${name}: could not read its license from Vite's LICENSE.md.`);
      continue;
    }
    const dir = dirs.get(name);
    if (!dir) {
      problems.push(`${name}: not installed.`);
      continue;
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      version: string;
      license?: string | { type?: string };
      repository?: string | { url?: string; directory?: string };
      homepage?: string;
    };
    const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
    const licenseText = readMatchingFile(dir, /^(licen[cs]e|copying)(\.(md|txt))?$/i);
    const review = REVIEWED_LICENSES[name];
    if ((!license || !licenseText) && !review) {
      problems.push(`${name}: the package has no ${license ? 'license file' : 'license field'}. Check its license and record what you found in REVIEWED_LICENSES.`);
    }
    entries.push({
      name,
      version: pkg.version,
      license: license ?? 'Not stated',
      url: repositoryUrl(pkg),
      licenseText: licenseText ? coreLicense(licenseText) : review?.licenseText,
      noticeText: readMatchingFile(dir, /^notice(\.(md|txt))?$/i),
      note: review?.note,
    });
  }
  if (problems.length > 0) {
    throw new Error(`[shipped-packages] ${problems.join('\n')}`);
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Renders the full license texts as one plain-text file.
 * @param entries - Shipped packages with their license texts.
 * @returns The file contents.
 */
export function renderLicenseFile(entries: readonly ShippedPackage[]): string {
  const rule = '-'.repeat(72);
  const blocks = entries.map((entry) =>
    [
      rule,
      `${entry.name} ${entry.version}`,
      `License: ${entry.license}`,
      entry.url && `Source: ${entry.url}`,
      entry.bundledIn && `Included in the build output of ${entry.bundledIn}.`,
      entry.note,
      '',
      entry.licenseText,
      entry.noticeText && `\nNOTICE\n\n${entry.noticeText}`,
    ]
      .filter((line) => line !== undefined)
      .join('\n'),
  );
  return [
    'Third-party software in QRCraftly (https://qrcraftly.com)',
    '',
    'The QRCraftly site sends your browser code from the open-source packages below.',
    'Each entry gives the package, its version, its license and the license text it',
    'is distributed with. The list is generated when the site is built.',
    '',
    ...blocks,
    '',
  ].join('\n');
}

/**
 * Reads the committed list of shipped package names.
 * @returns Package names.
 */
const readList = (): string[] => JSON.parse(fs.readFileSync(LIST_FILE, 'utf8')) as string[];

/** Shipped packages seen so far in this build, by name, with every directory they came from. */
type Seen = Map<string, Set<string | undefined>>;

/**
 * Records the third-party packages in one Rollup output bundle.
 * @param bundle - The output bundle.
 * @param seen - Collector to add to.
 * @param unknown - Collector for virtual modules that could not be attributed.
 */
function collect(bundle: Rollup.OutputBundle, seen: Seen, unknown: Set<string>): void {
  const add = (name: string, dir?: string) => {
    const dirs = seen.get(name) ?? new Set<string | undefined>();
    dirs.add(dir);
    seen.set(name, dirs);
  };
  for (const output of Object.values(bundle)) {
    if (output.type === 'chunk') {
      for (const [id, info] of Object.entries(output.modules)) {
        if (info.renderedLength === 0) continue;
        const owner = packageOfModule(id);
        if (!owner) continue;
        if ('unknown' in owner) unknown.add(owner.unknown);
        else add(owner.name, owner.dir);
      }
    } else if (output.fileName.endsWith('.css')) {
      // Tailwind compiles its base styles into the site's CSS and marks them with a banner.
      const css = typeof output.source === 'string' ? output.source : new TextDecoder().decode(output.source);
      if (/\/\*! tailwindcss v/.test(css)) add('tailwindcss');
    }
  }
}

/**
 * Compares the packages in the client bundle with the committed list and the installed copies.
 * @param seen - Packages found in the bundle.
 * @param unknown - Virtual modules that could not be attributed.
 * @param root - Project root.
 * @returns Problems found; empty when the list is current.
 */
export function checkShipped(seen: Seen, unknown: ReadonlySet<string>, root: string): string[] {
  const listed = readList();
  const shipped = [...seen.keys()].sort();
  const problems = [...unknown].map((id) => `The bundle contains a virtual module this check cannot attribute to a package: ${id}. Teach packageOfModule() in scripts/vite/thirdPartyLicenses.ts about it.`);
  for (const name of shipped) {
    if (!listed.includes(name)) problems.push(`${name} ships to the browser but is not in shipped-packages.json.`);
  }
  for (const name of listed) {
    if (!seen.has(name)) problems.push(`${name} is in shipped-packages.json but no longer ships to the browser.`);
  }
  const resolved = resolvePackageDirs(listed, root);
  for (const [name, dirs] of seen) {
    const bundledDirs = [...dirs].filter((dir): dir is string => dir !== undefined).map((dir) => toPosix(fs.realpathSync(dir)));
    if (new Set(bundledDirs).size > 1) {
      problems.push(`${name} ships in more than one copy (${bundledDirs.join(', ')}); deduplicate it so the page names the right version.`);
    } else if (bundledDirs.length === 1 && resolved.get(name) !== bundledDirs[0]) {
      problems.push(`${name}: the bundle uses ${bundledDirs[0]} but the acknowledgements page would describe ${resolved.get(name) ?? 'nothing'}.`);
    }
  }
  return problems;
}

/**
 * Vite plugins for the acknowledgements page: the `virtual:shipped-packages` module, the
 * `third-party-licenses.txt` file and the build check that keeps `shipped-packages.json` equal
 * to what ships.
 * @returns The plugin for the main build and a factory for web worker builds.
 */
export function shippedPackages(): { plugin: Plugin; workerPlugin: () => Plugin } {
  const seen: Seen = new Map();
  const unknown = new Set<string>();
  let root = process.cwd();

  const workerPlugin = (): Plugin => ({
    name: 'qrcraftly:shipped-packages-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      collect(bundle, seen, unknown);
    },
  });

  const plugin: Plugin = {
    name: 'qrcraftly:shipped-packages',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return undefined;
      this.addWatchFile(LIST_FILE);
      const summaries: ShippedPackageSummary[] = describePackages(readList(), root).map(({ licenseText: _text, noticeText: _notice, ...summary }) => summary);
      return `export const licensesFile = ${JSON.stringify(`/${LICENSES_FILE}`)};\nexport default ${JSON.stringify(summaries)};`;
    },
    configureServer(server) {
      // `pnpm dev` serves the license texts the build would emit.
      server.middlewares.use(`/${LICENSES_FILE}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(renderLicenseFile(describePackages(readList(), root)));
      });
    },
    generateBundle(_options, bundle) {
      // Server-side code renders pages at build time and never reaches the browser.
      if (this.environment.config.consumer !== 'client') return;
      // Worker bundles are built while the client bundle is transformed, so they are already in `seen`.
      collect(bundle, seen, unknown);
      if (process.env[SYNC_ENV] === '1' && unknown.size === 0) {
        fs.writeFileSync(LIST_FILE, `${JSON.stringify([...seen.keys()].sort(), null, 2)}\n`);
        this.info(`Wrote ${seen.size} shipped packages to ${toPosix(path.relative(root, LIST_FILE))}.`);
      } else {
        const problems = checkShipped(seen, unknown, root);
        if (problems.length > 0) {
          this.error(`[shipped-packages] The acknowledgements page is out of date:\n- ${problems.join('\n- ')}\n${FIX_HINT}`);
        }
      }
      this.emitFile({ type: 'asset', fileName: LICENSES_FILE, source: renderLicenseFile(describePackages(readList(), root)) });
    },
  };

  return { plugin, workerPlugin };
}
