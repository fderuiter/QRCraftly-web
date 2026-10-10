import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const repoRoot = process.cwd();

// `run:` or `script:` as a mapping key, also as the first key of a list item (`- run: ...`).
const EXEC_KEY = /^(\s*)(-\s+)?(run|script)\s*:(.*)$/;
// A block scalar header: `|` or `>` with optional chomping (+/-) and indentation indicators.
const BLOCK_SCALAR = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?\s*(?:#.*)?$/;

/**
 * Returns `file:line: text` for every `${{ ... }}` inside a `run:` or `script:` value, whether the
 * value sits on the key line (plain, quoted or piped one-liner), in a literal or folded block, or in
 * a plain scalar continued on the following lines.
 */
function findInlineExpressions(content: string, file: string): string[] {
  const violations: string[] = [];
  const lines = content.split(/\r?\n/);
  // Column of the open run:/script: key; lines indented deeper belong to its value.
  let keyColumn = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;

    if (keyColumn >= 0) {
      if (line.trim().length === 0 || indent > keyColumn) {
        if (line.includes('${{')) violations.push(`${file}:${i + 1}: ${line.trim()}`);
        continue;
      }
      keyColumn = -1;
    }

    const match = line.match(EXEC_KEY);
    if (!match) continue;
    const [, leading, dash = '', , rest] = match;
    keyColumn = leading.length + dash.length;
    const value = rest.trim();
    if (!BLOCK_SCALAR.test(value) && value.includes('${{')) {
      violations.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  }

  return violations;
}

/** Workflow files plus composite actions (`.github/actions/<name>/action.yml`). */
function listAuditedFiles(): string[] {
  const workflowsDir = path.join(repoRoot, '.github/workflows');
  const actionsDir = path.join(repoRoot, '.github/actions');
  const files = fs
    .readdirSync(workflowsDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => path.join(workflowsDir, f));
  if (fs.existsSync(actionsDir)) {
    for (const entry of fs.readdirSync(actionsDir, { recursive: true, encoding: 'utf8' })) {
      if (/(^|[\\/])action\.ya?ml$/.test(entry)) files.push(path.join(actionsDir, entry));
    }
  }
  return files.map((f) => path.relative(repoRoot, f).split(path.sep).join('/'));
}

describe('GitHub Actions Workflow Hardening Audit', () => {
  it('audits all workflow files and composite actions to ensure no inline ${{ }} expansions exist inside run or script execution blocks', () => {
    const files = listAuditedFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('.github/actions/setup/action.yml');

    const violations = files.flatMap((file) =>
      findInlineExpressions(fs.readFileSync(path.join(repoRoot, file), 'utf8'), file)
    );
    expect(violations).toEqual([]);
  });

  describe('scanner', () => {
    const steps = (body: string) => `jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n${body}`;

    it.each([
      ['a list-item one-liner', '      - run: echo "${{ github.event.pull_request.title }}"\n'],
      ['a piped one-liner', '      - run: echo "${{ github.event.pull_request.title }}" | tee out.txt\n'],
      ['a folded block', '      - run: >-\n          echo "${{ github.event.pull_request.body }}"\n'],
      ['a literal block', '      - name: Echo\n        run: |\n          echo ok\n          echo "${{ github.head_ref }}"\n'],
      ['a block with an indentation indicator', '      - run: |2-\n          echo "${{ github.head_ref }}"\n'],
      ['a plain scalar continued on the next line', '      - run: echo first\n          "${{ github.head_ref }}"\n'],
      [
        'a github-script script block',
        '      - uses: actions/github-script@v7\n        with:\n          script: |\n            core.info("${{ github.head_ref }}")\n',
      ],
    ])('flags %s', (_label, body) => {
      expect(findInlineExpressions(steps(body), 'bad.yml')).toHaveLength(1);
    });

    it('flags the same shapes in a composite action', () => {
      const action = 'runs:\n  using: composite\n  steps:\n    - run: echo "${{ inputs.name }}"\n      shell: bash\n';
      expect(findInlineExpressions(action, 'action.yml')).toHaveLength(1);
    });

    it('accepts expressions passed through env, if and with', () => {
      const body = [
        '      - name: Safe',
        "        if: ${{ github.event_name == 'push' }}",
        '        env:',
        '          TITLE: ${{ github.event.pull_request.title }}',
        '        run: |',
        '          echo "$TITLE" | tee out.txt',
        '      - run: echo "$TITLE"',
        '        env:',
        '          TITLE: ${{ github.head_ref }}',
        '      - uses: actions/checkout@v4',
        '        with:',
        '          ref: ${{ github.head_ref }}',
        '',
      ].join('\n');
      expect(findInlineExpressions(steps(body), 'good.yml')).toEqual([]);
    });
  });
});
