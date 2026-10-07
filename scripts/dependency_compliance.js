import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
  'src/components/inputs/LocationInput.tsx', // Address geocoding via OpenStreetMap Nominatim API
  'src/packages/qr-export/lib/svgExport.ts',
  'src/packages/wasm-runtime/index.ts' // Same-origin GET of QRCraftly's own Rust WebAssembly modules (ADR 0033)
]);

/**
 * Determines whether a file is a test file or in a dev/sandbox directory.
 */
function isExcludedFile(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized.includes('node_modules') ||
    normalized.includes('.git') ||
    normalized.includes('dist') ||
    normalized.includes('coverage') ||
    normalized.startsWith('scripts/') ||
    normalized.startsWith('tests/') ||
    normalized.startsWith('e2e/') ||
    normalized.includes('dev-sandbox') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.test.tsx') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.spec.tsx')
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
 * Scan a single file for forbidden imports or network patterns.
 */
export function scanFileForCompliance(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return [];

  const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
  if (isExcludedFile(relativePath)) return [];

  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations = [];

  // 1. Scan for forbidden imports (ES imports or CommonJS requires)
  FORBIDDEN_IMPORTS.forEach(forbidden => {
    const importRegex = new RegExp(`from\\s+['"]${forbidden}['"]|require\\s*\\(\\s*['"]${forbidden}['"]\\)`, 'i');
    lines.forEach((line, index) => {
      if (importRegex.test(line)) {
        violations.push({
          file: relativePath,
          line: index + 1,
          type: 'Forbidden Network/Server-Side Import',
          message: `Attempted to import or require '${forbidden}' which is forbidden to protect client-side boundaries.`
        });
      }
    });
  });

  // 2. Scan for network requests if not authorized
  const hasFetch = content.includes('fetch(') || content.includes('fetch ');
  const hasXhr = content.includes('XMLHttpRequest');
  const hasWebSocket = content.includes('WebSocket(') || content.includes('new WebSocket');
  const hasSendBeacon = content.includes('sendBeacon(');

  if (!AUTHORIZED_NETWORK_FILES.has(relativePath)) {
    if (hasFetch) {
      lines.forEach((line, index) => {
        if ((line.includes('fetch(') || line.includes('fetch ')) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
          violations.push({
            file: relativePath,
            line: index + 1,
            type: 'Unauthorized Network Call',
            message: `Unauthorized network call via 'fetch' in a non-whitelisted file. Client-side boundary violated.`
          });
        }
      });
    }

    if (hasXhr) {
      lines.forEach((line, index) => {
        if (line.includes('XMLHttpRequest') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
          violations.push({
            file: relativePath,
            line: index + 1,
            type: 'Unauthorized Network Call',
            message: `Unauthorized network call via 'XMLHttpRequest'. Client-side boundary violated.`
          });
        }
      });
    }

    if (hasWebSocket) {
      lines.forEach((line, index) => {
        if ((line.includes('WebSocket(') || line.includes('new WebSocket')) && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
          violations.push({
            file: relativePath,
            line: index + 1,
            type: 'Unauthorized Network Call',
            message: `Unauthorized network call via 'WebSocket'. Client-side boundary violated.`
          });
        }
      });
    }

    if (hasSendBeacon) {
      lines.forEach((line, index) => {
        if (line.includes('sendBeacon(') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
          violations.push({
            file: relativePath,
            line: index + 1,
            type: 'Unauthorized Network Call',
            message: `Unauthorized network call via 'navigator.sendBeacon'. Client-side boundary violated.`
          });
        }
      });
    }
  }

  return violations;
}

/**
 * Recursively find files to audit under src/
 */
function findSourceFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(findSourceFiles(fullPath));
    } else if (file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')) {
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

  const srcDir = path.join(repoRoot, 'src');
  const sourceFiles = findSourceFiles(srcDir);
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
