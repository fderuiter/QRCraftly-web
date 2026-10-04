/**
 * Reads the Rust workspace in crates/ (#1182) without needing Rust installed.
 * Shared by scripts/build_wasm.js and scripts/rust_no_deps_check.js.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, '../..');
export const CRATES_DIR = path.join(REPO_ROOT, 'crates');
export const WASM_DIR = path.join(REPO_ROOT, 'src', 'wasm');
export const WASM_TARGET = 'wasm32-unknown-unknown';

/**
 * The `members = [...]` list of a workspace manifest.
 * @param {string} manifest
 * @returns {string[]}
 */
export function parseMembers(manifest) {
  const match = manifest.match(/^\s*members\s*=\s*\[([^\]]*)\]/m);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

/**
 * The value of a `key = "value"` line inside one `[section]` of a manifest.
 * @param {string} manifest
 * @param {string} section
 * @param {string} key
 * @returns {string | null}
 */
function sectionValue(manifest, section, key) {
  const lines = manifest.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      inSection = header[1].trim() === section;
      continue;
    }
    if (!inSection) continue;
    const value = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`));
    if (value) return value[1];
  }
  return null;
}

/**
 * Every crate in the workspace.
 * @param {string} [cratesDir]
 * @returns {{ name: string, dir: string, manifest: string, isModule: boolean }[]}
 */
export function readCrates(cratesDir = CRATES_DIR) {
  const workspace = fs.readFileSync(path.join(cratesDir, 'Cargo.toml'), 'utf8');
  return parseMembers(workspace).map(member => {
    const dir = path.join(cratesDir, member);
    const manifest = fs.readFileSync(path.join(dir, 'Cargo.toml'), 'utf8');
    const rawName = sectionValue(manifest, 'package', 'name');
    const name = rawName ? rawName.replace(/^"|"$/g, '') : member;
    const crateType = sectionValue(manifest, 'lib', 'crate-type') ?? '';
    return { name, dir, manifest, isModule: crateType.includes('"cdylib"') };
  });
}

/**
 * SHA-256 of a buffer as lowercase hex.
 * @param {Buffer | Uint8Array} bytes
 * @returns {string}
 */
export function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * The sidecar line written next to each committed module, in `sha256sum` format.
 * @param {string} moduleName
 * @param {Buffer | Uint8Array} bytes
 * @returns {string}
 */
export function hashLine(moduleName, bytes) {
  return `${sha256(bytes)}  ${moduleName}.wasm\n`;
}

/**
 * Every committed module in `src/wasm/`, by name.
 * @param {string} [wasmDir]
 * @returns {string[]}
 */
export function committedModuleNames(wasmDir = WASM_DIR) {
  if (!fs.existsSync(wasmDir)) return [];
  return fs
    .readdirSync(wasmDir)
    .filter(file => file.endsWith('.wasm'))
    .map(file => file.slice(0, -'.wasm'.length))
    .sort();
}

/**
 * The build-time Foundry canary switch of a module: `selftest` is `FOUNDRY_SELFTEST` in the
 * environment and `__FOUNDRY_SELFTEST__` in code.
 * @param {string} moduleName
 * @returns {string}
 */
export function foundrySwitchName(moduleName) {
  return `FOUNDRY_${moduleName.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

/**
 * Vite `define` entries for the Foundry canary switches (ADR 0033): one `__FOUNDRY_<MODULE>__`
 * constant per committed module, `"wasm"` when the build sets `FOUNDRY_<MODULE>=wasm` and `"js"`
 * otherwise. Code picks an implementation with it, so the bundler drops the other one. A switch
 * with any other value, or one naming no module, fails the build.
 * @param {Record<string, string | undefined>} [env]
 * @param {string[]} [modules]
 * @returns {Record<string, string>}
 */
export function foundryDefines(env = process.env, modules = committedModuleNames()) {
  const switches = new Map(modules.map(name => [foundrySwitchName(name), name]));
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('FOUNDRY_') || value === undefined) continue;
    if (!switches.has(key)) {
      throw new Error(`${key} names no module in src/wasm/. Known switches: ${[...switches.keys()].join(', ') || 'none'}.`);
    }
    if (value !== 'wasm' && value !== 'js') {
      throw new Error(`${key} must be "wasm" or "js", not "${value}".`);
    }
  }
  return Object.fromEntries(
    [...switches.keys()].map(key => [`__${key}__`, JSON.stringify(env[key] === 'wasm' ? 'wasm' : 'js')])
  );
}
