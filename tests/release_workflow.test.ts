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
