import fs from 'fs';
import path from 'path';
import { execBinary } from './utils/execHelper.js';
import { fileURLToPath } from 'url';

// Excluded files or directories
export const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
];

export const EXCLUDE_FILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'scripts/secret-scanner.js',
  'tests/secret-scanner.test.ts',
  '.gitleaks.toml',
];

export const BINARY_EXTENSIONS = /\.(png|jpg|jpeg|gif|ico|woff|woff2|eot|ttf|otf|mp4|webm|zip|tar\.gz|pdf|svg|exe|dll|so|dylib)$/i;

// Regex patterns for standard high-risk credentials
// 1. SMTP Connection Strings (with password)
export const SMTP_URI_REGEX = /smtps?:\/\/[^:]+:([^@\s]+)@[^\s/]+/i;

// 2. SMTP Password / Keys assignment
export const SMTP_PASS_REGEX = /(smtp|mail|email|password|pass)[_-]?(password|pass|secret|key|token)?\s*[:=]\s*['"]?([a-zA-Z0-9_.@-]{4,})['"]?/i;

// 3. Cloudflare API Key or Token assignment
export const CLOUDFLARE_REGEX = /(cloudflare|cf|api|token|key|secret)[_-]?(api)?[_-]?(token|key|secret)?\s*[:=]\s*['"]?([a-zA-Z0-9_@-]{16,})['"]?/i;

// 4. AWS Access Key ID
export const AWS_REGEX = /\b((?:AKIA|ASCA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16})\b/i;

// 5. Stripe API Key
export const STRIPE_REGEX = /\b((?:sk|rk)_(?:live|test)_[a-zA-Z0-9]{24,})\b/i;

// 6. GitHub Personal Access Token
export const GITHUB_REGEX = /\b(gh[pousr]_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/i;

// 7. Google Cloud or Firebase API Key
export const GCP_REGEX = /\b(AIzaSy[a-zA-Z0-9_-]{33})\b/i;

// Helper to check if a value is a false positive
export function isFalsePositive(secret, varName = '') {
  if (!secret) return true;

  const lowerSecret = secret.toLowerCase();
  const lowerVar = varName.toLowerCase();

  // Environment variables or system references
  if (secret.startsWith('$') || secret.includes('${') || secret.includes('process.env') || secret.includes('import.meta')) {
    return true;
  }

  const codePrefixes = [
    'parsed.',
    'result.',
    'data.',
    'e.',
    'config.',
    'state.',
    'props.',
    'this.',
    'window.',
    'document.',
    'process.',
    'import.',
    'unescape',
    'parse',
  ];
  if (codePrefixes.some(pref => lowerSecret.startsWith(pref))) {
    return true;
  }

  // Code keywords, types, or event handling constructs
  const codeConstructs = [
    'string',
    'boolean',
    'number',
    'undefined',
    'null',
    'true',
    'false',
    'any',
    'unknown',
    'never',
    'void',
    'object',
    'e.target.value',
    'e.target.checked',
    'e.target.id',
    'e.currenttarget.value',
    'unspecified',
  ];
  if (codeConstructs.includes(lowerSecret)) {
    return true;
  }

  if (lowerSecret.includes('e.target') || lowerSecret.includes('target.value') || lowerSecret.includes('target.checked')) {
    return true;
  }

  const commonWords = ['password', 'pass', 'secret', 'ignore', 'test', 'dummy', 'none', 'value'];
  if (commonWords.includes(lowerSecret)) {
    return true;
  }

  // Standard safe placeholders or identical to variable name
  const placeholders = [
    'placeholder',
    'your-',
    'your_',
    '<your',
    'your-token',
    'your-password',
    'example',
    'dummy_value',
    'dummy-value',
    'dummy',
    'test@',
    'user@',
    'john@',
    'john.doe',
    'mailtrap',
    'nopass',
  ];

  if (placeholders.some(p => lowerSecret.includes(p))) {
    return true;
  }

  const keywords = new Set([
    'undefined',
    'null',
    'true',
    'false',
    'string',
    'boolean',
    'number',
    'any',
    'void',
    'pass',
    'nopass',
    'password',
    'mypassword',
    'secret',
    'ignore',
    'john',
    'test',
    'http',
    'https',
    'email',
  ]);

  if (keywords.has(lowerSecret)) {
    return true;
  }

  const codeSubstrings = [
    'target',
    'value',
    'params',
    'input',
    'element',
    'unexpected',
    'field',
    'unescape',
    'escape',
    'parsed',
    'path',
    'parse',
    'format',
    'action',
    'event',
    'expression',
    'evaluate',
    'eval',
    'resolve',
    'setup',
    'wizard',
  ];

  if (codeSubstrings.some(s => lowerSecret.includes(s))) {
    return true;
  }

  // If secret value is identical/similar to the variable name (e.g. SMTP_PASSWORD = "SMTP_PASSWORD")
  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (lowerVar && normalize(secret) === normalize(varName)) {
    return true;
  }

  // Check common code structures, TypeScript definitions, function calls, or common non-secret keywords
  const codeIdentifiers = [
    'true',
    'false',
    'null',
    'undefined',
    'string',
    'number',
    'boolean',
    'any',
    'unknown',
    'void',
    'nopass',
    'param',
    'value',
    'data',
    'result',
    'unencrypted',
    'ignore',
    'pass',
    'password',
    'email',
    'secret',
    'token',
    'key',
    'path',
    'error',
    'err',
  ];

  if (
    codeIdentifiers.includes(lowerSecret) ||
    lowerSecret.startsWith('e.target') ||
    lowerSecret.startsWith('target.') ||
    lowerSecret.startsWith('this.') ||
    lowerSecret.startsWith('data.') ||
    lowerSecret.startsWith('result.') ||
    lowerSecret.startsWith('unescape') ||
    lowerSecret.startsWith('split')
  ) {
    return true;
  }

  // Extremely short values or simple quotes
  if (secret.trim().length < 4) {
    return true;
  }

  return false;
}

// Function to scan a single file
export function scanFile(filePath) {
  const absolutePath = path.resolve(filePath);
  
  // Quick checks to ignore
  if (BINARY_EXTENSIONS.test(filePath)) return [];
  
  const relativePath = path.relative(process.cwd(), absolutePath);
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (
    (/\.(test|spec)\.[jt]sx?$/i.test(normalizedPath) ||
    normalizedPath.includes('temp-test-')) &&
    !normalizedPath.includes('temp-test-secret.ts')
  ) {
    return [];
  }

  if (EXCLUDE_FILES.some(f => relativePath === f || normalizedPath === f)) {
    return [];
  }
  if (EXCLUDE_DIRS.some(d => relativePath.startsWith(d) || normalizedPath.split('/').includes(d))) {
    return [];
  }

  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  try {
    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) return [];
  } catch {
    return [];
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const findings = [];

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    // Check SMTP URI
    const smtpUriMatch = line.match(SMTP_URI_REGEX);
    if (smtpUriMatch) {
      const secret = smtpUriMatch[1];
      if (!isFalsePositive(secret)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          type: 'SMTP URI Connection String',
          match: smtpUriMatch[0],
          secret: secret,
        });
      }
    }

    // Check SMTP password/key assignment
    const smtpPassMatch = line.match(SMTP_PASS_REGEX);
    if (smtpPassMatch) {
      const varName = smtpPassMatch[1] + (smtpPassMatch[2] ? '_' + smtpPassMatch[2] : '');
      const secret = smtpPassMatch[3];
      if (!isFalsePositive(secret, varName)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          type: 'SMTP Password/Credential Assignment',
          match: smtpPassMatch[0],
          secret: secret,
        });
      }
    }

    // Check Cloudflare secrets
    const cfMatch = line.match(CLOUDFLARE_REGEX);
    if (cfMatch) {
      const varName = [cfMatch[1], cfMatch[2], cfMatch[3]].filter(Boolean).join('_');
      const secret = cfMatch[4];
      if (!isFalsePositive(secret, varName)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          type: 'Cloudflare API Secret/Token',
          match: cfMatch[0],
          secret: secret,
        });
      }
    }

    // Check AWS Keys
    const awsMatch = line.match(AWS_REGEX);
    if (awsMatch) {
      const secret = awsMatch[1];
      if (!isFalsePositive(secret)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          type: 'AWS Access Key ID',
          match: awsMatch[0],
          secret: secret,
        });
      }
    }

    // Check Stripe Keys
    const stripeMatch = line.match(STRIPE_REGEX);
    if (stripeMatch) {
      const secret = stripeMatch[1];
      if (!isFalsePositive(secret)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          type: 'Stripe API Key',
          match: stripeMatch[0],
          secret: secret,
        });
      }
    }

    // Check GitHub Tokens
    const githubMatch = line.match(GITHUB_REGEX);
    if (githubMatch) {
      const secret = githubMatch[1];
      if (!isFalsePositive(secret)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          type: 'GitHub Personal Access Token',
          match: githubMatch[0],
          secret: secret,
        });
      }
    }

    // Check GCP API Keys
    const gcpMatch = line.match(GCP_REGEX);
    if (gcpMatch) {
      const secret = gcpMatch[1];
      if (!isFalsePositive(secret)) {
        findings.push({
          file: relativePath,
          line: lineNumber,
          type: 'Google Cloud or Firebase API Key',
          match: gcpMatch[0],
          secret: secret,
        });
      }
    }
  });

  return findings;
}

