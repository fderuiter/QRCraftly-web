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

type PackageJson = {
  scripts: Record<string, string>;
  engines?: Record<string, string>;
  overrides?: unknown;
  devDependencies: Record<string, string>;
};

const pkg: PackageJson = JSON.parse(read('package.json'));

describe('CI triggers and tiers (main.yml, ADR 0050)', () => {
  const workflow = read('.github/workflows/main.yml');

  it('runs on pull requests, nightly and by hand, but not on pushes to main', () => {
    expect(workflow).toMatch(/pull_request:\n\s+branches: \[main\]\n\s+types: \[opened, synchronize, reopened, ready_for_review\]/);
    expect(workflow).toMatch(/schedule:\n\s+- cron: '0 7 \* \* \*'/);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s+push:/m);
  });

  it('lets the plan decide the E2E and Lighthouse tiers', () => {
    expect(jobBlock('plan')).toContain('run: node scripts/ci/ci_plan.js');
    expect(jobBlock('test-shard')).toContain("if: needs.plan.outputs.unit_tests == 'true'");
    expect(jobBlock('e2e')).toContain("if: needs.plan.outputs.e2e != 'none'");
    expect(jobBlock('e2e')).toContain('pnpm run test:e2e --project=chromium --project=chromium-csp');
    expect(jobBlock('lighthouse')).toContain("if: needs.plan.outputs.lighthouse != 'none'");
    expect(jobBlock('lighthouse')).toContain('run: node scripts/ci/lighthouse_sample.js dist/lighthouserc.json');
    expect(jobBlock('lighthouse')).toContain('temporaryPublicStorage: false');
  });

  it('fails the CI aggregate on a failed plan or job but passes planned skips', () => {
    const ci = jobBlock('ci');
    expect(ci).toMatch(/needs: \[plan, dependency-audit, static-validation, test, wasm-reproducible, e2e, build, lighthouse\]/);
    expect(ci).toContain('if: ${{ !cancelled() }}');
    expect(ci).toContain('[ "$PLAN_RESULT" != "success" ]');
    expect(ci).toContain('[ "$result" != "skipped" ]');
  });

  it('runs unit tests in parallel shards and checks coverage once on the merged reports', () => {
    const shard = jobBlock('test-shard');
    expect(shard).toContain('shard: [1, 2, 3]');
    expect(shard).toContain('fail-fast: false');
    expect(shard).toContain('VITEST_SHARD_RUN: "true"');
    expect(shard).toContain('--shard="$SHARD/3" --reporter=blob');
    expect(shard).toContain('include-hidden-files: true');

    const merge = jobBlock('test');
    expect(merge).toContain('needs: [plan, test-shard]');
    expect(merge).toContain("if: ${{ !cancelled() && needs.plan.outputs.unit_tests == 'true' }}");
    expect(merge).toContain('[ "$SHARDS_RESULT" != "success" ]');
    expect(merge).toContain('pnpm exec vitest run --merge-reports --coverage');
    expect(merge).not.toContain('VITEST_SHARD_RUN');
    expect(read('vite.config.ts')).toContain("thresholds: process.env.VITEST_SHARD_RUN === 'true' ? {} : { ...coverageThresholds }");
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

  it('enables cache-playwright in the main.yml e2e job and the deploy check', () => {
    expect(jobBlock('e2e')).toContain('cache-playwright: \'true\'');
    expect(read('.github/workflows/deploy-verify.yml')).toContain('cache-playwright: \'true\'');
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
function jobBlock(name: string, file = '.github/workflows/main.yml'): string {
  const workflow = read(file);
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
    expect(e2e).toMatch(/needs: \[plan, build\]/);
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

describe('post-merge production check (#1217)', () => {
  it('waits for workers.dev to serve the merged commit after every push to main', () => {
    const job = jobBlock('verify-staging', '.github/workflows/deploy-verify.yml');
    expect(job).toContain('name: Verify Production Deployment');
    expect(read('.github/workflows/deploy-verify.yml')).toMatch(/push:\n\s+branches: \[main\]/);
    expect(job).toContain("if: github.ref == 'refs/heads/main'");
    expect(job).toContain('BASE_URL: "https://qrcraftly.fpderuiter.workers.dev"');
    expect(job).toContain('EXPECTED_COMMIT: ${{ github.sha }}');
    expect(job).toContain('run: bash scripts/ci/wait_for_deploy.sh');
    expect(job).not.toContain('continue-on-error');
  });
});

describe('runner queue hygiene', () => {
  it('cancels superseded PR Title runs', () => {
    const title = read('.github/workflows/pr-title.yml');
    expect(title).toContain('group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}');
    expect(title).toContain('cancel-in-progress: true');
  });
});

describe('visual baseline refresh (#1426)', () => {
  const workflow = read('.github/workflows/update-snapshots.yml');

  it('runs from a label or by hand, and never on main or a fork PR', () => {
    expect(workflow).toMatch(/pull_request:\n\s+types: \[labeled\]/);
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain("github.ref != 'refs/heads/main'");
    expect(workflow).toContain("github.event.label.name == 'update-snapshots'");
    expect(workflow).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('runs only the visual spec and commits only its baselines', () => {
    expect(workflow).toContain('pnpm exec playwright test e2e/visual-regression.spec.ts');
    expect(workflow).toContain('--update-snapshots');
    expect(workflow).toContain('git add e2e/visual-regression.spec.ts-snapshots');
    expect(workflow).not.toMatch(/git add (-A|\.|--all)/);
  });
});
