import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

interface StatusCheck {
  context: string;
  integration_id?: number;
}
interface Rule {
  type: string;
  parameters?: { required_status_checks?: StatusCheck[] };
}

function requiredContexts(file: string): StatusCheck[] {
  const ruleset: { rules: Rule[] } = JSON.parse(read(file));
  return ruleset.rules.flatMap(rule => rule.parameters?.required_status_checks ?? []);
}

describe('Stitch review gate (ADR 0051)', () => {
  const workflow = read('.github/workflows/main.yml');

  it('is required by both main rulesets and only accepted from GitHub Actions', () => {
    for (const file of ['.github/rulesets/main.json', '.github/rulesets/main-merge-queue.json']) {
      expect(requiredContexts(file)).toContainEqual({ context: 'Stitch review', integration_id: 15368 });
    }
  });

  it('is posted by the Plan job as pending or success, never as a failure', () => {
    expect(workflow).toContain('context="Stitch review"');
    expect(workflow).toContain('statuses: write');
    expect(workflow).toMatch(/state=pending/);
    expect(workflow).toMatch(/state=success/);
    expect(workflow).not.toMatch(/state=(failure|error)/);
  });

  it('does not fail CI while a bot PR waits for review', () => {
    const ciJob = workflow.slice(workflow.indexOf('\n  ci:\n'));
    const awaitingBranch = ciJob.slice(ciJob.indexOf('if [ "$AWAITING_APPROVAL" = "true" ]'), ciJob.indexOf('fi', ciJob.indexOf('if [ "$AWAITING_APPROVAL" = "true" ]')));
    expect(awaitingBranch).not.toContain('exit 1');
  });
});
