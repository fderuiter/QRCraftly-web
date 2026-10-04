/**
 * Builds every Rust WebAssembly module in crates/ and writes the committed
 * copies to src/wasm/ (#1182, ADR 0033).
 *
 *   pnpm run wasm:build   build, then write src/wasm/<module>.wasm and .wasm.sha256
 *   pnpm run wasm:check   build, then fail if any committed file differs (CI job wasm-reproducible)
 *
 * The toolchain comes from crates/rust-toolchain.toml. Build paths are remapped,
 * so the bytes do not depend on where the repository is checked out.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execBinary } from './utils/execHelper.js';
import { CRATES_DIR, REPO_ROOT, WASM_DIR, WASM_TARGET, hashLine, readCrates, sha256 } from './utils/rustWorkspace.js';

/**
 * Rust flags for a build that is the same on every machine. Passed through
 * CARGO_ENCODED_RUSTFLAGS (0x1f separated) so paths with spaces survive.
 * @param {string} [repoRoot]
 * @param {string} [cargoHome]
 * @returns {string}
 */
export function reproducibleRustFlags(repoRoot = REPO_ROOT, cargoHome = process.env.CARGO_HOME ?? '') {
  const flags = [`--remap-path-prefix=${repoRoot}=/qrcraftly`];
  if (cargoHome) flags.push(`--remap-path-prefix=${cargoHome}=/cargo`);
  return flags.join('\x1f');
}

/**
 * Builds every module and returns its bytes by module name.
 * @returns {Map<string, Buffer>}
 */
function buildModules() {
  const modules = readCrates().filter(crate => crate.isModule);
  const env = { ...process.env, CARGO_ENCODED_RUSTFLAGS: reproducibleRustFlags() };
  delete env.RUSTFLAGS;
  const args = ['build', '--release', '--locked', '--target', WASM_TARGET];
  for (const mod of modules) args.push('-p', mod.name);
  execBinary('cargo', args, { cwd: CRATES_DIR, env, stdio: 'inherit' });

  const outDir = path.join(CRATES_DIR, 'target', WASM_TARGET, 'release');
  const built = new Map();
  for (const mod of modules) {
    const file = path.join(outDir, `${mod.name.replace(/-/g, '_')}.wasm`);
    built.set(mod.name, fs.readFileSync(file));
  }
  return built;
}

/**
 * Compares freshly built modules with the committed files.
 * @param {Map<string, Buffer>} built
 * @param {string} [wasmDir]
 * @returns {string[]} one message per problem
 */
export function compareWithCommitted(built, wasmDir = WASM_DIR) {
  const problems = [];
  for (const [name, bytes] of built) {
    const wasmPath = path.join(wasmDir, `${name}.wasm`);
    const hashPath = `${wasmPath}.sha256`;
    if (!fs.existsSync(wasmPath)) {
      problems.push(`src/wasm/${name}.wasm is missing.`);
      continue;
    }
    const committed = fs.readFileSync(wasmPath);
    if (!committed.equals(bytes)) {
      problems.push(
        `src/wasm/${name}.wasm differs from a fresh build (committed ${sha256(committed).slice(0, 12)}, built ${sha256(bytes).slice(0, 12)}).`
      );
    }
    if (!fs.existsSync(hashPath) || fs.readFileSync(hashPath, 'utf8') !== hashLine(name, bytes)) {
      problems.push(`src/wasm/${name}.wasm.sha256 does not match a fresh build.`);
    }
  }
  if (fs.existsSync(wasmDir)) {
    for (const file of fs.readdirSync(wasmDir)) {
      const name = file.replace(/\.wasm(\.sha256)?$/, '');
      if (file.endsWith('.wasm') || file.endsWith('.wasm.sha256')) {
        if (!built.has(name)) problems.push(`src/wasm/${file} has no crate in crates/.`);
      }
    }
  }
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const built = buildModules();

  if (check) {
    const problems = compareWithCommitted(built);
    if (problems.length > 0) {
      for (const problem of problems) console.error(`✖ ${problem}`);
      console.error('Fix: pnpm run wasm:build, then commit src/wasm/.');
      process.exit(1);
    }
    console.log(`✅ ${built.size} WebAssembly module(s) rebuild byte-for-byte.`);
    return;
  }

  fs.mkdirSync(WASM_DIR, { recursive: true });
  for (const [name, bytes] of built) {
    fs.writeFileSync(path.join(WASM_DIR, `${name}.wasm`), bytes);
    fs.writeFileSync(path.join(WASM_DIR, `${name}.wasm.sha256`), hashLine(name, bytes), 'utf8');
    console.log(`Wrote src/wasm/${name}.wasm (${bytes.length} bytes, sha256 ${sha256(bytes).slice(0, 12)})`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  main();
}
