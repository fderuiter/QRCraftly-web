// @ts-check
// Package-boundary checker (#1196). Builds the import graph of src/ with the
// TypeScript compiler and checks it against the deep-module rules in
// scripts/boundaries.config.js (see src/packages/README.md).
//
// - Imports come from `ts.preProcessFile`: static imports, `export … from`,
//   dynamic `import()` and `require()`.
// - Each import is resolved with `ts.resolveModuleName` and our tsconfig.json,
//   so the `@/` alias and extensions resolve exactly as `tsc` sees them.
//   Imports that resolve into node_modules (bare packages) are ignored.
// - Files reached outside the scanned folders (for example tests/utils/) are
//   followed too, as long as they are not in node_modules.
// - Type-only imports count as edges; rules that allow them check `edge.typeOnly`
//   (page-content-stays-on-server, and no-circular through its `follows`).
//
// Usage: node scripts/check_boundaries.js [--json] [dir ...]   (default dir: src)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { rules as defaultRules } from './boundaries.config.js';

/** @typedef {import('./boundaries.config.js').Edge} Edge */
/** @typedef {import('./boundaries.config.js').Rule} Rule */

/**
 * @typedef {object} Violation
 * @property {string} rule
 * @property {string} comment
 * @property {string} fix
 * @property {string} from
 * @property {string} to
 * @property {number} line
 * @property {string[]} [cycle] For no-circular: the files of one cycle, first file repeated at the end.
 */

/**
 * @typedef {object} Graph
 * @property {string[]} modules POSIX paths relative to the root, sorted.
 * @property {Edge[]} edges
 */

const __filename = fileURLToPath(import.meta.url);

/** Extensions of files whose imports are read. */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

/**
 * Turns a path with either separator into a POSIX path.
 * @param {string} p
 * @returns {string}
 */
export function toPosix(p) {
  return p.replace(/\\/g, '/');
}

/**
 * Reads tsconfig.json from the root the way `tsc` does.
 * @param {string} rootDir
 * @param {string} tsconfigPath
 * @returns {ts.CompilerOptions}
 */
function readCompilerOptions(rootDir, tsconfigPath) {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n'));
  }
  return ts.parseJsonConfigFileContent(configFile.config, ts.sys, rootDir).options;
}

/**
 * Lists source files below a folder.
 * @param {string} absDir
 * @returns {string[]} Absolute paths.
 */
function listSourceFiles(absDir) {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (SOURCE_FILE.test(entry.name)) out.push(child);
    }
  };
  walk(absDir);
  return out;
}

/**
 * Builds a matcher for specifiers that go through a tsconfig `paths` alias.
 * @param {ts.CompilerOptions} options
 * @returns {(specifier: string) => boolean}
 */
function aliasMatcher(options) {
  const patterns = Object.keys(options.paths ?? {}).map((key) => {
    const star = key.indexOf('*');
    return star === -1
      ? (/** @type {string} */ s) => s === key
      : (/** @type {string} */ s) =>
          s.length >= key.length - 1 && s.startsWith(key.slice(0, star)) && s.endsWith(key.slice(star + 1));
  });
  return (specifier) => patterns.some((matches) => matches(specifier));
}

/**
 * Classifies the imports of one file by the position of their specifier text:
 * which are type-only and which are dynamic (`import()` / `require()`).
 * @param {ts.SourceFile} sourceFile
 * @returns {Map<number, { typeOnly: boolean, dynamic: boolean }>}
 */
function classifyImports(sourceFile) {
  /** @type {Map<number, { typeOnly: boolean, dynamic: boolean }>} */
  const kinds = new Map();
  const record = (/** @type {ts.Node} */ literal, /** @type {boolean} */ typeOnly, /** @type {boolean} */ dynamic) => {
    // preProcessFile reports the position of the opening quote.
    kinds.set(literal.getStart(sourceFile), { typeOnly, dynamic });
  };
  const allTypeSpecifiers = (/** @type {readonly { isTypeOnly: boolean }[]} */ elements) =>
    elements.length > 0 && elements.every((element) => element.isTypeOnly);

  /** @param {ts.Node} node */
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const named = clause?.namedBindings;
      const typeOnly =
        clause !== undefined &&
        (clause.isTypeOnly ||
          (clause.name === undefined &&
            named !== undefined &&
            ts.isNamedImports(named) &&
            allTypeSpecifiers(named.elements)));
      record(node.moduleSpecifier, typeOnly, false);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const clause = node.exportClause;
      const typeOnly =
        node.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && allTypeSpecifiers(clause.elements));
      record(node.moduleSpecifier, typeOnly, false);
    } else if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) record(argument.literal, true, false);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      record(node.arguments[0], false, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return kinds;
}

