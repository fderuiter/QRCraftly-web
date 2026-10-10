import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { rules, type Edge } from '../../scripts/boundaries.config.js';
import { buildGraph, checkBoundaries, checkGraph, findCycles, formatViolations, toPosix } from '../../scripts/check_boundaries.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'boundaries', 'fixtures');

const RULE_NAMES = [
  'entrypoint-boundary-from-app',
  'entrypoint-boundary-across-packages',
  'tests-through-entrypoints',
  'tests-folder-is-private',
  'no-circular',
  'packages-must-not-import-app-layers',
  'cross-package-imports-use-alias',
  'page-content-stays-on-server',
];

/** A runtime (value) import edge, relative unless `aliased` is set. */
function edge(from: string, to: string, extra: Partial<Edge> = {}): Edge {
  return { from, to, line: 1, specifier: to, aliased: false, typeOnly: false, dynamic: false, ...extra };
}

/** True when the named rule forbids the edge. */
function forbidden(name: string, e: Edge): boolean {
  const rule = rules.find((r) => r.name === name);
  if (!rule) throw new Error(`Missing boundary rule ${name}`);
  if ('circular' in rule) throw new Error(`${name} is a graph rule`);
  return rule.forbids(e);
}

const forbiddenByAppLayerRules = (from: string, to: string) =>
  forbidden('packages-must-not-import-app-layers', edge(from, to));

describe('boundary rules', () => {
  it('keeps every rule, each with a comment and a Fix hint, and no known-violation exemptions', () => {
    expect(rules.map((r) => r.name)).toEqual(RULE_NAMES);
    for (const rule of rules) {
      expect(rule.comment.length).toBeGreaterThan(20);
      expect(rule.fix.length).toBeGreaterThan(10);
    }
    expect(rules.some((r) => r.name.includes('known-violations'))).toBe(false);
  });

  it.each([
    'src/context/QRContext.tsx',
    'src/hooks/useCapabilities.ts',
    'src/components/QRTool.tsx',
    'src/pages/index/+Page.tsx',
    'src/registry.tsx',
  ])('forbids packages from importing the app layer %s', (target) => {
    expect(forbiddenByAppLayerRules('src/packages/scannability/lib/evaluator.ts', target)).toBe(true);
    expect(forbiddenByAppLayerRules('src/packages/scannability/client.ts', target)).toBe(true);
  });

  it('still lets packages import shared utilities, types and other packages', () => {
    const from = 'src/packages/scannability/lib/checker.ts';
    expect(forbiddenByAppLayerRules(from, 'src/utils/security.ts')).toBe(false);
    expect(forbiddenByAppLayerRules(from, 'src/types.ts')).toBe(false);
    expect(forbiddenByAppLayerRules(from, 'src/packages/qr-payload/index.ts')).toBe(false);
  });

  it('does not constrain app code importing app layers', () => {
    expect(forbiddenByAppLayerRules('src/hooks/useScannability.ts', 'src/context/QRContext.tsx')).toBe(false);
  });

  it('forbids optical-transfer from importing the app layers it used to reach into (#980)', () => {
    for (const target of ['src/hooks/useCamera.ts', 'src/context/QRContext.tsx', 'src/components/QRTool.tsx']) {
      expect(forbiddenByAppLayerRules('src/packages/optical-transfer/client.ts', target)).toBe(true);
      expect(forbiddenByAppLayerRules('src/packages/optical-transfer/lib/receiver/useOpticalReceiver.ts', target)).toBe(true);
    }
  });

  describe('cross-package-imports-use-alias', () => {
    const from = 'src/packages/optical-transfer/lib/handshake.ts';
    const forbids = (to: string, aliased: boolean) => forbidden('cross-package-imports-use-alias', edge(from, to, { aliased }));

    it('forbids a relative import into another package, even of its entry point', () => {
      expect(forbids('src/packages/qr-matrix/index.ts', false)).toBe(true);
      expect(forbids('src/packages/scannability/worker.ts', false)).toBe(true);
    });

    it('allows the @/packages alias to another package', () => {
      expect(forbids('src/packages/qr-matrix/index.ts', true)).toBe(false);
    });

    it("allows relative imports inside the package's own files", () => {
      expect(forbids('src/packages/optical-transfer/lib/framePool.ts', false)).toBe(false);
    });

    it('does not constrain app code outside the packages', () => {
      expect(
        forbidden('cross-package-imports-use-alias', edge('src/pages/file-transfer/+Page.tsx', 'src/packages/optical-transfer/client.ts')),
      ).toBe(false);
    });
  });

  it("forbids a package from deep-importing another package's lib/", () => {
    const from = 'src/packages/arcade/lib/scanPipeline.ts';
    const forbids = (to: string) => forbidden('entrypoint-boundary-across-packages', edge(from, to, { aliased: true }));
    expect(forbids('src/packages/scannability/lib/checker.ts')).toBe(true);
    expect(forbids('src/packages/scannability/index.ts')).toBe(false);
    expect(forbids('src/packages/arcade/lib/matrix.ts')).toBe(false);
  });

  it('lets package tests import their own fixtures but no internals', () => {
    const from = 'src/packages/arcade/tests/damage.test.ts';
    const forbids = (to: string) => forbidden('tests-through-entrypoints', edge(from, to));
    expect(forbids('src/packages/arcade/tests/fixtures.ts')).toBe(false);
    expect(forbids('src/packages/arcade/index.ts')).toBe(false);
    expect(forbids('src/packages/arcade/lib/matrix.ts')).toBe(true);
    expect(forbids('src/packages/qr-matrix/lib/encoder.ts')).toBe(true);
  });

  it('allows type-only imports of page content from browser code, but not value imports', () => {
    const from = 'src/components/QRTool.tsx';
    const to = 'src/data/contentRegistry.ts';
    expect(forbidden('page-content-stays-on-server', edge(from, to))).toBe(true);
    expect(forbidden('page-content-stays-on-server', edge(from, to, { typeOnly: true }))).toBe(false);
    expect(forbidden('page-content-stays-on-server', edge('src/layouts/Head.tsx', to))).toBe(false);
    expect(forbidden('page-content-stays-on-server', edge('src/components/QRTool.test.tsx', to))).toBe(false);
  });
});

