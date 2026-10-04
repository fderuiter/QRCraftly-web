/**
 * Lint guard for the Rust workspace (#1182, ADR 0033). Runs without Rust installed.
 *
 * 1. No third-party crates: every package in crates/Cargo.lock must be a
 *    workspace member, and every dependency in a crate manifest must be a
 *    `path` dependency inside crates/.
 * 2. Every committed src/wasm/<module>.wasm matches its .wasm.sha256 sidecar,
 *    so a hand-edited binary fails before CI rebuilds it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRATES_DIR, WASM_DIR, hashLine, readCrates } from './utils/rustWorkspace.js';

/**
 * Package names in a Cargo.lock, with whether each came from a registry or git.
 * @param {string} lock
 * @returns {{ name: string, external: boolean }[]}
 */
export function parseLockPackages(lock) {
  return lock
    .split(/^\[\[package\]\]\s*$/m)
    .slice(1)
    .map(block => {
      const name = block.match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1] ?? '';
      return { name, external: /^\s*source\s*=/m.test(block) };
    });
}

/**
 * Dependencies in a crate manifest that are not local `path` dependencies.
 * @param {string} manifest
 * @returns {string[]}
 */
export function externalDependencies(manifest) {
  const external = [];
  let inDeps = false;
  for (const line of manifest.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      const section = header[1].trim();
      inDeps = /(^|\.)((dev-|build-)?dependencies)$/.test(section);
      // [dependencies.foo] style tables name the crate in the header.
      const table = section.match(/(?:^|\.)(?:dev-|build-)?dependencies\.([^.]+)$/);
      if (table) external.push(`${table[1]} (use an inline { path = "..." } dependency)`);
      continue;
    }
    if (!inDeps) continue;
    const dep = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (dep && !/\bpath\s*=/.test(dep[2])) external.push(dep[1]);
  }
  return external;
}

/**
 * Committed modules whose bytes do not match their sidecar hash.
 * @param {string} [wasmDir]
 * @returns {string[]}
 */
export function mismatchedHashes(wasmDir = WASM_DIR) {
  if (!fs.existsSync(wasmDir)) return [];
  const problems = [];
  for (const file of fs.readdirSync(wasmDir).filter(f => f.endsWith('.wasm'))) {
    const name = file.slice(0, -'.wasm'.length);
    const hashPath = path.join(wasmDir, `${file}.sha256`);
    const expected = hashLine(name, fs.readFileSync(path.join(wasmDir, file)));
    if (!fs.existsSync(hashPath)) {
      problems.push(`src/wasm/${file} has no .sha256 sidecar.`);
    } else if (fs.readFileSync(hashPath, 'utf8') !== expected) {
      problems.push(`src/wasm/${file} does not match src/wasm/${file}.sha256.`);
    }
  }
  return problems;
}

/**
 * Every problem in the workspace and the committed modules.
 * @param {{ cratesDir?: string, wasmDir?: string }} [options]
 * @returns {string[]}
 */
export function checkRustWorkspace({ cratesDir = CRATES_DIR, wasmDir = WASM_DIR } = {}) {
  if (!fs.existsSync(path.join(cratesDir, 'Cargo.toml'))) return [];
  const problems = [];
  const crates = readCrates(cratesDir);
  const members = new Set(crates.map(crate => crate.name));

  for (const crate of crates) {
    for (const dep of externalDependencies(crate.manifest)) {
      problems.push(`${crate.name} depends on ${dep}; only crates in crates/ are allowed.`);
    }
  }

  const lockPath = path.join(cratesDir, 'Cargo.lock');
  if (!fs.existsSync(lockPath)) {
    problems.push('crates/Cargo.lock is missing; run `pnpm run wasm:build` and commit it.');
  } else {
    for (const pkg of parseLockPackages(fs.readFileSync(lockPath, 'utf8'))) {
      if (pkg.external || !members.has(pkg.name)) {
        problems.push(`crates/Cargo.lock contains ${pkg.name}, which is not a workspace crate.`);
      }
    }
  }

  return [...problems, ...mismatchedHashes(wasmDir)];
}

function main() {
  const problems = checkRustWorkspace();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✖ ${problem}`);
    console.error('Fix: QRCraftly uses no third-party Rust crates (docs/RUST.md). Remove the dependency, or run `pnpm run wasm:build` to refresh src/wasm/.');
    process.exit(1);
  }
  console.log('✅ Rust workspace has no third-party crates and every committed module matches its hash.');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main();
}