/**
 * Resolves one specifier. Falls back to the literal file on disk for files
 * TypeScript does not resolve itself (`.css`, `.json`, `?raw` suffixes).
 * @param {string} specifier
 * @param {string} containingFile Absolute path.
 * @param {ts.CompilerOptions} options
 * @param {ts.ModuleResolutionCache} cache
 * @param {(specifier: string) => boolean} isAliased
 * @returns {string | null} Absolute path of a local file, or null for packages and unresolved imports.
 */
function resolveImport(specifier, containingFile, options, cache, isAliased) {
  const { resolvedModule } = ts.resolveModuleName(specifier, containingFile, options, ts.sys, cache);
  if (resolvedModule) {
    if (resolvedModule.isExternalLibraryImport) return null;
    return path.resolve(resolvedModule.resolvedFileName);
  }
  const bare = specifier.replace(/[?#].*$/, '');
  /** @type {string | null} */
  let candidate = null;
  if (bare.startsWith('.') || bare.startsWith('/')) {
    candidate = path.resolve(path.dirname(containingFile), bare);
  } else if (isAliased(bare) && options.paths) {
    for (const [key, targets] of Object.entries(options.paths)) {
      const prefix = key.replace(/\*$/, '');
      if (!bare.startsWith(prefix) || targets.length === 0) continue;
      const base = options.pathsBasePath ?? options.baseUrl ?? '.';
      // tsconfig allows one `*` per target; a function keeps `$` in the specifier literal.
      const rest = bare.slice(prefix.length);
      candidate = path.resolve(String(base), targets[0].replaceAll('*', () => rest));
      break;
    }
  }
  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  return null;
}

/**
 * Builds the import graph.
 * @param {object} [options]
 * @param {string} [options.rootDir] Folder paths are reported relative to (default: the working directory).
 * @param {string[]} [options.entries] Folders or files to scan, relative to the root (default: `['src']`). Either separator works.
 * @param {string} [options.tsconfig] tsconfig.json path, relative to the root (default: `tsconfig.json`).
 * @returns {Graph}
 */
export function buildGraph({ rootDir = process.cwd(), entries = ['src'], tsconfig = 'tsconfig.json' } = {}) {
  const root = path.resolve(toPosix(rootDir));
  const compilerOptions = readCompilerOptions(root, path.join(root, toPosix(tsconfig)));
  const cache = ts.createModuleResolutionCache(root, (name) => name, compilerOptions);
  const isAliased = aliasMatcher(compilerOptions);
  const relative = (/** @type {string} */ abs) => toPosix(path.relative(root, abs));

  /** @type {string[]} */
  const queue = [];
  for (const entry of entries) {
    const abs = path.resolve(root, toPosix(entry));
    if (fs.statSync(abs).isDirectory()) queue.push(...listSourceFiles(abs));
    else queue.push(abs);
  }

  /** @type {Set<string>} */
  const modules = new Set();
  /** @type {Edge[]} */
  const edges = [];
  while (queue.length > 0) {
    const abs = /** @type {string} */ (queue.shift());
    const from = relative(abs);
    if (modules.has(from)) continue;
    modules.add(from);
    if (!SOURCE_FILE.test(abs)) continue;

    const text = fs.readFileSync(abs, 'utf8');
    const kind = /\.[cm]?jsx?$/.test(abs) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX;
    const sourceFile = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, kind);
    const kinds = classifyImports(sourceFile);
    for (const imported of ts.preProcessFile(text, true, true).importedFiles) {
      const target = resolveImport(imported.fileName, abs, compilerOptions, cache, isAliased);
      if (target === null || target.split(path.sep).includes('node_modules')) continue;
      const to = relative(target);
      edges.push({
        from,
        to,
        line: sourceFile.getLineAndCharacterOfPosition(imported.pos).line + 1,
        specifier: imported.fileName,
        aliased: isAliased(imported.fileName),
        typeOnly: kinds.get(imported.pos)?.typeOnly ?? false,
        dynamic: kinds.get(imported.pos)?.dynamic ?? false,
      });
      if (!modules.has(to)) queue.push(target);
    }
  }
  return { modules: [...modules].sort(), edges };
}

/**
 * Tarjan's strongly connected components algorithm, iterative so deep graphs cannot overflow the stack.
 * @param {string[]} nodes
 * @param {Map<string, string[]>} successors
 * @returns {string[][]} Components with a cycle: two or more nodes, or one node that imports itself.
 */
export function findCycles(nodes, successors) {
  let next = 0;
  /** @type {Map<string, number>} */
  const index = new Map();
  /** @type {Map<string, number>} */
  const low = new Map();
  /** @type {string[]} */
  const stack = [];
  /** @type {Set<string>} */
  const onStack = new Set();
  /** @type {string[][]} */
  const components = [];

  for (const start of nodes) {
    if (index.has(start)) continue;
    /** @type {{ node: string, children: string[], i: number }[]} */
    const work = [];
    const open = (/** @type {string} */ node) => {
      index.set(node, next);
      low.set(node, next);
      next++;
      stack.push(node);
      onStack.add(node);
      work.push({ node, children: successors.get(node) ?? [], i: 0 });
    };
    open(start);
    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (frame.i < frame.children.length) {
        const child = frame.children[frame.i++];
        if (!index.has(child)) open(child);
        else if (onStack.has(child)) low.set(frame.node, Math.min(Number(low.get(frame.node)), Number(index.get(child))));
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(Number(low.get(parent)), Number(low.get(frame.node))));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        /** @type {string[]} */
        const component = [];
        let member;
        do {
          member = /** @type {string} */ (stack.pop());
          onStack.delete(member);
          component.push(member);
        } while (member !== frame.node);
        const selfLoop = component.length === 1 && (successors.get(frame.node) ?? []).includes(frame.node);
        if (component.length > 1 || selfLoop) components.push(component.sort());
      }
    }
  }
  return components;
}

