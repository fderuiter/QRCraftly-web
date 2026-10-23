import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

// 1. Strict Allowed Production Dependencies List. Each addition needs its own ADR (ADR 0040, In-House First).
export const ALLOWED_DEPENDENCIES = new Set([
  'lucide-react',
  'react',
  'react-dom',
  'vike',
  'vike-react'
]);

// 2. Forbidden imports / patterns to detect bypasses
export const FORBIDDEN_IMPORTS = [
  'qram', 'axios', 'request', 'superagent', 'got', 'node-fetch', 'isomorphic-fetch', 'urllib', 'undici',
  'socket.io', 'socket.io-client', 'ws', 'graphql-request', 'apollo-client', 'mqtt',
  'mixpanel', 'amplitude', '@amplitude/analytics-browser', 'amplitude-js', 'sentry', '@sentry/browser',
  '@sentry/react', '@sentry/node', 'datadog', '@datadog/browser-logs', '@datadog/browser-rum',
  'google-analytics', 'react-ga', 'react-ga4', 'analytics-node', '@segment/analytics-next', 'loggly',
  'winston', 'bunyan', 'pino', 'http', 'https', 'net', 'dgram', 'dns', 'tls', 'http2'
];

// 3. Whitelisted files in src/ that are authorized to perform network requests (fetch)
export const AUTHORIZED_NETWORK_FILES = new Set([
  'src/packages/qr-export/lib/svgExport.ts',
  'src/packages/wasm-runtime/index.ts' // Same-origin GET of QRCraftly's own Rust WebAssembly modules (ADR 0033)
]);

/**
 * Determines whether a file or directory is a test file or in a dev/sandbox directory.
 */
export function isExcludedFile(filePath) {
  const relPath = path.isAbsolute(filePath)
    ? path.relative(repoRoot, filePath).replace(/\\/g, '/')
    : filePath.replace(/\\/g, '/');
  return (
    relPath.includes('node_modules') ||
    relPath.includes('.git') ||
    relPath.includes('dist') ||
    relPath.includes('coverage') ||
    relPath.startsWith('scripts/') ||
    relPath.startsWith('tests/') ||
    relPath.startsWith('e2e/') ||
    relPath.includes('dev-sandbox') ||
    relPath.endsWith('.test.ts') ||
    relPath.endsWith('.test.tsx') ||
    relPath.endsWith('.spec.ts') ||
    relPath.endsWith('.spec.tsx')
  );
}

/**
 * Audit package.json dependencies.
 */
export function auditPackageJson() {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ [Dependency Compliance] package.json not found.');
    return ['package.json not found'];
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const dependencies = packageJson.dependencies || {};
  const devDependencies = packageJson.devDependencies || {};
  const violations = [];

  for (const dep of Object.keys(dependencies)) {
    if (!ALLOWED_DEPENDENCIES.has(dep)) {
      violations.push(`Unauthorized production dependency detected in package.json: '${dep}'`);
    }
  }

  if (dependencies['qram'] || devDependencies['qram']) {
    violations.push(`Forbidden package 'qram' detected in package.json (both dependencies and devDependencies are prohibited).`);
  }

  return violations;
}

/**
 * Statically evaluates a string node expression (literals, template strings, string concatenation).
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
 * Scan a single file for forbidden imports or network patterns using TypeScript AST parsing.
 */