describe('check_boundaries fixtures', () => {
  it.each(RULE_NAMES)('flags the %s fixture under that rule and nothing else', (name) => {
    const { violations } = checkBoundaries({ rootDir: path.join(FIXTURES, name) });
    expect(violations.map((v) => v.rule)).toEqual([name]);
    expect(violations[0].line).toBeGreaterThan(0);
  });

  it('prints file:line, the rule, its comment and a Fix: hint', () => {
    const { violations } = checkBoundaries({ rootDir: path.join(FIXTURES, 'entrypoint-boundary-from-app') });
    const text = formatViolations(violations);
    expect(text).toContain('src/app.ts:2  entrypoint-boundary-from-app');
    expect(text).toContain('imports src/packages/alpha/lib/impl.ts');
    expect(text).toContain("but nothing inside its subfolders");
    expect(text).toContain('Fix: ');
  });

  it('prints the path of a 3-file cycle', () => {
    const { violations } = checkBoundaries({ rootDir: path.join(FIXTURES, 'no-circular') });
    expect(violations[0].cycle).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/a.ts']);
    expect(formatViolations(violations)).toContain('cycle: src/a.ts -> src/b.ts -> src/c.ts -> src/a.ts');
  });

  describe('graph', () => {
    const graph = buildGraph({ rootDir: path.join(FIXTURES, 'graph') });
    const from = (file: string) => graph.edges.filter((e) => e.from === file);

    it('records a type-only import as a type-only edge', () => {
      const shapes = from('src/main.ts').find((e) => e.to === 'src/shapes.ts');
      expect(shapes).toMatchObject({ typeOnly: true, dynamic: false, line: 1 });
    });

    it('records a dynamic import()', () => {
      expect(from('src/main.ts').find((e) => e.to === 'src/lazy.ts')).toMatchObject({ dynamic: true, typeOnly: false, line: 5 });
    });

    it('resolves an alias and a relative path to the same file, and marks only the alias as aliased', () => {
      const util = from('src/main.ts').filter((e) => e.to === 'src/util.ts');
      expect(util.map((e) => [e.specifier, e.aliased])).toEqual([
        ['@/util', true],
        ['./util', false],
      ]);
    });

    it('does not count a cycle that runs through a type-only import', () => {
      expect(graph.edges.some((e) => e.from === 'src/shapes.ts' && e.to === 'src/main.ts' && e.typeOnly)).toBe(true);
      expect(checkGraph(graph)).toEqual([]);
    });

    it('normalises Windows-style input paths to POSIX', () => {
      expect(toPosix('src\\packages\\alpha\\index.ts')).toBe('src/packages/alpha/index.ts');
      const windows = buildGraph({ rootDir: path.join(FIXTURES, 'graph'), entries: ['src\\main.ts'], tsconfig: '.\\tsconfig.json' });
      expect(windows.modules).toEqual(['src/lazy.ts', 'src/main.ts', 'src/shapes.ts', 'src/util.ts']);
      for (const e of windows.edges) {
        expect(e.from).not.toContain('\\');
        expect(e.to).not.toContain('\\');
      }
    });
  });

  it('finds a self-import as a cycle and ignores acyclic graphs', () => {
    const successors = new Map([
      ['a', ['a']],
      ['b', ['c']],
    ]);
    expect(findCycles(['a', 'b', 'c'], successors)).toEqual([['a']]);
  });
});
