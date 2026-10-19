import { ESLint } from 'eslint';
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { LEGACY_TYPE_ASSERTION_FILES } from '../eslint/legacy-type-assertions.js';

const RULE = '@typescript-eslint/consistent-type-assertions';

/** Counts `x as T` and `<T>x` in a file, leaving out `as const`. */
function countAssertions(file: string): number {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const isConst = ts.isTypeReferenceNode(node.type) && node.type.typeName.getText(source) === 'const';
      if (!isConst) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

async function assertionErrors(code: string, filePath: string): Promise<number> {
  const results = await new ESLint().lintText(code, { filePath: join(process.cwd(), filePath) });
  return results[0].messages.filter((m) => m.ruleId === RULE).length;
}

describe('type assertion rule (AGENTS.md: no loose assertions)', () => {
  it('rejects a type assertion in app code but allows as const', async () => {
    expect(await assertionErrors('export const a = JSON.parse("1") as number;\n', 'src/utils/newFile.ts')).toBe(1);
    expect(await assertionErrors('export const b = ["x"] as const;\n', 'src/utils/newFile.ts')).toBe(0);
  }, 30000);

  it('leaves tests alone', async () => {
    expect(await assertionErrors('export const a = JSON.parse("1") as number;\n', 'src/utils/newFile.test.ts')).toBe(0);
  }, 30000);

  it('keeps the legacy list sorted and free of duplicates', () => {
    const sorted = [...LEGACY_TYPE_ASSERTION_FILES].sort();
    expect([...LEGACY_TYPE_ASSERTION_FILES]).toEqual(sorted);
    expect(new Set(LEGACY_TYPE_ASSERTION_FILES).size).toBe(LEGACY_TYPE_ASSERTION_FILES.length);
  });

  it('only lists files that still have an assertion, so the list shrinks as they are cleaned up', () => {
    const clean = LEGACY_TYPE_ASSERTION_FILES.filter((file) => fs.existsSync(file) && countAssertions(file) === 0);
    expect(clean, 'Fix: remove these files from eslint/legacy-type-assertions.js').toEqual([]);
  });
});
