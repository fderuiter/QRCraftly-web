import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execBinary } from '../utils/execHelper';
import { chunkFiles, splitNul } from '../../scripts/hooks/staged.js';
import stagedRules from '../../scripts/hooks/staged.config.js';

const STAGED_SCRIPT = path.join(process.cwd(), 'scripts', 'hooks', 'staged.js');

// Inside a git hook (a commit runs the unit suite), git exports GIT_DIR, GIT_INDEX_FILE
// and friends. Left in place, the git calls below would act on the repository being
// committed to instead of the temp repo (#1229).
const inheritedGitEnv = Object.keys(process.env).filter((key) => key.startsWith('GIT_'));
const savedGitEnv = new Map(inheritedGitEnv.map((key) => [key, process.env[key]]));

/** Windows forbids double quotes in file names. */
const quotesAllowed = path.sep === '/';

type RunResult = { status: number; stdout: string; stderr: string };
type Call = { label: string; files: string[] };

let tmp: string;
let stubs: string;
let repo: string;
let callLog: string;

function git(...args: string[]): string {
  return execBinary('git', args, { cwd: repo, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(file: string, content: string): void {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

function read(file: string): string {
  return fs.readFileSync(path.join(repo, file), 'utf8');
}

/** The staged content of a file. */
function indexContent(file: string): string {
  return git('show', `:${file}`);
}

function calls(): Call[] {
  if (!fs.existsSync(callLog)) return [];
  return fs
    .readFileSync(callLog, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Call);
}

/** Writes a stub config; `body` is the rule table, with STUB(name) for stub paths. */
function config(body: string): string {
  const file = path.join(tmp, `config-${Math.random().toString(36).slice(2)}.mjs`);
  const source = body.replace(/STUB\((\w+)\)/g, (_match, name: string) => JSON.stringify(path.join(stubs, `${name}.mjs`)));
  fs.writeFileSync(file, `export default ${source};\n`, 'utf8');
  return file;
}

function runStagedScript(configFile: string, extra: string[] = []): RunResult {
  try {
    const stdout = execBinary(process.execPath, [STAGED_SCRIPT, '--config', configFile, ...extra], {
      cwd: repo,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CALL_LOG: callLog },
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? 1, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '') };
  }
}

const RECORD = `
import fs from 'node:fs';
export function record(label, files) {
  fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({ label, files }) + '\\n');
}
`;

const STUBS: Record<string, string> = {
  record: RECORD,
  // Records the call: node record.mjs <label> <files...>
  log: `import { record } from './record.mjs';\nconst [label, ...files] = process.argv.slice(2);\nrecord(label, files);\n`,
  // A fixer: appends a marker line to every file.
  fix: `import fs from 'node:fs';\nimport { record } from './record.mjs';\nconst files = process.argv.slice(2);\nrecord('fix', files);\nfor (const file of files) fs.appendFileSync(file, '// fixed\\n');\n`,
  // A checker: fails when a file contains BAD.
  check: `import fs from 'node:fs';\nimport { record } from './record.mjs';\nconst files = process.argv.slice(2);\nrecord('check', files);\nif (files.some((file) => fs.readFileSync(file, 'utf8').includes('BAD'))) process.exit(2);\n`,
  // Always fails.
  fail: `import { record } from './record.mjs';\nrecord('fail', process.argv.slice(2));\nprocess.exit(3);\n`,
};

describe('scripts/hooks/staged.js', () => {
  beforeAll(() => {
    for (const key of inheritedGitEnv) delete process.env[key];
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'staged-hook-'));
    stubs = path.join(tmp, 'stubs');
    fs.mkdirSync(stubs);
    for (const [name, source] of Object.entries(STUBS)) {
      fs.writeFileSync(path.join(stubs, `${name}.mjs`), source, 'utf8');
    }
  });

  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const [key, value] of savedGitEnv) process.env[key] = value;
  });

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    callLog = path.join(repo, '..', `${path.basename(repo)}.calls`);
    git('init', '--quiet');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    git('config', 'core.autocrlf', 'false');
    write('base.txt', 'base\n');
    git('add', '-A');
    git('commit', '--quiet', '-m', 'base');
  });

  it('passes with nothing staged', () => {
    const result = runStagedScript(config(`[{ name: 'all', match: () => true, commands: [{ label: 'log', run: ['node', STUB(log), 'all'] }] }]`));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no staged files');
    expect(calls()).toEqual([]);
  });

  it('matches staged files to the right commands and runs whole-set checks once', () => {
    write('src/a.ts', 'a\n');
    write('styles/b.css', 'b\n');
    write('docs/c.md', 'c\n');
    write('docs/d.md', 'd\n');
    write('notes.txt', 'n\n');
    write('unstaged.ts', 'not staged\n');
    git('add', 'src/a.ts', 'styles/b.css', 'docs/c.md', 'docs/d.md', 'notes.txt');

    const result = runStagedScript(
      config(`[
        { name: 'all', match: () => true, commands: [{ label: 'x', run: ['node', STUB(log), 'all'] }] },
        { name: 'ts', match: (f) => f.endsWith('.ts'), commands: [{ label: 'x', run: ['node', STUB(log), 'ts'] }] },
        { name: 'css', match: (f) => f.endsWith('.css'), commands: [{ label: 'x', run: ['node', STUB(log), 'css'] }] },
        { name: 'md', match: (f) => f.endsWith('.md'), commands: [
          { label: 'x', run: ['node', STUB(log), 'md'] },
          { label: 'y', run: ['node', STUB(log), 'md-once'], files: false },
        ] },
        { name: 'yaml', match: (f) => f.endsWith('.yaml'), commands: [{ label: 'x', run: ['node', STUB(log), 'yaml'] }] },
      ]`)
    );

    expect(result.status).toBe(0);
    expect(calls()).toEqual([
      { label: 'all', files: ['docs/c.md', 'docs/d.md', 'notes.txt', 'src/a.ts', 'styles/b.css'] },
      { label: 'ts', files: ['src/a.ts'] },
      { label: 'css', files: ['styles/b.css'] },
      { label: 'md', files: ['docs/c.md', 'docs/d.md'] },
      { label: 'md-once', files: [] },
    ]);
  });

  it('leaves deleted files out', () => {
    git('rm', '--quiet', 'base.txt');
    write('new.txt', 'new\n');
    git('add', 'new.txt');
    runStagedScript(config(`[{ name: 'all', match: () => true, commands: [{ label: 'x', run: ['node', STUB(log), 'all'] }] }]`));
    expect(calls()).toEqual([{ label: 'all', files: ['new.txt'] }]);
  });

  const FIXER = `[{ name: 'ts', match: (f) => f.endsWith('.ts'), commands: [{ label: 'Fixer', run: ['node', STUB(fix)], check: ['node', STUB(check)] }] }]`;

  it('re-adds fully staged files that a fixer changed', () => {
    write('a.ts', 'const a = 1;\n');
    git('add', 'a.ts');

    const result = runStagedScript(config(FIXER));

    expect(result.status).toBe(0);
    expect(calls()).toEqual([{ label: 'fix', files: ['a.ts'] }]);
    expect(read('a.ts')).toBe('const a = 1;\n// fixed\n');
    expect(indexContent('a.ts')).toBe('const a = 1;\n// fixed\n');
    expect(git('diff', '--name-only')).toBe('');
    expect(result.stdout).toContain('re-staged after Fixer: a.ts');
  });

  it('checks a partly staged file without rewriting it or its unstaged edit', () => {
    write('part.ts', 'one\n');
    git('add', 'part.ts');
    git('commit', '--quiet', '-m', 'part');
    write('part.ts', 'one\ntwo\n');
    git('add', 'part.ts');
    write('part.ts', 'one\ntwo\nunstaged three\n');
    write('full.ts', 'full\n');
    git('add', 'full.ts');

    const result = runStagedScript(config(FIXER));

    expect(result.status).toBe(0);
    expect(calls()).toEqual([
      { label: 'fix', files: ['full.ts'] },
      { label: 'check', files: ['part.ts'] },
    ]);
    expect(read('part.ts')).toBe('one\ntwo\nunstaged three\n');
    expect(indexContent('part.ts')).toBe('one\ntwo\n');
    expect(indexContent('full.ts')).toBe('full\n// fixed\n');
  });

  it('names the partly staged file when its check fails', () => {
    write('part.ts', 'one\n');
    git('add', 'part.ts');
    git('commit', '--quiet', '-m', 'part');
    write('part.ts', 'one\ntwo\n');
    git('add', 'part.ts');
    write('part.ts', 'one\ntwo\nBAD\n');

    const result = runStagedScript(config(FIXER));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Fixer (check) failed (exit code 2)');
    expect(result.stderr).toContain("git add -p part.ts");
    expect(read('part.ts')).toBe('one\ntwo\nBAD\n');
    expect(indexContent('part.ts')).toBe('one\ntwo\n');
  });

  it('passes file names with spaces and quotes through unchanged', () => {
    const names = ['dir with space/my file.ts', "it's.ts", ...(quotesAllowed ? ['say "hi".ts', 'tab\there.ts'] : [])];
    for (const name of names) write(name, 'x\n');
    git('add', '-A');

    const result = runStagedScript(config(FIXER));

    expect(result.status).toBe(0);
    const [call] = calls();
    expect([...call.files].sort()).toEqual([...names].sort());
    for (const name of names) {
      expect(indexContent(name)).toBe('x\n// fixed\n');
    }
  });

  it('splits long file lists into chunks under the length limit', () => {
    const names = Array.from({ length: 40 }, (_, index) => `some/longer/directory/file-${String(index).padStart(2, '0')}.txt`);
    for (const name of names) write(name, 'x\n');
    git('add', '-A');

    const result = runStagedScript(
      config(`[{ name: 'all', match: () => true, commands: [{ label: 'x', run: ['node', STUB(log), 'all'] }] }]`),
      ['--max-arg-length', '1000']
    );

    expect(result.status).toBe(0);
    const recorded = calls();
    expect(recorded.length).toBeGreaterThan(1);
    expect(recorded.flatMap((call) => call.files)).toEqual([...names].sort());
  });

  it('stops at the first failing command with a summary and a non-zero exit', () => {
    write('a.ts', 'a\n');
    git('add', 'a.ts');

    const result = runStagedScript(
      config(`[
        { name: 'all', match: () => true, commands: [
          { label: 'Always fails', run: ['node', STUB(fail)] },
          { label: 'Never runs', run: ['node', STUB(log), 'after'] },
        ] },
        { name: 'ts', match: (f) => f.endsWith('.ts'), commands: [{ label: 'x', run: ['node', STUB(log), 'ts'] }] },
      ]`)
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Always fails failed (exit code 3) in rule 'all'");
    expect(result.stderr).toContain('Files: a.ts');
    expect(calls()).toEqual([{ label: 'fail', files: ['a.ts'] }]);
  });

  it('fails clearly when a command package is not installed', () => {
    write('a.ts', 'a\n');
    git('add', 'a.ts');
    const result = runStagedScript(config(`[{ name: 'all', match: () => true, commands: [{ label: 'x', run: ['no-such-tool'] }] }]`));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot find the 'no-such-tool' package");
  });
});

