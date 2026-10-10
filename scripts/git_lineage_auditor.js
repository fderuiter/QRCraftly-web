import { execBinary } from './utils/execHelper.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

export const MAPPING = {
  'src/packages/scannability/lib/sharedContract.ts': 'docs/public/SCALING.md',
  'src/components/InputPanel.tsx': 'src/components/inputs/README.md',
  'src/types.ts': ['docs/SECURITY.md', 'docs/public/COMPLIANCE.md', 'src/components/inputs/README.md'],
  'semgrep.yml': ['docs/SECURITY.md', 'docs/public/COMPLIANCE.md'],
  // colors.json holds the palette values behind the design tokens and QR presets; only the style guide documents them.
  'src/colors.json': 'docs/public/STYLE_GUIDE.md',
  'src/packages/scannability/worker.ts': 'docs/public/SCALING.md',
  'src/utils/security.ts': 'docs/SECURITY.md',
  '.github/rulesets/main.json': '.github/rulesets/README.md'
};

/**
 * Checks for missing documentation updates given a set of modified files.
 * @param {Set<string>} modifiedFiles 
 * @returns {Array<{codeFile: string, docFile: string}>} Array of missing documentation updates
 */
export function checkLineage(modifiedFiles) {
  const missingUpdates = [];
  
  for (const [codeFile, targets] of Object.entries(MAPPING)) {
    if (modifiedFiles.has(codeFile)) {
      const docFiles = Array.isArray(targets) ? targets : [targets];
      for (const docFile of docFiles) {
        if (!modifiedFiles.has(docFile)) {
          missingUpdates.push({ codeFile, docFile });
        }
      }
    }
  }
  return missingUpdates;
}

export function decodeGitPath(filePath) {
  // Strip enclosing double quotes if present
  if (filePath.startsWith('"') && filePath.endsWith('"')) {
    filePath = filePath.slice(1, -1);
  }

  // Decode backslash-escaped octal sequences and other escape sequences
  const bytes = [];
  let i = 0;
  while (i < filePath.length) {
    if (filePath[i] === '\\') {
      if (i + 1 < filePath.length) {
        const nextChar = filePath[i + 1];
        
        // Check for octal sequence: \[0-7]{1,3}
        if (/[0-7]/.test(nextChar)) {
          let octalStr = '';
          for (let j = 0; j < 3; j++) {
            if (i + 1 + j < filePath.length && /[0-7]/.test(filePath[i + 1 + j])) {
              octalStr += filePath[i + 1 + j];
            } else {
              break;
            }
          }
          
          const byteVal = parseInt(octalStr, 8);
          if (byteVal > 255) {
            // Bypass invalid octal sequence (leave as-is: push '\' and the digits)
            bytes.push('\\'.charCodeAt(0));
            for (let c = 0; c < octalStr.length; c++) {
              bytes.push(octalStr.charCodeAt(c));
            }
          } else {
            bytes.push(byteVal);
          }
          i += 1 + octalStr.length;
        } else {
          // Escaped control characters, quotes, or other characters
          if (nextChar === 'n') bytes.push(10);
          else if (nextChar === 't') bytes.push(9);
          else if (nextChar === 'r') bytes.push(13);
          else if (nextChar === 'b') bytes.push(8);
          else if (nextChar === 'f') bytes.push(12);
          else if (nextChar === 'v') bytes.push(11);
          else if (nextChar === 'a') bytes.push(7);
          else if (nextChar === '"' || nextChar === '\\' || nextChar === ' ' || nextChar === '/' || nextChar === '\'') {
            bytes.push(nextChar.charCodeAt(0));
          } else {
            // Unrecognized escape: keep the backslash and the character
            bytes.push('\\'.charCodeAt(0));
            bytes.push(nextChar.charCodeAt(0));
          }
          i += 2;
        }
      } else {
        // Trailing backslash
        bytes.push('\\'.charCodeAt(0));
        i += 1;
      }
    } else {
      bytes.push(filePath.charCodeAt(i));
      i += 1;
    }
  }

  let decoded;
  try {
    const uint8Array = new Uint8Array(bytes);
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(uint8Array);
  } catch {
    try {
      const uint8Array = new Uint8Array(bytes);
      decoded = new TextDecoder('utf-8', { fatal: false }).decode(uint8Array);
    } catch (_) {
      decoded = filePath;
    }
  }

  return decoded;
}

