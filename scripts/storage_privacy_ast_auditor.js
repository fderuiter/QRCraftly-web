import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
// typescript ships as CJS without an `exports` field; use createRequire so the
// CJS resolver can find it even when pnpm hoists it to a parent node_modules.
const ts = require('typescript');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

// Approved storage keys allowed in client-side persistent storage operations
export const ALLOWED_STORAGE_KEYS = new Set([
  'qrcraftly:theme',
  'qrcraftly:brand-templates',
  '__test__'
]);

// Banned persistent storage APIs when accessed directly or via window
const BANNED_STORAGE_APIS = new Set([
  'sessionStorage',
  'indexedDB',
  'cookie',
  'document.cookie',
  'caches'
]);

const EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage'];
const EXCLUDE_FILES = [
  'scripts/storage_privacy_ast_auditor.js',
  'tests/storage_privacy_ast_auditor.test.ts'
];

/**
 * Checks whether a file should be excluded from scanning.
 */
export function isExcludedFile(filePath) {
  const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, '/');
  if (EXCLUDE_FILES.includes(relativePath)) return true;
  if (EXCLUDE_DIRS.some(d => relativePath.split('/').includes(d))) return true;
  if (
    relativePath.endsWith('.test.ts') ||
    relativePath.endsWith('.test.tsx') ||
    relativePath.endsWith('.spec.ts') ||
    relativePath.endsWith('.spec.tsx') ||
    relativePath.startsWith('tests/') ||
    relativePath.startsWith('e2e/')
  ) {
    return true;
  }
  if (!relativePath.endsWith('.ts') && !relativePath.endsWith('.tsx') && !relativePath.endsWith('.js') && !relativePath.endsWith('.jsx')) {
    return true;
  }
  return false;
}

/**
 * Statically evaluates a string node expression.
 */
export function evaluateExpression(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = evaluateExpression(node.left);
    const right = evaluateExpression(node.right);
    if (left !== null && right !== null) {
      return left + right;
    }
  }
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      const expr = evaluateExpression(span.expression);
      if (expr === null) return null;
      text += expr + span.literal.text;
    }
    return text;
  }
  return null;
}

/**
 * Helper to check if an expression node refers to localStorage.
 */
function isLocalStorageObject(node) {
  if (!node) return false;
  if (ts.isIdentifier(node) && node.text === 'localStorage') return true;
  if (ts.isPropertyAccessExpression(node)) {
    if (node.name.text === 'localStorage') return true;
  }
  return false;
}

/**
 * Audit a single source file for unauthorized browser storage calls.
 */
