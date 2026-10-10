/**
 * Resolve hook that lets plain Node run our TypeScript scripts (ADR 0045).
 *
 * Node strips types itself, but its ESM resolver needs the file extension, and most of `src/` imports
 * without one (`'../utils/metadataEngine'`), as Vite and TypeScript's `bundler` resolution allow. For a
 * relative specifier that does not name an existing file, this hook tries `.ts`, `.tsx`, `.js`,
 * `/index.ts` and `/index.js`, in that order. It also maps the `@/` alias from `tsconfig.json` to
 * `src/`. Bare package specifiers, `node:` builtins and absolute URLs go straight to Node.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CANDIDATE_SUFFIXES = ['.ts', '.tsx', '.js', `${path.sep}index.ts`, `${path.sep}index.js`];
const SRC_ALIAS = '@/';
const SRC_DIR = fileURLToPath(new URL('../../src/', import.meta.url));

/**
 * @param {string} file Absolute path.
 * @returns {boolean} Whether a regular file exists there.
 */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} specifier The import specifier.
 * @param {string | undefined} parentURL URL of the importing module.
 * @returns {string | null} The absolute path the specifier points at, or null when it is not ours to resolve.
 */
function targetPath(specifier, parentURL) {
  if (specifier.startsWith(SRC_ALIAS)) return path.join(SRC_DIR, specifier.slice(SRC_ALIAS.length));
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  if (!relative || !parentURL?.startsWith('file:')) return null;
  return path.resolve(path.dirname(fileURLToPath(parentURL)), specifier);
}

/**
 * Node `resolve` hook for `module.registerHooks`.
 *
 * @param {string} specifier The import specifier.
 * @param {{ parentURL?: string }} context Resolve context.
 * @param {(specifier: string, context: object) => { url: string }} nextResolve The next hook in the chain.
 * @returns {{ url: string, shortCircuit?: boolean }} The resolved module.
 */
export function resolve(specifier, context, nextResolve) {
  const base = targetPath(specifier, context.parentURL);
  if (base === null) return nextResolve(specifier, context);
  const file = isFile(base) ? base : CANDIDATE_SUFFIXES.map((suffix) => base + suffix).find(isFile);
  if (file === undefined) return nextResolve(specifier, context);
  return { url: pathToFileURL(file).href, shortCircuit: true };
}
