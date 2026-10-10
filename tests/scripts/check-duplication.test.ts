import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execBinary } from '../utils/execHelper';
import { TokenTable, formatClone, globToRegExp, runDuplicationCheck, tokenize } from '../../scripts/check-duplication.js';

// Inside a git hook git exports GIT_DIR and friends, which would point `git ls-files` at the
// repository being committed to instead of the fixture repos (#1229).
const inheritedGitEnv = Object.keys(process.env).filter((key) => key.startsWith('GIT_'));
const savedGitEnv = new Map(inheritedGitEnv.map((key) => [key, process.env[key]]));

let tmp: string;
let counter = 0;

interface FixtureConfig {
  threshold?: number;
  minLines?: number;
  minTokens?: number;
  ignore?: string[];
}

/** Creates a git repository holding `files` and a `.jscpd.json`, and returns its root. */
function fixture(files: Record<string, string>, config: FixtureConfig = {}): string {
  const root = path.join(tmp, `repo-${counter++}`);
  fs.mkdirSync(root, { recursive: true });
  execBinary('git', ['init', '--quiet'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const settings = { threshold: 100, minLines: 3, minTokens: 21, path: ['src'], ignore: [], ...config };
  fs.writeFileSync(path.join(root, '.jscpd.json'), JSON.stringify(settings), 'utf8');
  for (const [file, content] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return root;
}

/** `count` statements of five tokens each (`aN(bN);`), one per line, all different. */
function statements(count: number, prefix = 'a'): string {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}(b${i});`).join('\n');
}

const TAIL_A = '\nexport const tailA = 1;\n';
const TAIL_B = "\nimport tailB from 'b';\n";

function cloneSides(root: string): string[] {
  return runDuplicationCheck(root).clones.map(formatClone);
}

describe('scripts/check-duplication.js', () => {
  beforeAll(() => {
    for (const key of inheritedGitEnv) delete process.env[key];
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-duplication-'));
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [key, value] of savedGitEnv) process.env[key] = value;
  });

  it('finds an exact clone across files', () => {
    const root = fixture({ 'src/a.ts': statements(8) + TAIL_A, 'src/b.ts': statements(8) + TAIL_B });
    const result = runDuplicationCheck(root);
    expect(result.clones.map(formatClone)).toEqual(['src/a.ts:1-8 ↔ src/b.ts:1-8']);
    expect(result.clones[0].tokens).toBe(40);
    expect(result.duplicatedLines).toBe(7);
    expect(result.totalLines).toBe(18);
    expect(result.percentage).toBeCloseTo((7 / 18) * 100, 10);
  });

  it('finds a clone within one file', () => {
    const root = fixture({ 'src/a.ts': `${statements(6)}\nexport const separator = 1;\n${statements(6)}\n` });
    expect(cloneSides(root)).toEqual(['src/a.ts:1-6 ↔ src/a.ts:8-13']);
  });

  it('does not flag a clone one token short of minTokens', () => {
    // Four statements are 20 tokens; minTokens is 21.
    const under = fixture({ 'src/a.ts': statements(4) + TAIL_A, 'src/b.ts': statements(4) + TAIL_B });
    expect(cloneSides(under)).toEqual([]);
    const at = fixture({ 'src/a.ts': statements(5) + TAIL_A, 'src/b.ts': statements(5) + TAIL_B });
    expect(cloneSides(at)).toEqual(['src/a.ts:1-5 ↔ src/b.ts:1-5']);
  });

  it('does not flag a clone one line short of minLines', () => {
    // 25 tokens over lines 1-3 (a span of 2 lines); the next token sits on the same line.
    const shared = 'a0(b0); a1(b1);\na2(b2); a3(b3);\na4(b4);';
    const under = fixture({ 'src/a.ts': `${shared} export const t = 1;\n`, 'src/b.ts': `${shared} import t from 'x';\n` });
    expect(cloneSides(under)).toEqual([]);
    const longer = 'a0(b0); a1(b1);\na2(b2);\na3(b3);\na4(b4);';
    const at = fixture({ 'src/a.ts': `${longer} export const t = 1;\n`, 'src/b.ts': `${longer} import t from 'x';\n` });
    expect(cloneSides(at)).toEqual(['src/a.ts:1-4 ↔ src/b.ts:1-4']);
  });

  it('counts a clone that reaches minLines with the token after it, as jscpd does', () => {
    const shared = 'a0(b0); a1(b1);\na2(b2); a3(b3);\na4(b4);';
    const root = fixture({ 'src/a.ts': `${shared}\nexport const t = 1;\n`, 'src/b.ts': `${shared}\nimport t from 'x';\n` });
    expect(cloneSides(root)).toEqual(['src/a.ts:1-4 ↔ src/b.ts:1-4']);
  });

  it('flags code that differs only in comments and whitespace (mild mode)', () => {
    const plain = statements(6);
    const commented = statements(6)
      .split(/\r?\n/)
      .map((line, i) => (i % 2 === 0 ? `  ${line} // note ${i}` : `/* other ${i} */ ${line}`))
      .join('\n\n');
    const root = fixture({ 'src/a.ts': plain + TAIL_A, 'src/b.ts': commented + TAIL_B });
    expect(cloneSides(root)).toEqual(['src/a.ts:1-6 ↔ src/b.ts:1-11']);
  });

  it('skips files matched by the ignore globs and files outside path', () => {
    const block = statements(8);
    const root = fixture(
      {
        'src/a.ts': block + TAIL_A,
        'src/a.test.ts': block + TAIL_B,
        'src/deep/mocks/m.ts': block + TAIL_B,
        'src/pages/dev-sandbox/x/y.tsx': block + TAIL_B,
        'scripts/s.ts': block + TAIL_B,
        'src/b.ts': `${statements(8, 'z')}${TAIL_B}`,
      },
      { ignore: ['**/*.test.ts', '**/mocks/**', 'src/pages/dev-sandbox/**/*'] }
    );
    const result = runDuplicationCheck(root);
    expect(result.files).toBe(2);
    expect(result.clones).toEqual([]);
  });

  it('fails at the threshold and passes just below it', () => {
    const files = { 'src/a.ts': statements(8) + TAIL_A, 'src/b.ts': statements(8) + TAIL_B };
    const { percentage } = runDuplicationCheck(fixture(files));
    expect(runDuplicationCheck(fixture(files, { threshold: percentage })).passed).toBe(false);
    expect(runDuplicationCheck(fixture(files, { threshold: percentage + 0.001 })).passed).toBe(true);
  });

  it('finds clones in .tsx files', () => {
    const view = (name: string) => `export function ${name}({ value }: { value: string }) {
  return (
    <section className="card">
      <h2 aria-label="Title">Summary</h2>
      <p>{value}</p>
      <img src="a.png" alt="" />
    </section>
  );
}
`;
    const root = fixture({ 'src/A.tsx': view('First'), 'src/B.tsx': view('Second') });
    expect(cloneSides(root)).toEqual(['src/A.tsx:1-9 ↔ src/B.tsx:1-9']);
  });

  it('tokenises like jscpd: one token per JSX text run, two for `</`', () => {
    const count = (code: string, file = 'f.ts') => tokenize(file, code, new TokenTable()).ids.length;
    expect(count('foo(bar); // trailing comment')).toBe(5);
    expect(count('const s = `a${b}c${d}e`;')).toBe(9);
    expect(count('const r = /ab+c/g;')).toBe(5);
    expect(count('x = a / b / c;')).toBe(8);
    expect(count('x >>= 2;')).toBe(4);
    expect(count('let m: Map<string, Array<number>> = n;')).toBe(15);
    expect(count('x = <div>\n  <span>a</span>\n  b\n</div>;', 'f.tsx')).toBe(20);
    expect(count('x = <div aria-label="b" />;', 'f.tsx')).toBe(10);
    expect(count('x = <div a={b} />;', 'f.tsx')).toBe(12);
    expect(count('const f = <T,>(a: T) => a;', 'f.tsx')).toBe(15);
  });

  it('compiles ** and * globs', () => {
    expect(globToRegExp('**/*.test.ts').test('src/a/b.test.ts')).toBe(true);
    expect(globToRegExp('**/*.test.ts').test('b.test.ts')).toBe(true);
    expect(globToRegExp('**/mocks/**').test('src/x/mocks/y/z.ts')).toBe(true);
    expect(globToRegExp('src/*.ts').test('src/a/b.ts')).toBe(false);
    expect(globToRegExp('src/pages/dev-sandbox/**/*').test('src/pages/dev-sandbox/p.tsx')).toBe(true);
    expect(globToRegExp('src/a.ts').test('src/aXts')).toBe(false);
  });
});