export function scanFileForCompliance(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return [];

  const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
  if (isExcludedFile(relativePath)) return [];

  const content = fs.readFileSync(absolutePath, 'utf8');
  let sourceFile;
  try {
    sourceFile = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true);
  } catch (_err) {
    return [];
  }

  const violations = [];

  function checkForbiddenImport(specifier, node) {
    if (!specifier) return;
    const lowerSpec = specifier.toLowerCase();
    for (const forbidden of FORBIDDEN_IMPORTS) {
      const lowerForbidden = forbidden.toLowerCase();
      if (lowerSpec === lowerForbidden || lowerSpec.startsWith(lowerForbidden + '/')) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          file: relativePath,
          line: line + 1,
          type: 'Forbidden Network/Server-Side Import',
          message: `Attempted to import or require '${forbidden}' which is forbidden to protect client-side boundaries.`
        });
        break;
      }
    }
  }

  function visit(node) {
    // 1. Static imports and exports
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) {
        const specifier = evaluateExpression(node.moduleSpecifier);
        checkForbiddenImport(specifier, node);
      }
    }
    // 2. Import equals declaration (e.g. import foo = require('bar'))
    if (ts.isImportEqualsDeclaration(node)) {
      if (node.moduleReference && ts.isExternalModuleReference(node.moduleReference)) {
        const specifier = evaluateExpression(node.moduleReference.expression);
        checkForbiddenImport(specifier, node);
      }
    }
    // 3. Call expressions: CommonJS require(...) and dynamic import(...)
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length > 0) {
          const specifier = evaluateExpression(node.arguments[0]);
          checkForbiddenImport(specifier, node);
        }
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        if (node.arguments.length > 0) {
          const specifier = evaluateExpression(node.arguments[0]);
          checkForbiddenImport(specifier, node);
        }
      }
    }

    // 4. Scan for network requests if not authorized
    if (!AUTHORIZED_NETWORK_FILES.has(relativePath)) {
      // fetch call or expression
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        let isFetchCall = false;
        if (ts.isIdentifier(expr) && expr.text === 'fetch') {
          isFetchCall = true;
        } else if (
          ts.isPropertyAccessExpression(expr) &&
          expr.name.text === 'fetch' &&
          ts.isIdentifier(expr.expression) &&
          ['window', 'globalThis', 'self'].includes(expr.expression.text)
        ) {
          isFetchCall = true;
        }
        if (isFetchCall) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            file: relativePath,
            line: line + 1,
            type: 'Unauthorized Network Call',
            message: `Unauthorized network call via 'fetch' in a non-whitelisted file. Client-side boundary violated.`
          });
        }
      }

      // XMLHttpRequest
      if (
        (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === 'XMLHttpRequest') ||
          (ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'XMLHttpRequest' &&
            ts.isIdentifier(node.expression.expression) &&
            ['window', 'globalThis', 'self'].includes(node.expression.expression.text)))
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          file: relativePath,
          line: line + 1,
          type: 'Unauthorized Network Call',
          message: `Unauthorized network call via 'XMLHttpRequest'. Client-side boundary violated.`
        });
      }

      // WebSocket
      if (
        (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === 'WebSocket') ||
          (ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'WebSocket' &&
            ts.isIdentifier(node.expression.expression) &&
            ['window', 'globalThis', 'self'].includes(node.expression.expression.text)))
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
        violations.push({
          file: relativePath,
          line: line + 1,
          type: 'Unauthorized Network Call',
          message: `Unauthorized network call via 'WebSocket'. Client-side boundary violated.`
        });
      }

      // navigator.sendBeacon
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (
          ts.isPropertyAccessExpression(expr) &&
          expr.name.text === 'sendBeacon' &&
          ((ts.isIdentifier(expr.expression) && expr.expression.text === 'navigator') ||
            (ts.isPropertyAccessExpression(expr.expression) &&
              expr.expression.name.text === 'navigator' &&
              ts.isIdentifier(expr.expression.expression) &&
              ['window', 'globalThis', 'self'].includes(expr.expression.expression.text)))
        ) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
          violations.push({
            file: relativePath,
            line: line + 1,
            type: 'Unauthorized Network Call',
            message: `Unauthorized network call via 'navigator.sendBeacon'. Client-side boundary violated.`
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

/**
 * Recursively find JS/TS files to audit under repoRoot.
 */
function findSourceFiles(dir = repoRoot) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (!isExcludedFile(relPath + '/') && !isExcludedFile(relPath)) {
        results = results.concat(findSourceFiles(fullPath));
      }
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) && !isExcludedFile(relPath)) {
      results.push(fullPath);
    }
  });
  return results;
}

export function runComplianceAudit() {
  console.log('[Dependency Compliance] Auditing production dependencies and network/client-side boundaries...');

  let packageViolations = [];
  try {
    packageViolations = auditPackageJson();
  } catch (err) {
    console.error('❌ [Dependency Compliance] Error auditing package.json:', err.message);
    packageViolations = [err.message];
  }

  const sourceFiles = findSourceFiles(repoRoot);
  let codeViolations = [];

  for (const file of sourceFiles) {
    try {
      const fileViolations = scanFileForCompliance(file);
      codeViolations = codeViolations.concat(fileViolations);
    } catch (err) {
      console.error(`❌ [Dependency Compliance] Error scanning file ${file}:`, err.message);
    }
  }

  const totalViolationsCount = packageViolations.length + codeViolations.length;

  if (totalViolationsCount > 0) {
    console.error(`\n❌ [DEPENDENCY COMPLIANCE FAILURE] Detected ${totalViolationsCount} compliance violation(s):\n`);

    packageViolations.forEach(v => {
      console.error(`📍 Location: package.json`);
      console.error(`⚠️  Violation: ${v}`);
      console.error('--------------------------------------------------\n');
    });

    codeViolations.forEach(v => {
      console.error(`📍 Location: ${v.file}:${v.line}`);
      console.error(`🏷️  Type:     ${v.type}`);
      console.error(`⚠️  Violation: ${v.message}`);
      console.error('--------------------------------------------------\n');
    });

    console.error('💡 How to resolve:');
    console.error('   1. Ensure all third-party libraries run strictly client-side.');
    console.error('   2. Do not introduce packages that trigger unauthorized network requests.');
    console.error('   3. Our own code comes first (docs/adr/0040-in-house-first.md). A new runtime dependency needs its own ADR');
    console.error('      (why our code cannot do it, size, licence, maintainers, network behaviour, patents, exit plan)');
    console.error('      before it joins ALLOWED_DEPENDENCIES.\n');

    process.exit(1);
  }

  console.log('✅ Dependency compliance check passed successfully. Client-side execution boundaries intact.');
  process.exit(0);
}

if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('dependency_compliance.js'))) {
  runComplianceAudit();
}
