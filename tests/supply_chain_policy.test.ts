import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The dependency and build supply-chain policy in docs/SECURITY.md (#1351), checked against the
 * files that carry it, so a quiet edit cannot weaken it.
 */

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

function ciFiles(): string[] {
  const workflows = fs.readdirSync(path.join(root, '.github/workflows')).map((file) => `.github/workflows/${file}`);
  const actions = fs.readdirSync(path.join(root, '.github/actions')).map((dir) => `.github/actions/${dir}/action.yml`);
  return [...workflows, ...actions].filter((file) => /\.ya?ml$/.test(file) && fs.existsSync(path.join(root, file)));
}

describe('supply chain policy (#1351)', () => {
  it('installs dependencies in CI only from the committed lockfile', () => {
    const installs: string[] = [];
    for (const file of ciFiles()) {
      for (const line of read(file).split(/\r?\n/)) {
        if (/\bpnpm (install|i|add)\b/.test(line) && !line.trim().startsWith('#')) installs.push(`${file}: ${line.trim()}`);
        expect(line, `${file} uses another package manager`).not.toMatch(/(^|\s)(npm (install|ci|i)|npx|yarn)\s/);
      }
    }
    expect(installs.length).toBeGreaterThan(0);
    for (const install of installs) expect(install).toMatch(/pnpm install --frozen-lockfile/);
  });

  it('pins the exact pnpm version and resolves every package from the registry with a SHA-512 hash', () => {
    const pkg = JSON.parse(read('package.json')) as { packageManager: string };
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+(\+sha\d+\.[0-9a-f]+)?$/);

    const lock = read('pnpm-lock.yaml');
    const resolutions = lock.split(/\r?\n/).filter((line) => /^\s+resolution:/.test(line));
    expect(resolutions.length).toBeGreaterThan(100);
    // No git, tarball or directory dependencies: each one is a registry package with integrity.
    expect(resolutions.filter((line) => !/resolution: \{integrity: sha512-[A-Za-z0-9+/=]+\}/.test(line))).toEqual([]);
  });

  it('lets only reviewed packages run install scripts and waits a day before using a new release', () => {
    const workspace = read('pnpm-workspace.yaml');
    expect(workspace).toMatch(/^strictDepBuilds: true$/m);
    expect(workspace).toMatch(/^minimumReleaseAge: 1440$/m);
    const allowBuilds = /^allowBuilds:\r?\n((?:\s+.+\r?\n)+)/m.exec(workspace)?.[1] ?? '';
    const allowed = allowBuilds
      .split(/\r?\n/)
      .map((line) => /^\s+([^:#\s]+):\s*true/.exec(line)?.[1])
      .filter(Boolean);
    // Adding a package here lets its install script run on every developer machine and in CI.
    // Review the script, then update this list and the Supply Chain section of docs/SECURITY.md.
    expect(allowed).toEqual(['esbuild', 'workerd']);
  });

  it('keeps automated advisories and update checks on for every ecosystem', () => {
    const dependabot = read('.github/dependabot.yml');
    for (const ecosystem of ['npm', 'github-actions', 'pip']) {
      expect(dependabot).toContain(`package-ecosystem: "${ecosystem}"`);
    }
    expect(read('.github/workflows/main.yml')).toMatch(/pnpm audit --audit-level=high/);
    expect(read('.github/workflows/audit-moderate.yml')).toMatch(/pnpm audit --audit-level=moderate/);
  });

  it('audits the emitted assets as the last step of every build', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    const steps = pkg.scripts.postbuild.split('&&').map((step) => step.trim());
    const audit = steps.indexOf('node scripts/emitted_asset_audit.js');
    expect(audit).toBeGreaterThan(steps.indexOf('node scripts/csp_hash_injector.js'));
    expect(audit).toBeGreaterThan(steps.indexOf('node scripts/generate_sw.cjs'));
  });
});