export function auditStorageFile(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return [];

  const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
  if (isExcludedFile(absolutePath)) return [];

  const content = fs.readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    relativePath,
    content,
    ts.ScriptTarget.Latest,
    true
  );

  const violations = [];

  function addViolation(node, type, message, key = null) {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    violations.push({
      file: relativePath,
      line: line + 1,
      character: character + 1,
      type,
      message,
      key,
      text: node.getText(sourceFile)
    });
  }

  function visit(node) {
    // 1. Check for banned APIs like sessionStorage, indexedDB, document.cookie, caches
    if (ts.isIdentifier(node)) {
      const name = node.text;
      if (BANNED_STORAGE_APIS.has(name)) {
        const parent = node.parent;
        const isPropertyAccessName = ts.isPropertyAccessExpression(parent) && parent.name === node && parent.expression !== node;
        const isPropertyAssignmentName = ts.isPropertyAssignment(parent) && parent.name === node;
        const isTypeReference = ts.isTypeReferenceNode(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent);
        const isImportSpecifier = ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent);

        if (!isPropertyAccessName && !isPropertyAssignmentName && !isTypeReference && !isImportSpecifier) {
          addViolation(
            node,
            'Unauthorized Persistent Storage API Call',
            `Use of banned storage API '${name}'. Transient QR payload and persistent application data must conform to privacy boundaries.`
          );
        }
      }
    }

    // 2. Check for property access on document.cookie or window.sessionStorage etc.
    if (ts.isPropertyAccessExpression(node)) {
      const propName = node.name.text;
      if (propName === 'cookie') {
        const objText = node.expression.getText(sourceFile);
        if (objText === 'document' || objText === 'window.document') {
          addViolation(
            node,
            'Unauthorized Cookie Storage Call',
            `Direct access to document.cookie is prohibited. Zero-transit privacy policy mandates volatile in-memory storage.`
          );
        }
      }
    }

    // 3. Check for localStorage method calls (getItem, setItem, removeItem, clear) or property/element access
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      let method = null;
      let targetObj = null;

      if (ts.isPropertyAccessExpression(expr)) {
        method = expr.name.text;
        targetObj = expr.expression;
      }

      if (method && ['getItem', 'setItem', 'removeItem', 'clear'].includes(method)) {
        if (isLocalStorageObject(targetObj)) {
          if (method === 'clear') {
            // clear() has no key argument
          } else if (node.arguments.length > 0) {
            const keyArg = node.arguments[0];
            const evaluatedStorageKey = evaluateExpression(keyArg);

            if (evaluatedStorageKey === null) {
              addViolation(
                node,
                'Unresolvable Dynamic Storage Key',
                `Storage call '${method}' uses an unresolvable or dynamic storage key. All persistent storage keys must be statically allowlisted.`
              );
            } else if (!ALLOWED_STORAGE_KEYS.has(evaluatedStorageKey)) {
              addViolation(
                node,
                'Unauthorized Persistent Storage Key',
                `Storage call '${method}' uses unauthorized key '${evaluatedStorageKey}'. Sensitive QR payload data must remain in volatile runtime memory.`,
                evaluatedStorageKey
              );
            }
          }
        }
      }
    }

    // 4. Check for direct element access on localStorage (e.g., localStorage['unapproved_key'])
    if (ts.isElementAccessExpression(node)) {
      if (isLocalStorageObject(node.expression)) {
        const arg = node.argumentExpression;
        const evaluatedStorageKey = evaluateExpression(arg);

        if (evaluatedStorageKey === null) {
          addViolation(
            node,
            'Unresolvable Dynamic Storage Key',
            `Element access on localStorage uses an unresolvable dynamic key. All persistent storage keys must be statically allowlisted.`
          );
        } else if (!ALLOWED_STORAGE_KEYS.has(evaluatedStorageKey)) {
          addViolation(
            node,
            'Unauthorized Persistent Storage Key',
            `Element access on localStorage uses unauthorized key '${evaluatedStorageKey}'.`,
            evaluatedStorageKey
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

/**
 * Main execution routine.
 */
export function runStorageAudit() {
  console.log('\n=== [Pre-Build Storage Privacy AST Auditor] Scanning Source Code ===');
  console.time('Storage Audit Duration');

  let filesToScan = [];
  if (process.argv.length > 2) {
    filesToScan = process.argv.slice(2).map(f => path.resolve(f));
  } else {
    const walk = (dir) => {
      let results = [];
      const list = fs.readdirSync(dir);
      list.forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
        if (EXCLUDE_DIRS.some(d => relPath.split('/').includes(d))) return;
        if (stat && stat.isDirectory()) {
          results = results.concat(walk(fullPath));
        } else {
          results.push(fullPath);
        }
      });
      return results;
    };

    try {
      filesToScan = walk(path.join(repoRoot, 'src'));
    } catch (err) {
      console.error('❌ [Pre-Build Storage Privacy AST Auditor] Error scanning directory:', err.message);
      process.exit(1);
    }
  }

  let allViolations = [];
  for (const file of filesToScan) {
    try {
      const violations = auditStorageFile(file);
      allViolations = allViolations.concat(violations);
    } catch (err) {
      console.error(`❌ Error scanning file ${file}:`, err.message);
    }
  }

  console.timeEnd('Storage Audit Duration');

  if (allViolations.length > 0) {
    console.error(`\n❌ [STORAGE PRIVACY AST AUDIT FAILURE] Detected ${allViolations.length} unauthorized persistent storage violation(s):\n`);

    allViolations.forEach(v => {
      console.error(`📍 Location:  ${v.file}:${v.line}:${v.character}`);
      console.error(`🏷️  Type:      ${v.type}`);
      if (v.key) console.error(`🔑 Key:       ${v.key}`);
      console.error(`⚠️  Message:   ${v.message}`);
      console.error(`💻 Code:      ${v.text}`);
      console.error('--------------------------------------------------\n');
    });

    console.error('💡 How to resolve:');
    console.error('   1. Ensure QR payload data remains exclusively in volatile memory (React state / closure).');
    console.error('   2. Do not use unapproved storage keys with localStorage or persistent browser storage.');
    console.error('   3. If adding an application setting, add the approved key to ALLOWED_STORAGE_KEYS in scripts/storage_privacy_ast_auditor.js.\n');

    process.exit(1);
  }

  console.log('✅ Pre-build storage privacy AST audit passed successfully! No unauthorized storage calls found.\n');
  process.exit(0);
}

if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('storage_privacy_ast_auditor.js'))) {
  runStorageAudit();
}