describe('chunkFiles and splitNul', () => {
  it('keeps every chunk under the limit and the order intact', () => {
    const files = Array.from({ length: 50 }, (_, index) => `file-${index}.ts`);
    const chunks = chunkFiles(files, 40, 200);
    expect(chunks.flat()).toEqual(files);
    for (const chunk of chunks) {
      expect(40 + chunk.reduce((sum, file) => sum + file.length + 3, 0)).toBeLessThanOrEqual(200);
    }
  });

  it('gives an over-long name a chunk of its own', () => {
    expect(chunkFiles(['a', 'x'.repeat(500), 'b'], 10, 100)).toEqual([['a'], ['x'.repeat(500)], ['b']]);
  });

  it('splits NUL-separated output and drops the trailing empty entry', () => {
    expect(splitNul('a b\0c\nd\0')).toEqual(['a b', 'c\nd']);
    expect(splitNul('')).toEqual([]);
  });
});

describe('scripts/hooks/staged.config.js', () => {
  const commandsFor = (file: string) =>
    stagedRules.filter((rule) => rule.match(file)).flatMap((rule) => rule.commands.map((command) => command.run.join(' ')));

  it('runs the audits on every file, as before ADR 0044', () => {
    expect(commandsFor('assets/logo.png')).toEqual([
      'node scripts/secret-scanner.js',
      'node scripts/storage_privacy_ast_auditor.js',
      'node scripts/validate_ui_catalog.js',
      'node scripts/static-path-tracker.js',
      'node scripts/git_lineage_auditor.js',
    ]);
  });

  it.each(['a.js', 'a.jsx', 'a.ts', 'a.tsx', 'a.mjs', 'a.cjs'])('fixes %s with ESLint then Prettier', (file) => {
    expect(commandsFor(file).slice(5)).toEqual(['eslint --fix --no-warn-ignored', 'prettier --write']);
  });

  it.each(['a.css', 'a.json', 'a.yml', 'a.yaml'])('formats %s with Prettier', (file) => {
    expect(commandsFor(file).slice(5)).toEqual(['prettier --write']);
  });

  it('formats Markdown and runs the doc checks once', () => {
    const markdown = stagedRules.find((rule) => rule.match('docs/adr/0001-client-side-storage-allowlist.md') && rule.name === 'Markdown');
    expect(markdown?.commands.map((command) => [command.run.join(' '), command.files !== false])).toEqual([
      ['prettier --write', true],
      ['node scripts/audit_markdown.js', false],
      ['node scripts/validate_adrs.js', false],
    ]);
  });

  it('gives every fixer a read-only check form for partly staged files', () => {
    for (const command of stagedRules.flatMap((rule) => rule.commands)) {
      const fixes = command.run.some((arg) => arg === '--fix' || arg === '--write');
      expect(Boolean(command.check), command.label).toBe(fixes);
      if (command.check) expect(command.check.some((arg) => arg === '--fix' || arg === '--write')).toBe(false);
    }
  });
});