export function parseGitStatus(stdout) {
  const modifiedFiles = new Set();
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    if (line.length < 3) continue;
    let rawPath = line.substring(3).trim();

    if (rawPath.includes(' -> ')) {
      rawPath = rawPath.split(' -> ')[1].trim();
    }

    const decoded = decodeGitPath(rawPath);
    const normalized = decoded.replace(/\\/g, '/');
    modifiedFiles.add(normalized);
  }
  return modifiedFiles;
}

export function parseArgs(args) {
  const files = [];
  const positionalArgs = args.filter(arg => !arg.startsWith('-'));

  for (const arg of positionalArgs) {
    if (!arg || !arg.trim()) continue;

    const hasSpaceOrComma = /[\s,]/.test(arg);

    if (hasSpaceOrComma) {
      const normalized = arg.replace(/\\/g, '/');
      const isKey = Object.prototype.hasOwnProperty.call(MAPPING, normalized);
      const existsOnDisk = fs.existsSync(normalized) || fs.existsSync(path.join(repoRoot, normalized));

      if (isKey || existsOnDisk) {
        files.push(normalized);
        continue;
      }
    }

    const parts = arg.split(/[\s,]+/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) {
        files.push(trimmed.replace(/\\/g, '/'));
      }
    }
  }
  return files;
}

export function parseGitDiff(stdout) {
  const modifiedFiles = new Set();
  if (!stdout) return modifiedFiles;
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const decoded = decodeGitPath(trimmed);
    const normalized = decoded.replace(/\\/g, '/');
    modifiedFiles.add(normalized);
  }
  return modifiedFiles;
}

