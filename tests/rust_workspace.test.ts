import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  checkRustWorkspace,
  externalDependencies,
  mismatchedHashes,
  parseLockPackages,
} from '../scripts/rust_no_deps_check.js';
import { compareWithCommitted, reproducibleRustFlags } from '../scripts/build_wasm.js';
import { hashLine, parseMembers, readCrates } from '../scripts/utils/rustWorkspace.js';

const temps: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-workspace-'));
  temps.push(dir);
  return dir;
}

function write(root: string, file: string, content: string | Buffer): void {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

/** A workspace like crates/: a shared library and one module that uses it. */
function makeWorkspace(extraModuleDeps = ''): { cratesDir: string; wasmDir: string } {
  const root = tempDir();
  write(root, 'crates/Cargo.toml', '[workspace]\nresolver = "2"\nmembers = ["core", "mod-a"]\n');
  write(root, 'crates/core/Cargo.toml', '[package]\nname = "qrcraftly-core"\n\n[lib]\nname = "qrcraftly_core"\n');
  write(
    root,
    'crates/mod-a/Cargo.toml',
    `[package]\nname = "mod-a"\n\n[lib]\ncrate-type = ["cdylib", "rlib"]\n\n[dependencies]\nqrcraftly-core = { path = "../core" }\n${extraModuleDeps}`,
  );
  write(
    root,
    'crates/Cargo.lock',
    '# generated\nversion = 4\n\n[[package]]\nname = "mod-a"\nversion = "0.0.0"\ndependencies = [\n "qrcraftly-core",\n]\n\n[[package]]\nname = "qrcraftly-core"\nversion = "0.0.0"\n',
  );
  return { cratesDir: path.join(root, 'crates'), wasmDir: path.join(root, 'src/wasm') };
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('reading the workspace', () => {
  it('lists members and marks cdylib crates as modules', () => {
    const { cratesDir } = makeWorkspace();
    expect(parseMembers('[workspace]\nmembers = ["a", "b/c"]\n')).toEqual(['a', 'b/c']);
    const crates = readCrates(cratesDir).map(({ name, isModule }) => ({ name, isModule }));
    expect(crates).toEqual([
      { name: 'qrcraftly-core', isModule: false },
      { name: 'mod-a', isModule: true },
    ]);
  });

  it('matches the real workspace in crates/', () => {
    const modules = readCrates().filter(crate => crate.isModule).map(crate => crate.name);
    expect(modules).toContain('selftest');
    expect(checkRustWorkspace()).toEqual([]);
  });
});

describe('scripts/rust_no_deps_check.js', () => {
  it('accepts a workspace whose only dependencies are path crates', () => {
    expect(checkRustWorkspace(makeWorkspace())).toEqual([]);
  });

  it('rejects a registry dependency in a manifest', () => {
    const problems = checkRustWorkspace(makeWorkspace('serde = "1"\n'));
    expect(problems.join('\n')).toContain('mod-a depends on serde');
  });

  it('rejects git, table-style and dev dependencies too', () => {
    expect(externalDependencies('[dependencies]\nfoo = { git = "https://example.com/foo" }\n')).toEqual(['foo']);
    expect(externalDependencies('[dev-dependencies]\nproptest = "1"\n')).toEqual(['proptest']);
    expect(externalDependencies('[dependencies.bar]\nversion = "1"\n')).toEqual([
      'bar (use an inline { path = "..." } dependency)',
    ]);
    expect(externalDependencies('[target.wasm32-unknown-unknown.dependencies]\nbaz = "1"\n')).toEqual(['baz']);
    expect(externalDependencies('[package]\nname = "x"\n[dependencies]\ncore2 = { path = "../core" }\n')).toEqual([]);
  });

  it('rejects a lockfile that pulls in a crate from a registry', () => {
    const ws = makeWorkspace();
    fs.appendFileSync(
      path.join(ws.cratesDir, 'Cargo.lock'),
      '\n[[package]]\nname = "libc"\nversion = "0.2.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n',
    );
    expect(parseLockPackages(fs.readFileSync(path.join(ws.cratesDir, 'Cargo.lock'), 'utf8'))).toContainEqual({
      name: 'libc',
      external: true,
    });
    expect(checkRustWorkspace(ws).join('\n')).toContain('Cargo.lock contains libc');
  });

  it('requires a committed Cargo.lock', () => {
    const ws = makeWorkspace();
    fs.rmSync(path.join(ws.cratesDir, 'Cargo.lock'));
    expect(checkRustWorkspace(ws).join('\n')).toContain('Cargo.lock is missing');
  });

  it('catches a hand-edited module or a missing hash sidecar', () => {
    const ws = makeWorkspace();
    const bytes = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
    write(ws.wasmDir, 'mod-a.wasm', bytes);
    write(ws.wasmDir, 'mod-a.wasm.sha256', hashLine('mod-a', bytes));
    expect(mismatchedHashes(ws.wasmDir)).toEqual([]);

    write(ws.wasmDir, 'mod-a.wasm', Buffer.from([...bytes, 0]));
    expect(mismatchedHashes(ws.wasmDir)).toEqual(['src/wasm/mod-a.wasm does not match src/wasm/mod-a.wasm.sha256.']);

    fs.rmSync(path.join(ws.wasmDir, 'mod-a.wasm.sha256'));
    expect(mismatchedHashes(ws.wasmDir)).toEqual(['src/wasm/mod-a.wasm has no .sha256 sidecar.']);
  });
});

describe('scripts/build_wasm.js', () => {
  it('remaps the checkout path so builds do not depend on where the repository lives', () => {
    expect(reproducibleRustFlags('/work/repo', '')).toBe('--remap-path-prefix=/work/repo=/qrcraftly');
    expect(reproducibleRustFlags('/work/my repo', '/opt/cargo').split('\x1f')).toEqual([
      '--remap-path-prefix=/work/my repo=/qrcraftly',
      '--remap-path-prefix=/opt/cargo=/cargo',
    ]);
  });

  it('passes when the committed files match the build', () => {
    const { wasmDir } = makeWorkspace();
    const bytes = Buffer.from('module bytes');
    write(wasmDir, 'mod-a.wasm', bytes);
    write(wasmDir, 'mod-a.wasm.sha256', hashLine('mod-a', bytes));
    expect(compareWithCommitted(new Map([['mod-a', bytes]]), wasmDir)).toEqual([]);
  });

  it('reports stale, missing and orphaned modules', () => {
    const { wasmDir } = makeWorkspace();
    const committed = Buffer.from('old build');
    write(wasmDir, 'mod-a.wasm', committed);
    write(wasmDir, 'mod-a.wasm.sha256', hashLine('mod-a', committed));
    write(wasmDir, 'gone.wasm', committed);

    const problems = compareWithCommitted(
      new Map([
        ['mod-a', Buffer.from('new build')],
        ['mod-b', Buffer.from('b')],
      ]),
      wasmDir,
    );
    expect(problems.some(p => p.startsWith('src/wasm/mod-a.wasm differs from a fresh build'))).toBe(true);
    expect(problems).toContain('src/wasm/mod-a.wasm.sha256 does not match a fresh build.');
    expect(problems).toContain('src/wasm/mod-b.wasm is missing.');
    expect(problems).toContain('src/wasm/gone.wasm has no crate in crates/.');
  });
});

describe('CI wiring', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/main.yml'), 'utf8');

  it('rebuilds the committed modules in a required job', () => {
    expect(workflow).toContain('run: pnpm run wasm:check');
    expect(workflow).toMatch(/needs: \[[^\]]*\bwasm-reproducible\b[^\]]*\]/);
    expect(workflow).toContain("- 'crates/**'");
  });

  it('installs Rust with the runner rustup, not a third-party action', () => {
    expect(workflow).toContain('run: rustup toolchain install');
    expect(workflow).not.toMatch(/uses: [^\n]*(rust-toolchain|actions-rs|setup-rust)/);
  });
});
