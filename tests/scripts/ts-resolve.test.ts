import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execBinary } from '../utils/execHelper';
import { resolve } from '../../scripts/utils/ts-resolve.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registerUrl = pathToFileURL(path.join(repoRoot, 'scripts/utils/register-ts.js')).href;

let dir: string;

/** Writes a fixture file, creating its folders. */
function put(relative: string, content: string): void {
  const file = path.join(dir, ...relative.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

/** Runs a fixture entry under plain Node with the resolve hook, returning stdout. */
function runNode(entry: string): string {
  return execBinary(process.execPath, ['--import', registerUrl, path.join(dir, entry)], { cwd: dir, stdio: 'pipe' });
}

/** Runs a fixture entry and returns the error output Node exits with. */
function failNode(entry: string): string {
  try {
    runNode(entry);
  } catch (error) {
    return String((error as { stderr?: unknown }).stderr ?? error);
  }
  throw new Error(`${entry} ran without an error`);
}

describe('scripts/utils/ts-resolve.js (ADR 0045)', () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ts-resolve-'));
    put('package.json', '{ "type": "module" }\n');
    put('lib/helper.ts', "export const helper: string = 'helper.ts';\n");
    put('pkg/index.ts', "export const pkg: string = 'pkg/index.ts';\n");
    put('plain.js', "export const plain = 'plain.js';\n");
    put('both.ts', "export const both: string = 'both.ts';\n");
    put('both.js', "export const both = 'both.js';\n");
    put('jsdir/index.js', "export const jsdir = 'jsdir/index.js';\n");
    put(
      'main.ts',
      [
        "import { helper } from './lib/helper';",
        "import { pkg } from './pkg';",
        "import { plain } from './plain';",
        "import { both } from './both';",
        "import { jsdir } from './jsdir';",
        "import { type Kind } from './lib/kinds';",
        "import path from 'node:path';",
        "const kind: Kind = 'ok';",
        'console.log([helper, pkg, plain, both, jsdir, kind, typeof path.join].join(","));',
        '',
      ].join('\n'),
    );
    put('lib/kinds.ts', "export type Kind = 'ok' | 'no';\n");
    // A local file named like a package must not satisfy a bare import of that package.
    put('left-pad-local.ts', "export const x = 'local';\n");
    put('bare.ts', "import 'left-pad-local';\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs extensionless .ts, index.ts and .js imports under plain Node', () => {
    expect(runNode('main.ts').trim()).toBe('helper.ts,pkg/index.ts,plain.js,both.ts,jsdir/index.js,ok,function');
  }, 30000);

  it('leaves bare package specifiers to Node', () => {
    expect(failNode('bare.ts')).toMatch(/Cannot find package 'left-pad-local'|ERR_MODULE_NOT_FOUND/);
  }, 30000);

  it('prefers .ts over .js and passes through anything it does not own', () => {
    const parentURL = pathToFileURL(path.join(dir, 'main.ts')).href;
    const next = (specifier: string) => ({ url: `next:${specifier}` });
    expect(resolve('./both', { parentURL }, next).url).toBe(pathToFileURL(path.join(dir, 'both.ts')).href);
    expect(resolve('./plain', { parentURL }, next).url).toBe(pathToFileURL(path.join(dir, 'plain.js')).href);
    expect(resolve('./plain.js', { parentURL }, next).url).toBe(pathToFileURL(path.join(dir, 'plain.js')).href);
    expect(resolve('./missing', { parentURL }, next).url).toBe('next:./missing');
    expect(resolve('vite', { parentURL }, next).url).toBe('next:vite');
    expect(resolve('node:fs', { parentURL }, next).url).toBe('next:node:fs');
  });

  it('maps the @/ alias to src/', () => {
    const next = (specifier: string) => ({ url: `next:${specifier}` });
    expect(resolve('@/types', {}, next).url).toBe(pathToFileURL(path.join(repoRoot, 'src', 'types.ts')).href);
  });
});
