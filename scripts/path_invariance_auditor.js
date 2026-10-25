import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { DEFAULT_EXCLUDE_DIRS, walkFiles } from './utils/sourceFiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

/** Directories the audit skips: the shared list (#1617). */
export const EXCLUDE_DIRS = [...DEFAULT_EXCLUDE_DIRS];

/** The extensions the audit reads. Code files are parsed; .json and .md are scanned by line. */
const SCANNED_EXTS = ['.js', '.ts', '.tsx', '.cjs', '.mjs', '.json', '.md'];

/**
 * The marker that allows one platform check or path string. Put it in a comment just before the
 * statement or expression that needs it (#1617).
 */
export const ALLOW_MARKER = 'path-invariance: allow';

/** This auditor's own test, whose fixtures are the paths and splits the audit looks for. */
const AUDITOR_TEST = 'tests/path_invariance_auditor.test.ts';

// Browser HTML5 file input values standardly return "C:\fakepath\filename"
export const ALLOWLISTED_FAKEMOCK_PATHS = [
  'C:\\fakepath\\',
  'C:\\\\fakepath\\\\',
  'fakepath',
  'MATMSG:TO:',
  'C:\\\\path\\\\to\\\\file',
  'C:\\path\\to\\file',
];

// Regex for detecting hardcoded Windows drives (e.g. C:\Users, D:/Project, file:///C:/...), not protocols like https://
const WINDOWS_DRIVE_REGEX = /(?:^|[\s"'`(=,[])(?:file:\/\/\/)?([a-zA-Z]:(?:\\+|\/+)[a-zA-Z0-9_.-]+(?:(?:\\+|\/+)[a-zA-Z0-9_.-]+)*)/;

// Regex for detecting hardcoded Unix/macOS user directories (e.g., /home/user, /Users/user)
const UNIX_USER_HOME_REGEX = /(?:^|[\s"'`(=,[])(?:\/(?:Users|home)\/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+)/;

// Regex for detecting raw split on \n without handling \r (.json and .md lines)
const RAW_NEWLINE_SPLIT_REGEX = /\.split\(\s*['"]\\n['"]\s*\)/;

// Regex for detecting ad-hoc process.platform branching (.json and .md lines)
const PLATFORM_CHECK_REGEX = /process\.platform\s*===?\s*['"][^'"]+['"]/;

const CODE_EXTS = { '.ts': ts.ScriptKind.TS, '.tsx': ts.ScriptKind.TSX, '.js': ts.ScriptKind.JS, '.cjs': ts.ScriptKind.JS, '.mjs': ts.ScriptKind.JS };

const MESSAGES = {
  split: `Detected fragile '.split(\\'\\\\n\\')'. Use '.split(/\\\\r?\\\\n/)' for cross-platform CRLF/LF resilience.`,
  platform: `Detected ad-hoc process.platform branching. Use centralized helpers in 'scripts/utils/execHelper.js' or 'tests/utils/execHelper.ts', or mark a check that must stay with a '// ${ALLOW_MARKER}' comment.`,
};

/**
 * Finds hardcoded host paths in one piece of text.
 * @param {string} text Line or string value.
 * @returns {string[]} Messages.
 */
function hostPathMessages(text) {
  if (ALLOWLISTED_FAKEMOCK_PATHS.some(mock => text.includes(mock))) return [];
  const messages = [];
  // Ignore common protocol matches (e.g. https://, http://, mailto:, ws://, wss://, git+https://)
  const clean = text.replace(/https?:\/\/[^\s"'`)]+/g, '').replace(/wss?:\/\/[^\s"'`)]+/g, '');
  const winMatch = clean.match(WINDOWS_DRIVE_REGEX);
  if (winMatch && !winMatch[1].includes('fakepath')) {
    messages.push(`Detected hardcoded Windows drive path '${winMatch[1]}'. Use relative paths with path.join or import.meta.url.`);
  }
  const unixMatch = text.match(UNIX_USER_HOME_REGEX);
  if (unixMatch) {
    messages.push(`Detected hardcoded user directory '${unixMatch[0].trim()}'. Use relative paths or dynamic environment configuration.`);
  }
  return messages;
}

/**
 * Whether the `.split('\n')` check applies to a file.
 * @param {string} file POSIX relative path.
 * @returns {boolean}
 */
const checksSplits = file =>
  file.startsWith('scripts/') || file.startsWith('tests/') || file.endsWith('.test.ts') || file.endsWith('.test.tsx');

/**
 * Whether a node, or a node it sits in up to its statement, carries the allow marker in a
 * comment just before it.
 * @param {import('typescript').Node} node
 * @param {string} text Source text.
 * @returns {boolean}
 */
function isAllowed(node, text) {
  for (let current = node; current && !ts.isSourceFile(current); current = current.parent) {
    const comments = ts.getLeadingCommentRanges(text, current.getFullStart()) ?? [];
    if (comments.some(range => text.slice(range.pos, range.end).includes(ALLOW_MARKER))) return true;
    if (ts.isStatement(current)) break;
  }
  return false;
}

/**
 * Whether an expression is `process.platform`.
 * @param {import('typescript').Expression} node
 * @returns {boolean}
 */
const isProcessPlatform = node =>
  ts.isPropertyAccessExpression(node) && node.name.text === 'platform' && ts.isIdentifier(node.expression) && node.expression.text === 'process';

const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken]);

/**
 * Scans a code file on its syntax tree: host paths in string values only (comments and URLs in
 * comments are never read), `.split('\n')` calls, and `process.platform` comparisons (#1617).
 * @param {string} content File contents.
 * @param {string} file POSIX relative path.
 * @param {import('typescript').ScriptKind} kind Script kind.
 * @returns {Array<{file: string, line: number, type: string, message: string}>}
 */
function scanCode(content, file, kind) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind);
  const findings = [];
  const isAuditorTest = file === AUDITOR_TEST;
  const lineOf = node => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const add = (node, type, message) => findings.push({ file, line: lineOf(node), type, message });

  const visit = node => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !isAuditorTest && !isAllowed(node, content)) {
      for (const message of hostPathMessages(node.text)) add(node, 'Hardcoded Absolute Host Path', message);
    } else if (ts.isCallExpression(node) && checksSplits(file) && !isAuditorTest) {
      const callee = node.expression;
      const [arg] = node.arguments;
      if (
        ts.isPropertyAccessExpression(callee) &&
        callee.name.text === 'split' &&
        node.arguments.length === 1 &&
        (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) &&
        arg.text === '\n'
      ) {
        add(node, 'Unhandled CRLF Line Splitting', MESSAGES.split);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      EQUALITY.has(node.operatorToken.kind) &&
      (isProcessPlatform(node.left) || isProcessPlatform(node.right)) &&
      !isAllowed(node, content)
    ) {
      add(node, 'Ad-Hoc Platform Branching', MESSAGES.platform);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

/**
 * Scans a .json or .md file line by line, as before #1617.
 * @param {string} content File contents.
 * @param {string} file POSIX relative path.
 * @returns {Array<{file: string, line: number, type: string, message: string}>}
 */
function scanLines(content, file) {
  const findings = [];
  content.split(/\r?\n/).forEach((line, index) => {
    const lineNumber = index + 1;
    if (!file.endsWith('.md')) {
      for (const message of hostPathMessages(line)) findings.push({ file, line: lineNumber, type: 'Hardcoded Absolute Host Path', message });
    }
    if (checksSplits(file) && RAW_NEWLINE_SPLIT_REGEX.test(line)) {
      findings.push({ file, line: lineNumber, type: 'Unhandled CRLF Line Splitting', message: MESSAGES.split });
    }
    if (PLATFORM_CHECK_REGEX.test(line)) {
      findings.push({ file, line: lineNumber, type: 'Ad-Hoc Platform Branching', message: MESSAGES.platform });
    }
  });
  return findings;
}

/**
 * Scans string content of a file for path invariance issues.
 *
 * @param {string} content - Raw content of the file
 * @param {string} relativePath - POSIX relative path of the file
 * @returns {Array<{file: string, line: number, type: string, message: string}>}
 */
export function scanContentForPathInvariants(content, relativePath) {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  const kind = CODE_EXTS[path.extname(normalizedPath).toLowerCase()];
  return kind === undefined ? scanLines(content, normalizedPath) : scanCode(content, normalizedPath, kind);
}

/**
 * Scans a single file on disk for path invariance violations.
 *
 * @param {string} filePath - Path to file
 * @returns {Array<object>}
 */
export function scanFileForPathInvariants(filePath) {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');

  if (EXCLUDE_DIRS.some(d => relativePath.split('/').includes(d))) {
    return [];
  }

  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  try {
    const stats = fs.statSync(absolutePath);
    if (!stats.isFile()) return [];
  } catch (_e) {
    return [];
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  return scanContentForPathInvariants(content, relativePath);
}

/**
 * Main path invariance audit runner.
 */
export function runPathInvarianceAudit() {
  console.log('\n=== [Path Invariance & Platform Agnosticism Audit] Scanning Repository ===');
  const startTime = Date.now();

  const candidateDirs = ['src', 'scripts', 'tests', 'functions'];
  let filesToScan = [];

  for (const d of candidateDirs) {
    const dirPath = path.join(repoRoot, d);
    filesToScan = filesToScan.concat(walkFiles(dirPath, { exts: SCANNED_EXTS, excludeDirs: EXCLUDE_DIRS }));
  }

  // Root files
  const rootFiles = ['package.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts'];
  for (const f of rootFiles) {
    const full = path.join(repoRoot, f);
    if (fs.existsSync(full)) {
      filesToScan.push(full);
    }
  }

  let allFindings = [];
  for (const filePath of filesToScan) {
    try {
      const findings = scanFileForPathInvariants(filePath);
      allFindings = allFindings.concat(findings);
    } catch (_e) {
      // Ignore read errors
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  if (allFindings.length > 0) {
    console.error(`\n❌ [PATH INVARIANCE AUDIT FAILURE] Detected ${allFindings.length} platform invariance violation(s) in ${duration}s:\n`);

    allFindings.forEach(f => {
      console.error(`📍 Location: ${f.file}:${f.line}`);
      console.error(`🏷️  Type:     ${f.type}`);
      console.error(`💡 Message:  ${f.message}`);
      console.error('--------------------------------------------------\n');
    });

    console.error('💡 How to resolve:');
    console.error('   1. Avoid hardcoded OS drive letters or user home directories.');
    console.error('   2. Use .split(/\\r?\\n/) instead of .split(\'\\n\') in scripts and tests.');
    console.error('   3. Use execHelper utilities for cross-platform child process calls.\n');

    process.exit(1);
  }

  console.log(`✅ Path invariance & platform agnosticism audit passed successfully in ${duration}s. No violations found.\n`);
  process.exit(0);
}

if (process.argv[1]) {
  const realScriptPath = fs.realpathSync(fileURLToPath(import.meta.url));
  const realExecutedPath = fs.realpathSync(process.argv[1]);
  if (realScriptPath === realExecutedPath) {
    runPathInvarianceAudit();
  }
}