export function runAuditor(options = {}) {
  const env = options.env || process.env;
  const argv = options.argv || process.argv;
  const customExecSync = options.execSync || execBinary;
  const customExistsSync = options.existsSync || fs.existsSync;
  const exit = options.exit || process.exit;

  try {
    const isCloudflare = !!env.CF_PAGES || Object.keys(env).some(key => key.startsWith('CF_') || key.startsWith('CLOUDFLARE_'));
    const isGHA = !!env.GITHUB_ACTIONS || (!!env.CI && !isCloudflare && !env.SKIP_GIT_VALIDATION);
    const isOtherCI = !!env.CI && !isGHA;

    if (env.SKIP_GIT_VALIDATION || isOtherCI) {
      console.log('[Lineage Auditor] SKIP_GIT_VALIDATION or non-GHA CI environment detected. Skipping git lineage auditor check.');
      return;
    }

    const isCI = !!env.CI;
    let modifiedFiles = new Set();

    if (isCI) {
      console.log('[Lineage Auditor] CI environment detected. Resolving modified files via Git history...');
      
      const gitDir = path.join(repoRoot, '.git');
      if (!customExistsSync(gitDir)) {
        console.error('❌ [Lineage Auditor] Missing Git directory! Failed closed in CI environment.');
        exit(1);
        return;
      }

      let diffStdout = null;
      let targetBranch = 'origin/main';
      if (env.GITHUB_BASE_REF) {
        targetBranch = `origin/${env.GITHUB_BASE_REF}`;
      }

      console.log(`[Lineage Auditor] Attempting target branch comparison against: ${targetBranch}`);
      try {
        diffStdout = customExecSync('git', ['diff', '--name-only', `${targetBranch}...HEAD`], { encoding: 'utf8', cwd: repoRoot });
        console.log(`[Lineage Auditor] Successfully resolved files via target branch diff.`);
      } catch (err) {
        console.warn(`[Lineage Auditor] Initial target branch comparison failed, attempting to fetch and retry...`);
        const slashIndex = targetBranch.indexOf('/');
        if (slashIndex !== -1) {
          const remote = targetBranch.substring(0, slashIndex);
          const branch = targetBranch.substring(slashIndex + 1);
          console.log(`[Lineage Auditor] Fetching '${branch}' from remote '${remote}' to refs/remotes/${targetBranch}...`);
          try {
            customExecSync('git', ['fetch', remote, `${branch}:refs/remotes/${targetBranch}`], { encoding: 'utf8', cwd: repoRoot });
            console.log(`[Lineage Auditor] Successfully fetched target branch ref. Retrying diff...`);
            try {
              diffStdout = customExecSync('git', ['diff', '--name-only', `${targetBranch}...HEAD`], { encoding: 'utf8', cwd: repoRoot });
              console.log(`[Lineage Auditor] Successfully resolved files via target branch diff after fetch.`);
            } catch (diffErr) {
              console.warn(`[Lineage Auditor] Triple-dot diff failed: ${diffErr.message}. Falling back to double-dot diff...`);
              try {
                diffStdout = customExecSync('git', ['diff', '--name-only', `${targetBranch}..HEAD`], { encoding: 'utf8', cwd: repoRoot });
                console.log(`[Lineage Auditor] Successfully resolved files via double-dot diff.`);
              } catch (doubleDotErr) {
                console.warn(`[Lineage Auditor] Double-dot diff failed: ${doubleDotErr.message}. Falling back to direct diff...`);
                diffStdout = customExecSync('git', ['diff', '--name-only', targetBranch, 'HEAD'], { encoding: 'utf8', cwd: repoRoot });
                console.log(`[Lineage Auditor] Successfully resolved files via direct diff.`);
              }
            }
          } catch (retryErr) {
            console.error(`❌ [Lineage Auditor] Retry comparison failed: ${retryErr.message}`);
            console.error('❌ [Lineage Auditor] Failed closed in CI environment due to git comparison failure.');
            exit(1);
            return;
          }
        } else {
          console.error(`❌ [Lineage Auditor] Target branch comparison failed and could not parse remote: ${err.message}`);
          console.error('❌ [Lineage Auditor] Failed closed in CI environment due to git comparison failure.');
          exit(1);
          return;
        }
      }

      modifiedFiles = parseGitDiff(diffStdout);
    } else {
      // Local execution
      const args = argv.slice(2);
      const explicitFiles = parseArgs(args);

      if (explicitFiles.length > 0) {
        console.log(`[Lineage Auditor] Running check on ${explicitFiles.length} explicit file(s):`);
        explicitFiles.forEach(f => console.log(`  - ${f}`));
        modifiedFiles = new Set(explicitFiles);
      } else {
        console.log('[Lineage Auditor] No explicit file list provided. Falling back to local git status check...');
        if (!customExistsSync(path.join(repoRoot, '.git'))) {
          console.error('❌ [Lineage Auditor] Not a git repository or .git folder missing. Failed closed.');
          exit(1);
          return;
        }

        let stdout;
        try {
          stdout = customExecSync('git', ['status', '--porcelain'], { encoding: 'utf8', cwd: repoRoot });
        } catch (err) {
          console.error('❌ [Lineage Auditor] Failed to query git status. Failed closed.', err.message);
          exit(1);
          return;
        }

        const trimmed = stdout.trim();
        if (!trimmed) {
          console.log('[Lineage Auditor] No uncommitted local changes detected. Skipping lineage check.');
          return;
        }

        modifiedFiles = parseGitStatus(stdout);
      }
    }

    const missing = checkLineage(modifiedFiles);

    if (missing.length > 0) {
      console.error(`\n❌ [Lineage Auditor] Missing Documentation Update!`);
      for (const { codeFile, docFile } of missing) {
        console.error(`The core contract file '${codeFile}' was modified, but its mapped documentation guide '${docFile}' was not.`);
        console.error(`To resolve this block, please update: ${docFile}`);
      }
      console.error('');
      exit(1);
      return;
    } else {
      console.log('[Lineage Auditor] Lineage check passed successfully.');
    }
  } catch (error) {
    console.error('❌ [Lineage Auditor] Unexpected error during lineage check:', error.message || error);
    exit(1);
    return;
  }
}

// Only run automatically if executed directly
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('git_lineage_auditor.js'))) {
  runAuditor();
}
