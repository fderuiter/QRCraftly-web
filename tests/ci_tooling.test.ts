import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import stagedRules from '../scripts/hooks/staged.config.js';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

/** Minimal GitHub Actions `paths` glob matcher: `**` crosses folders, `*` does not. */
function matchesGlob(file: string, glob: string): boolean {
  const pattern = glob
    .split('**')
    .map(part => part.split('*').map(chunk => chunk.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${pattern}$`).test(file);
}

function workflowPushPaths(): string[] {
  const lines = read('.github/workflows/main.yml').split(/\r?\n/);
  const start = lines.findIndex(line => /^\s+paths:/.test(line));
  const paths: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+- '([^']+)'\s*$/.exec(line);
    if (!match) break;
    paths.push(match[1]);
  }
  return paths;
}

type PackageJson = {
  scripts: Record<string, string>;
  engines?: Record<string, string>;
  overrides?: unknown;
  devDependencies: Record<string, string>;
};

const pkg: PackageJson = JSON.parse(read('package.json'));

describe('CI trigger paths (main.yml)', () => {
  const paths = workflowPushPaths();

  it.each([
    'docs/adr/0001-client-side-storage-allowlist.md',
    'docs/agents/domain.md',
    'CONTEXT.md',
    'AGENTS.md',
    'README.md',
    'src/packages/scannability/worker.ts',
    'tests/ci_tooling.test.ts',
    'eslint.config.js',
    'knip.json',
    'semgrep.yml',
    'pnpm-workspace.yaml',
    '.github/actions/setup/action.yml',
    '.githooks/pre-commit',
    'scripts/hooks/staged.config.js',
    '.nvmrc',
    '.github/rulesets/README.md'
  ])('runs CI when only %s changes', file => {
    expect(paths.some(glob => matchesGlob(file, glob))).toBe(true);
  });
});

describe('documentation checks wiring', () => {
  it('defines docs:lint with every doc audit', () => {
    const docsLint = pkg.scripts['docs:lint'];
    for (const step of ['audit_markdown.js', 'validate_adrs.js', 'validate_ui_catalog.js']) {
      expect(docsLint).toContain(step);
    }
  });

  it('runs docs:lint from lint, and builds the docs manifest in Vite instead of committing it', () => {
    expect(pkg.scripts.lint).toContain('pnpm run docs:lint');
    for (const script of Object.values(pkg.scripts)) {
      expect(script).not.toContain('compile_docs_manifest.js');
    }
    expect(fs.existsSync(path.join(process.cwd(), 'src/data/docs_manifest.json'))).toBe(false);
    expect(fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8')).toContain('docsManifest()');
  });

  it('runs the doc checks from the pre-commit hook for staged Markdown files', () => {
    const commands = stagedRules
      .filter(rule => rule.match('docs/adr/0001-client-side-storage-allowlist.md'))
      .flatMap(rule => rule.commands.map(command => command.run.join(' ')))
      .join('\n');
    expect(commands).toContain('prettier --write');
    expect(commands).toContain('node scripts/audit_markdown.js');
    expect(commands).toContain('node scripts/validate_adrs.js');
    expect(commands).not.toContain('compile_docs_manifest.js');
  });
});

describe('package.json hygiene', () => {
  it('declares engines matching the lockfile Node requirement', () => {
    expect(pkg.engines?.node).toBe('^22.22.2 || >=24.15.0');
    expect(read('.nvmrc').trim()).toBe('22.22.2');
    expect(read('.node-version').trim()).toBe('22.22.2');
  });

  it('keeps @types/node on the Node 22 line', () => {
    expect(pkg.devDependencies['@types/node']).toMatch(/^\^22\./);
  });

  it('has no npx calls, ignored overrides, unused deps or duplicate aliases', () => {
    for (const command of Object.values(pkg.scripts)) {
      expect(command).not.toMatch(/\bnpx\b/);
    }
    expect(pkg.overrides).toBeUndefined();
    expect(pkg.devDependencies['bidi-js']).toBeUndefined();
    const commands = Object.values(pkg.scripts);
    expect(new Set(commands).size).toBe(commands.length);
  });

  it('keeps pnpm overrides in pnpm-workspace.yaml', () => {
    const workspace = read('pnpm-workspace.yaml');
    expect(workspace).toMatch(/^overrides:/m);
    expect(workspace).toContain('browserslist:');
  });
});

describe('setup composite action', () => {
  const action = read('.github/actions/setup/action.yml');

  it('installs pnpm with pnpm/action-setup and Node from .nvmrc, not npm install -g', () => {
    expect(action).toMatch(/uses: pnpm\/action-setup@[0-9a-f]{40}/);
    expect(action).toContain('node-version-file: .nvmrc');
    expect(action).not.toMatch(/npm install -g/);
  });

  it('reports the real cache result instead of a hard-coded value', () => {
    expect(action).toContain('value: ${{ steps.setup-node.outputs.cache-hit }}');
    expect(action).not.toMatch(/cache-hit[^\n]*"true"/);
  });

  it('keeps ${{ }} expressions out of run: blocks', () => {
    const runLines = action.split(/\r?\n/).filter(line => /^\s*run:/.test(line));
    for (const line of runLines) {
      expect(line).not.toContain('${{');
    }
  });

  it('supports cache-playwright input with actions/cache for ~/.cache/ms-playwright', () => {
    expect(action).toContain('cache-playwright:');
    expect(action).toContain('default: "false"');
    expect(action).toMatch(/uses: actions\/cache@1bd1e32a3bdc45362d1e726936510720a7c30a57/);
    expect(action).toContain('path: ~/.cache/ms-playwright');
    expect(action).toContain("key: ${{ runner.os }}-playwright-${{ hashFiles('pnpm-lock.yaml') }}");
  });
});

describe('playwright browser caching in workflows', () => {
  it('enables cache-playwright in release.yml smoke-tests job', () => {
    const release = read('.github/workflows/release.yml');
    expect(release).toContain('cache-playwright: \'true\'');
  });

  it('enables cache-playwright in main.yml e2e and verify-staging jobs', () => {
    const main = read('.github/workflows/main.yml');
    expect(main).toContain('cache-playwright: \'true\'');
  });
});

describe('scheduled dependency audit alert', () => {
  const workflow = read('.github/workflows/audit-moderate.yml');

  it('reports through a GitHub issue, not SMTP email', () => {
    expect(workflow).toContain('run: node scripts/ci/audit_issue.js');
    expect(workflow).toContain('issues: write');
    expect(workflow).not.toMatch(/action-send-mail|SMTP_|MAIL_TO|MAIL_FROM/);
  });

  it('still fails the job when the audit fails', () => {
    expect(workflow).toContain("if: steps.audit.outcome == 'failure'");
    expect(workflow).toContain('exit 1');
  });
});

describe('generated files stay out of the tracked tree', () => {
  it('points Lighthouse CI at the generated config in dist/', () => {
    expect(read('.github/workflows/main.yml')).toContain('configPath: "./dist/lighthouserc.json"');
    const base = JSON.parse(read('lighthouserc.json'));
    expect(base.ci.collect.url).toBeUndefined();
  });

  it('never hides build-time rewrites with a workspace reset in CI', () => {
    expect(read('.github/workflows/main.yml')).not.toMatch(/git checkout -- \./);
  });

  it('does not measure coverage for a functions/ tree that does not exist', () => {
    expect(fs.existsSync(path.join(root, 'functions'))).toBe(false);
    expect(read('vite.config.ts')).not.toContain("'functions/**/*.ts'");
  });
});

/** Returns the body of one job in main.yml (from `  <name>:` to the next top-level job). */
function jobBlock(name: string): string {
  const workflow = read('.github/workflows/main.yml');
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex(line => line === `  ${name}:`);
  expect(start).toBeGreaterThan(-1);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[a-z][a-z0-9-]*:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

describe('CI builds the app once', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uploads dist from the build job and serves it in the e2e job', () => {
    const build = jobBlock('build');
    const e2e = jobBlock('e2e');
    expect(build).toMatch(/- run: pnpm run build/);
    expect(build).toMatch(/uses: actions\/upload-artifact@[0-9a-f]{40}[\s\S]*name: dist\n\s*path: dist\//);
    expect(e2e).toMatch(/needs: build/);
    expect(e2e).toMatch(/uses: actions\/download-artifact@[0-9a-f]{40}[\s\S]*name: dist\n\s*path: dist\//);
    expect(e2e).toContain('PLAYWRIGHT_USE_EXISTING_BUILD: "true"');
    expect(e2e).not.toMatch(/pnpm (run )?build/);
  });

  it('runs the development-hydration suite in the e2e job', () => {
    expect(jobBlock('e2e')).toContain('run: pnpm run test:e2e:dev');
  });

  it('skips the build in the Playwright web server only when a build is supplied', async () => {
    vi.stubEnv('PLAYWRIGHT_TEST_BASE_URL', '');
    vi.stubEnv('PLAYWRIGHT_USE_EXISTING_BUILD', 'true');
    const prebuilt = (await import('../playwright.config')).default;
    expect(prebuilt.webServer).toMatchObject({ command: 'pnpm run preview' });

    vi.resetModules();
    vi.stubEnv('PLAYWRIGHT_USE_EXISTING_BUILD', '');
    const local = (await import('../playwright.config')).default;
    expect(local.webServer).toMatchObject({ command: 'pnpm run build && pnpm run preview' });
  });
});