// Main execution block
function main() {
  const startTime = Date.now();
  let filesToScan = [];

  // Parse files passed via environment variable or command line (e.g. from CI or lint-staged)
  if (process.env.ALL_CHANGED_FILES) {
    const raw = process.env.ALL_CHANGED_FILES.trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      try {
        filesToScan = JSON.parse(raw);
      } catch (_e) {
        filesToScan = raw.split(/\s+/).filter(Boolean);
      }
    } else {
      filesToScan = raw.split(/\s+/).filter(Boolean);
    }
  } else if (process.argv.length > 2) {
    filesToScan = process.argv.slice(2);
  } else {
    // No arguments, list files tracked by git
    try {
      const gitFiles = execBinary('git', ['ls-files'], { stdio: ['pipe', 'pipe', 'ignore'] })
        .split(/\r?\n/)
        .filter(Boolean);
      filesToScan = gitFiles;
    } catch {
      // Fallback: search directory recursively if not in a git repo
      console.warn('⚠️  Could not run git ls-files. Falling back to simple file scan.');
      function walk(dir) {
        let results = [];
        const list = fs.readdirSync(dir);
        list.forEach(file => {
          const fullPath = path.join(dir, file);
          const stat = fs.statSync(fullPath);
          const relPath = path.relative(process.cwd(), fullPath);
          const segments = relPath.replace(/\\/g, '/').split('/');
          if (EXCLUDE_DIRS.some(d => segments.includes(d))) return;
          if (stat && stat.isDirectory()) {
            results = results.concat(walk(fullPath));
          } else {
            results.push(relPath);
          }
        });
        return results;
      }
      try {
        filesToScan = walk(process.cwd());
      } catch (walkErr) {
        console.error('Error walking directory:', walkErr);
        process.exit(1);
      }
    }
  }

  // Execute scan
  let allFindings = [];
  filesToScan.forEach(filePath => {
    try {
      const findings = scanFile(filePath);
      allFindings = allFindings.concat(findings);
    } catch {
      // Ignore reading errors of individual files (e.g. deleted files or directories)
    }
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  if (allFindings.length > 0) {
    console.error(`\n❌  [SECRET SCANNER FAILURE] Detected ${allFindings.length} plain-text credential(s) in ${duration}s:\n`);
    
    allFindings.forEach(f => {
      const maskedSecret = f.secret.substring(0, Math.min(3, f.secret.length)) + '... [REDACTED]';
      console.error(`📍 Location: ${f.file}:${f.line}`);
      console.error(`🏷️  Type:     ${f.type}`);
      console.error(`🔒 Match:    ${f.match.replace(f.secret, maskedSecret)}`);
      console.error('--------------------------------------------------\n');
    });

    console.error(`💡 How to resolve:`);
    console.error(`   Do NOT commit raw credential secrets into the codebase.`);
    console.error(`   Please use environment variables (e.g., process.env.CLOUDFLARE_API_TOKEN)`);
    console.error(`   and configure them locally in a '.env' file or via deployment platforms.`);
    console.error(`   If you made a mistake, reset your staged files and remove the raw secret.\n`);
    
    process.exit(1);
  }

  console.log(`✅ Secret scan completed successfully in ${duration}s. No secrets found.`);
  process.exit(0);
}

if (process.argv[1]) {
  const realScriptPath = fs.realpathSync(fileURLToPath(import.meta.url));
  const realExecutedPath = fs.realpathSync(process.argv[1]);
  if (realScriptPath === realExecutedPath) {
    main();
  }
}