/**
 * One concrete cycle through a strongly connected component, shortest from its first file.
 * @param {string[]} component Sorted members.
 * @param {Map<string, string[]>} successors
 * @returns {string[]} The cycle's files, with the first file repeated at the end.
 */
function cyclePath(component, successors) {
  const members = new Set(component);
  const start = component[0];
  /** @type {Map<string, string>} */
  const previous = new Map();
  const queue = [start];
  while (queue.length > 0) {
    const node = /** @type {string} */ (queue.shift());
    for (const child of successors.get(node) ?? []) {
      if (!members.has(child)) continue;
      if (child === start) {
        const pathBack = [start];
        for (let at = node; at !== start; at = /** @type {string} */ (previous.get(at))) pathBack.push(at);
        pathBack.push(start);
        return pathBack.reverse();
      }
      if (!previous.has(child)) {
        previous.set(child, node);
        queue.push(child);
      }
    }
  }
  return [start, start];
}

/**
 * Checks a graph against the rules.
 * @param {Graph} graph
 * @param {Rule[]} [rules]
 * @returns {Violation[]}
 */
export function checkGraph(graph, rules = defaultRules) {
  /** @type {Violation[]} */
  const violations = [];
  for (const rule of rules) {
    if ('circular' in rule) {
      /** @type {Map<string, string[]>} */
      const successors = new Map();
      const followed = graph.edges.filter(rule.follows);
      for (const edge of followed) {
        const list = successors.get(edge.from) ?? [];
        if (!list.includes(edge.to)) list.push(edge.to);
        successors.set(edge.from, list);
      }
      for (const component of findCycles(graph.modules, successors)) {
        const cycle = cyclePath(component, successors);
        const first = followed.find((edge) => edge.from === cycle[0] && edge.to === cycle[1]);
        violations.push({
          rule: rule.name,
          comment: rule.comment,
          fix: rule.fix,
          from: cycle[0],
          to: cycle[1],
          line: first?.line ?? 1,
          cycle,
        });
      }
      continue;
    }
    for (const edge of graph.edges) {
      if (rule.forbids(edge)) {
        violations.push({ rule: rule.name, comment: rule.comment, fix: rule.fix, from: edge.from, to: edge.to, line: edge.line });
      }
    }
  }
  return violations.sort((a, b) => a.from.localeCompare(b.from) || a.line - b.line || a.rule.localeCompare(b.rule));
}

/**
 * Builds the graph and checks it.
 * @param {Parameters<typeof buildGraph>[0] & { rules?: Rule[] }} [options]
 * @returns {{ graph: Graph, violations: Violation[] }}
 */
export function checkBoundaries(options = {}) {
  const graph = buildGraph(options);
  return { graph, violations: checkGraph(graph, options.rules) };
}

/**
 * Formats violations for people.
 * @param {Violation[]} violations
 * @returns {string}
 */
export function formatViolations(violations) {
  return violations
    .map((v) => {
      const what = v.cycle ? `cycle: ${v.cycle.join(' -> ')}` : `imports ${v.to}`;
      return `${v.from}:${v.line}  ${v.rule}\n    ${what}\n    ${v.comment}\n    Fix: ${v.fix}`;
    })
    .join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const entries = args.filter((arg) => !arg.startsWith('--'));
  const { graph, violations } = checkBoundaries({ entries: entries.length > 0 ? entries : ['src'] });
  if (json) {
    const summary = { modules: graph.modules.length, dependencies: graph.edges.length, violations: violations.length };
    console.log(JSON.stringify({ summary, violations }, null, 2));
  } else if (violations.length > 0) {
    console.error(formatViolations(violations));
    console.error(
      `\n❌ ${violations.length} package boundary violation(s) (${graph.modules.length} modules, ${graph.edges.length} dependencies checked). See src/packages/README.md.`,
    );
  } else {
    console.log(
      `✅ No package boundary violations (${graph.modules.length} modules, ${graph.edges.length} dependencies checked).`,
    );
  }
  if (violations.length > 0) process.exit(1);
}
