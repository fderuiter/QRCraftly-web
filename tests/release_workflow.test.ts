import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Release Workflow Structural Invariants Audit', () => {
  const workflowPath = path.resolve(process.cwd(), '.github/workflows/release.yml');

  it('ensures release.yml exists and can be read', () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
  });

  it('verifies that the resolve step uses gh release view to check release existence and provides GH_TOKEN', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');
    expect(content).toContain('gh release view "$TAG"');

    // Find the resolve step section
    const resolveStepMatch = content.match(/id:\s*resolve[\s\S]*?(?=\n\s*-\s*name:|$)/);
    expect(resolveStepMatch).not.toBeNull();
    const resolveStep = resolveStepMatch![0];

    expect(resolveStep).toContain('GH_TOKEN: ${{ github.token }}');
    expect(resolveStep).toContain('published=false');
  });

  it('verifies that release notes extraction executes BEFORE annotated tag creation', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');

    const extractIndex = content.indexOf('Extract release notes from CHANGELOG.md');
    const tagIndex = content.indexOf('Create annotated tag');

    expect(extractIndex).toBeGreaterThan(-1);
    expect(tagIndex).toBeGreaterThan(-1);
    expect(extractIndex).toBeLessThan(tagIndex);
  });

  it('verifies that tag creation checks tag existence idempotently before git tag -a', () => {
    const content = fs.readFileSync(workflowPath, 'utf8');

    const tagStepMatch = content.match(/name:\s*Create annotated tag[\s\S]*?(?=\n\s*-\s*name:|\n\s*smoke-tests:|$)/);
    expect(tagStepMatch).not.toBeNull();
    const tagStep = tagStepMatch![0];

    expect(tagStep).toContain('git rev-parse -q --verify "refs/tags/$RELEASE_TAG"');
    expect(tagStep).toContain('git tag -a');
    expect(tagStep).toContain('git push origin "refs/tags/$RELEASE_TAG"');
  });
});

describe('Release production checks (#1217, #1394)', () => {
  const content = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
  const job = (name: string) => {
    const start = content.indexOf(`\n  ${name}:`);
    const next = content.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
    return next === -1 ? content.slice(start) : content.slice(start, start + 1 + next);
  };
  const strict = job('smoke-tests');
  const customDomain = job('custom-domain-version');
  const advisory = job('custom-domain-smoke');
  const gate = job('publish-release');

  it('runs the strict smoke suite on workers.dev, without a blind retry', () => {
    expect(strict).toContain('BASE_URL: https://qrcraftly.fpderuiter.workers.dev');
    expect(strict).toContain('bash scripts/ci/run_smoke_tests.sh');
    expect(strict).not.toContain('continue-on-error');
    expect(strict).not.toContain('if bash');
  });

  it('gives qrcraftly.com a 30-minute wait for the version and the job room for it', () => {
    expect(customDomain).toContain('BASE_URL: https://qrcraftly.com');
    expect(customDomain).toContain("TIMEOUT_SECONDS: '1800'");
    expect(customDomain).toContain('bash scripts/ci/wait_for_deploy.sh');
    const jobMinutes = Number(/timeout-minutes:\s*(\d+)/.exec(customDomain)?.[1]);
    expect(jobMinutes).toBeGreaterThan(30);
  });

  it('publishes only when workers.dev passes and both URLs serve the version', () => {
    expect(gate).toContain('needs: [publish, smoke-tests, custom-domain-version]');
    expect(gate).not.toContain('custom-domain-smoke');
  });

  it('runs the full suite on qrcraftly.com as a warning, not a gate', () => {
    expect(advisory).toContain('PLAYWRIGHT_TEST_BASE_URL: https://qrcraftly.com');
    expect(advisory).toContain('::warning title=qrcraftly.com differs from the build::');
  });
});

describe('GitHub Releases follow the Cloudflare deploy', () => {
  const content = fs.readFileSync(path.resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
  const publishJob = content.slice(content.indexOf('  publish:'), content.indexOf('  smoke-tests:'));
  const releaseJob = content.slice(content.indexOf('  publish-release:'));

  it('creates the release as a draft before production is checked', () => {
    expect(publishJob).toContain('gh release create "$RELEASE_TAG" --verify-tag --draft');
    expect(publishJob).not.toContain('--latest');
    expect(publishJob).not.toContain('--draft=false');
  });

  it('finishes a draft left by an earlier run instead of treating it as published', () => {
    expect(publishJob).toContain('gh release view "$TAG" --json isDraft --jq .isDraft');
  });

  it('publishes only after both production legs and their smoke tests pass', () => {
    expect(releaseJob).toContain('needs: [publish, smoke-tests, custom-domain-version]');
    expect(releaseJob).not.toMatch(/if:.*always\(\)/);
    expect(releaseJob).toContain('gh release edit "$RELEASE_TAG" --draft=false --latest="$MAKE_LATEST"');
  });

  it('gives the Latest badge only to the newest version', () => {
    expect(publishJob).toContain("sort -uV | tail -n 1");
    expect(publishJob).toContain('latest=false');
  });
});
