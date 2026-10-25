import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { checkLineage, parseGitStatus, MAPPING, parseArgs, runAuditor, parseGitDiff } from '../scripts/git_lineage_auditor.js';

describe('Local Git-Diff Lineage Auditor', () => {
  it('should maintain the correct core mappings', () => {
    expect(MAPPING).toHaveProperty('src/packages/scannability/lib/sharedContract.ts', 'docs/public/SCALING.md');
    expect(MAPPING).toHaveProperty('src/components/InputPanel.tsx', 'src/components/inputs/README.md');
  });

  it('should parse git status --porcelain correctly', () => {
    const mockStdout = ` M src/packages/scannability/lib/sharedContract.ts\n?? some/new/file.ts\n R old_file.ts -> src/components/InputPanel.tsx`;
    const parsed = parseGitStatus(mockStdout);
    
    expect(parsed.has('src/packages/scannability/lib/sharedContract.ts')).toBe(true);
    expect(parsed.has('some/new/file.ts')).toBe(true);
    expect(parsed.has('src/components/InputPanel.tsx')).toBe(true);
    expect(parsed.has('old_file.ts')).toBe(false);
  });

  it('should parse git status --porcelain correctly with octal escape sequences, quotes, and spaces', () => {
    // 1. Octal escapes decoding (like \303\251 -> é)
    const mockStdoutOctal = ` M "src/utils/sh\\303\\251.ts"`;
    const parsedOctal = parseGitStatus(mockStdoutOctal);
    expect(parsedOctal.has('src/utils/shé.ts')).toBe(true);

    // 2. Spaces wrapped in quotes
    const mockStdoutSpaces = `?? "src/components/my file.tsx"`;
    const parsedSpaces = parseGitStatus(mockStdoutSpaces);
    expect(parsedSpaces.has('src/components/my file.tsx')).toBe(true);

    // 3. Renamed file with quotes and non-ASCII character and spaces
    const mockStdoutRename = ` R  "old file.ts" -> "src/components/my file \\303\\251.tsx"`;
    const parsedRename = parseGitStatus(mockStdoutRename);
    expect(parsedRename.has('src/components/my file é.tsx')).toBe(true);

    // 4. Invalid/out-of-range octal sequence should be bypassed gracefully without crashing
    const mockStdoutInvalidOctal = ` M "src/utils/invalid_\\777_seq.ts"`;
    const parsedInvalidOctal = parseGitStatus(mockStdoutInvalidOctal);
    expect(parsedInvalidOctal.has('src/utils/invalid_/777_seq.ts')).toBe(true);
  });

  it('should fail validation when a mapped contract is modified without its paired doc', () => {
    const modifiedFiles = new Set(['src/packages/scannability/lib/sharedContract.ts', 'src/constants.ts']);
    const missing = checkLineage(modifiedFiles);
    
    expect(missing).toHaveLength(1);
    expect(missing[0]).toEqual({
      codeFile: 'src/packages/scannability/lib/sharedContract.ts',
      docFile: 'docs/public/SCALING.md'
    });
  });

  it('should pass validation when a mapped contract is modified with its paired doc', () => {
    const modifiedFiles = new Set(['src/packages/scannability/lib/sharedContract.ts', 'docs/public/SCALING.md']);
    const missing = checkLineage(modifiedFiles);
    
    expect(missing).toHaveLength(0);
  });

  it('should pass validation when no mapped contracts are modified', () => {
    const modifiedFiles = new Set(['src/constants.ts', 'src/components/inputs/TextInput.tsx']);
    const missing = checkLineage(modifiedFiles);
    
    expect(missing).toHaveLength(0);
  });

  describe('Multi-target validation specifications', () => {
    it('should maintain the correct multi-target mappings', () => {
      expect(MAPPING).toHaveProperty('src/types.ts');
      expect(MAPPING['src/types.ts']).toEqual([
        'docs/SECURITY.md',
        'docs/public/COMPLIANCE.md',
        'src/components/inputs/README.md'
      ]);

      expect(MAPPING).toHaveProperty('semgrep.yml');
      expect(MAPPING['semgrep.yml']).toEqual([
        'docs/SECURITY.md',
        'docs/public/COMPLIANCE.md'
      ]);

      expect(MAPPING).toHaveProperty('src/colors.json');
      expect(MAPPING['src/colors.json']).toBe('docs/public/STYLE_GUIDE.md');
    });

    it('should fail multi-target validation when some/all targets are missing for a core schema', () => {
      const modifiedFiles = new Set([
        'src/types.ts',
        'docs/SECURITY.md'
      ]);
      const missing = checkLineage(modifiedFiles);
      
      expect(missing).toContainEqual({
        codeFile: 'src/types.ts',
        docFile: 'docs/public/COMPLIANCE.md'
      });
      expect(missing).toContainEqual({
        codeFile: 'src/types.ts',
        docFile: 'src/components/inputs/README.md'
      });
      expect(missing).not.toContainEqual({
        codeFile: 'src/types.ts',
        docFile: 'docs/SECURITY.md'
      });
    });

    it('should pass multi-target validation when all targets are present for core schemas', () => {
      const modifiedFiles = new Set([
        'src/types.ts',
        'docs/SECURITY.md',
        'docs/public/COMPLIANCE.md',
        'src/components/inputs/README.md'
      ]);
      const missing = checkLineage(modifiedFiles);
      expect(missing).toHaveLength(0);
    });

    it('should fail multi-target validation when editing central color configurations without updating style guide', () => {
      const modifiedFiles = new Set([
        'src/colors.json',
        'docs/SECURITY.md',
        'docs/public/COMPLIANCE.md'
      ]);
      const missing = checkLineage(modifiedFiles);
      
      expect(missing).toContainEqual({
        codeFile: 'src/colors.json',
        docFile: 'docs/public/STYLE_GUIDE.md'
      });
    });

    it('should pass validation when editing colors along with the style guide', () => {
      const modifiedFiles = new Set([
        'src/colors.json',
        'docs/public/STYLE_GUIDE.md'
      ]);
      const missing = checkLineage(modifiedFiles);
      expect(missing).toHaveLength(0);
    });
  });

  describe('Targeted Static Mapping and Lineage Validation', () => {
    it('should maintain the correct new mappings', () => {
      expect(MAPPING).toHaveProperty('src/packages/scannability/worker.ts', 'docs/public/SCALING.md');
      expect(MAPPING).not.toHaveProperty('src/hooks/useTelemetry.ts');
      expect(MAPPING).toHaveProperty('src/packages/core/security.ts', 'docs/SECURITY.md');
      expect(MAPPING).toHaveProperty('.github/rulesets/main.json', '.github/rulesets/README.md');
    });

    it('should fail validation when branch protection main.json is modified without its paired doc', () => {
      const modifiedFiles = new Set(['.github/rulesets/main.json']);
      const missing = checkLineage(modifiedFiles);
      expect(missing).toContainEqual({
        codeFile: '.github/rulesets/main.json',
        docFile: '.github/rulesets/README.md'
      });
    });

    it('should pass validation when branch protection main.json is modified with its paired doc', () => {
      const modifiedFiles = new Set(['.github/rulesets/main.json', '.github/rulesets/README.md']);
      const missing = checkLineage(modifiedFiles);
      const hasRulesetMissing = missing.some(m => m.codeFile === '.github/rulesets/main.json');
      expect(hasRulesetMissing).toBe(false);
    });

    it('should pass validation when only branch protection doc is modified (unidirectional constraint)', () => {
      const modifiedFiles = new Set(['.github/rulesets/README.md']);
      const missing = checkLineage(modifiedFiles);
      expect(missing).toHaveLength(0);
    });

    it('should fail validation when scannability worker is modified without scaling doc', () => {
      const modifiedFiles = new Set(['src/packages/scannability/worker.ts']);
      const missing = checkLineage(modifiedFiles);
      expect(missing).toContainEqual({
        codeFile: 'src/packages/scannability/worker.ts',
        docFile: 'docs/public/SCALING.md'
      });
    });

    it('should pass validation when scannability worker is modified with scaling doc', () => {
      const modifiedFiles = new Set(['src/packages/scannability/worker.ts', 'docs/public/SCALING.md']);
      const missing = checkLineage(modifiedFiles);
      const hasScannabilityMissing = missing.some(m => m.codeFile === 'src/packages/scannability/worker.ts');
      expect(hasScannabilityMissing).toBe(false);
    });

    it('should fail validation when security utilities are modified without security doc', () => {
      const modifiedFiles = new Set(['src/packages/core/security.ts']);
      const missing = checkLineage(modifiedFiles);
      expect(missing).toContainEqual({
        codeFile: 'src/packages/core/security.ts',
        docFile: 'docs/SECURITY.md'
      });
    });

    it('should pass validation when security utilities are modified with security doc', () => {
      const modifiedFiles = new Set(['src/packages/core/security.ts', 'docs/SECURITY.md']);
      const missing = checkLineage(modifiedFiles);
      const hasSecurityMissing = missing.some(m => m.codeFile === 'src/packages/core/security.ts');
      expect(hasSecurityMissing).toBe(false);
    });
  });

  describe('Command-Line Arguments Parsing', () => {
    it('should extract positional file arguments and ignore flags', () => {
      const args = ['--verbose', 'src/types.ts', '--config', 'docs/SECURITY.md'];
      const parsed = parseArgs(args);
      expect(parsed).toEqual(['src/types.ts', 'docs/SECURITY.md']);
    });

    it('should normalize backslashes to forward slashes', () => {
      const args = ['src\\packages\\scannability\\lib\\sharedContract.ts', 'docs\\public\\SCALING.md'];
      const parsed = parseArgs(args);
      expect(parsed).toEqual(['src/packages/scannability/lib/sharedContract.ts', 'docs/public/SCALING.md']);
    });

    it('should handle space-separated or comma-separated files inside a single argument', () => {
      const args = ['src/types.ts,docs/SECURITY.md', 'src/colors.json  docs/public/STYLE_GUIDE.md'];
      const parsed = parseArgs(args);
      expect(parsed).toEqual([
        'src/types.ts',
        'docs/SECURITY.md',
        'src/colors.json',
        'docs/public/STYLE_GUIDE.md'
      ]);
    });

    it('should filter out empty or whitespace-only arguments', () => {
      const args = ['', '   ', 'src/types.ts', ''];
      const parsed = parseArgs(args);
      expect(parsed).toEqual(['src/types.ts']);
    });

    it('should successfully parse a file path containing spaces without splitting if it exists on disk', () => {
      const tempFilePath = path.join(__dirname, '..', 'src/components/temp test file.tsx');
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      fs.writeFileSync(tempFilePath, 'temp content');

      try {
        const args = ['src/components/temp test file.tsx'];
        const parsed = parseArgs(args);
        expect(parsed).toEqual(['src/components/temp test file.tsx']);
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });

    it('should successfully parse a mapping key containing spaces without splitting', () => {
      const mockKey = 'src/components/my mapped file with spaces.tsx';
      MAPPING[mockKey] = 'docs/SECURITY.md';

      try {
        const args = [mockKey];
        const parsed = parseArgs(args);
        expect(parsed).toEqual([mockKey]);
      } finally {
        delete MAPPING[mockKey];
      }
    });

    it('should fall back to splitting spaces and commas if file does not exist on disk and is not in MAPPING', () => {
      const args = ['src/components/nonexistent file with spaces.tsx'];
      const parsed = parseArgs(args);
      expect(parsed).toEqual([
        'src/components/nonexistent',
        'file',
        'with',
        'spaces.tsx'
      ]);
    });

    it('should normalize backslashes and check file existence on disk', () => {
      const tempFilePath = path.join(__dirname, '..', 'src/components/temp backslash file.tsx');
      fs.mkdirSync(path.dirname(tempFilePath), { recursive: true });
      fs.writeFileSync(tempFilePath, 'temp content');

      try {
        const args = ['src\\components\\temp backslash file.tsx'];
        const parsed = parseArgs(args);
        expect(parsed).toEqual(['src/components/temp backslash file.tsx']);
      } finally {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      }
    });
  });

  describe('Resilient Lineage Auditing (CI & Fail-closed)', () => {
    it('should parse git diff --name-only output correctly', () => {
      const mockStdout = `src/types.ts\n"docs/SECURITY.md"\nsrc/utils/sh\\303\\251.ts`;
      const parsed = parseGitDiff(mockStdout);
      expect(parsed.has('src/types.ts')).toBe(true);
      expect(parsed.has('docs/SECURITY.md')).toBe(true);
      expect(parsed.has('src/utils/shé.ts')).toBe(true);
    });

    it('should run in CI and use target branch comparison', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: 'true', GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'feature-branch' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: (file, args) => {
          const argStr = args.join(' ');
          if (file === 'git' && argStr === 'diff --name-only origin/feature-branch...HEAD') {
            return 'src/packages/scannability/lib/sharedContract.ts\ndocs/public/SCALING.md';
          }
          throw new Error(`Unexpected command: ${file} ${argStr}`);
        },
        existsSync: () => true,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBeNull(); // passes!
    });

    it('should run in CI and fail closed without fallback if target branch comparison fails', () => {
      let exitCode = null;
      let usedFallback = false;
      const mockOptions = {
        env: { CI: 'true', GITHUB_ACTIONS: 'true' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: (file, args) => {
          const argStr = args.join(' ');
          if (file === 'git' && argStr.includes('origin/main...HEAD')) {
            throw new Error('Ref not found / shallow clone');
          }
          if (file === 'git' && (argStr.includes('diff-tree') || argStr.includes('HEAD~1'))) {
            usedFallback = true;
          }
          throw new Error(`Unexpected command: ${file} ${argStr}`);
        },
        existsSync: () => true,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(usedFallback).toBe(false);
      expect(exitCode).toBe(1);
    });

    it('should fail closed in CI if target branch comparison fails', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: 'true', GITHUB_ACTIONS: 'true' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: () => {
          throw new Error('Git command completely failed');
        },
        existsSync: () => true,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBe(1);
    });

    it('should fail closed in CI if .git directory is missing', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: 'true', GITHUB_ACTIONS: 'true' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: () => 'src/types.ts',
        existsSync: (p) => !p.endsWith('.git'), // simulate missing .git
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBe(1);
    });

    it('should fail closed locally if .git directory is missing during uncommitted scan', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: '' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: () => '',
        existsSync: (p) => !p.endsWith('.git'), // simulate missing .git
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBe(1);
    });

    it('should fail closed locally if git status command fails during uncommitted scan', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: '' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: () => { throw new Error('git status failed'); },
        existsSync: () => true,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBe(1);
    });

    it('should pass validation locally when no changes exist', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: '' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: () => '', // empty changes
        existsSync: () => true,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBeNull();
    });

    it('should exit with 1 when documentation updates are missing', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: 'true', GITHUB_ACTIONS: 'true' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: (file, args) => {
          const argStr = args.join(' ');
          if (file === 'git' && argStr.includes('origin/main...HEAD')) {
            return 'src/packages/scannability/lib/sharedContract.ts'; // sharedContract.ts is modified, but docs/public/SCALING.md is not!
          }
          throw new Error(`Unexpected command: ${file} ${argStr}`);
        },
        existsSync: () => true,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBe(1);
    });

    it('should skip CI checks and fall back to local check if SKIP_GIT_VALIDATION is set', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: 'true', SKIP_GIT_VALIDATION: 'true' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: () => '', // simulated clean git status
        existsSync: () => true,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBeNull();
    });

    it('should skip checks completely on non-GHA CI environments like Cloudflare Pages', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: 'true', CF_PAGES: 'true' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: () => { throw new Error('should not call git'); },
        existsSync: () => false, // even if .git is missing completely
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBeNull();
    });

    it('should skip checks in Cloudflare Workers CI when CF_PAGES is unavailable', () => {
      let exitCode = null;
      const mockOptions = {
        env: { CI: 'true', CLOUDFLARE_ACCOUNT_ID: 'test-account' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: () => { throw new Error('should not call git'); },
        existsSync: () => false,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(exitCode).toBeNull();
    });

    it('should retry after fetch and pass when origin/main ref initially missing', () => {
      let exitCode = null;
      let fetched = false;
      let diffRetried = false;
      const mockOptions = {
        env: { CI: 'true' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: (file, args) => {
          const argStr = args.join(' ');
          if (file === 'git' && argStr === 'diff --name-only origin/main...HEAD') {
            if (!fetched) {
              throw new Error('unknown revision or path not in the working tree');
            }
            diffRetried = true;
            return 'src/packages/scannability/lib/sharedContract.ts\ndocs/public/SCALING.md';
          }
          if (file === 'git' && argStr === 'fetch origin main:refs/remotes/origin/main') {
            fetched = true;
            return '';
          }
          throw new Error(`Unexpected command: ${file} ${argStr}`);
        },
        existsSync: () => true,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(fetched).toBe(true);
      expect(diffRetried).toBe(true);
      expect(exitCode).toBeNull();
    });

    it('should fall back to double-dot diff if triple-dot diff fails after fetch', () => {
      let exitCode = null;
      let fetched = false;
      let doubleDotTried = false;
      const mockOptions = {
        env: { CI: 'true' },
        argv: ['node', 'scripts/git_lineage_auditor.js'],
        execSync: (file, args) => {
          const argStr = args.join(' ');
          if (file === 'git' && argStr === 'diff --name-only origin/main...HEAD') {
            if (!fetched) {
              throw new Error('unknown revision or path not in the working tree');
            }
            throw new Error('No common ancestor');
          }
          if (file === 'git' && argStr === 'fetch origin main:refs/remotes/origin/main') {
            fetched = true;
            return '';
          }
          if (file === 'git' && argStr === 'diff --name-only origin/main..HEAD') {
            doubleDotTried = true;
            return 'src/packages/scannability/lib/sharedContract.ts\ndocs/public/SCALING.md';
          }
          throw new Error(`Unexpected command: ${file} ${argStr}`);
        },
        existsSync: () => true,
        exit: (code) => { exitCode = code; }
      };

      runAuditor(mockOptions);
      expect(fetched).toBe(true);
      expect(doubleDotTried).toBe(true);
      expect(exitCode).toBeNull();
    });
  });

  describe('every failure names its fix (#1615)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** Runs the auditor and returns its exit code and every error line it printed. */
    const run = (options) => {
      const lines = [];
      vi.spyOn(console, 'error').mockImplementation((...args) => lines.push(args.join(' ')));
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      let exitCode = null;
      runAuditor({ argv: ['node', 'scripts/git_lineage_auditor.js'], exit: (code) => { exitCode = code; }, ...options });
      return { exitCode, fixes: lines.filter((line) => line.startsWith('Fix:')) };
    };
    const ci = { CI: 'true', GITHUB_ACTIONS: 'true' };

    it('names the doc mapping when a paired doc is missing', () => {
      const [codeFile] = Object.keys(MAPPING);
      const { exitCode, fixes } = run({ env: {}, argv: ['node', 'scripts/git_lineage_auditor.js', codeFile], existsSync: () => false });
      expect(exitCode).toBe(1);
      expect(fixes).toEqual([expect.stringContaining('MAPPING in scripts/git_lineage_auditor.js')]);
    });

    it('says to fetch the base branch when the comparison fails in CI', () => {
      const { exitCode, fixes } = run({
        env: { ...ci, GITHUB_BASE_REF: 'main' },
        execSync: () => { throw new Error('shallow clone'); },
        existsSync: () => true,
      });
      expect(exitCode).toBe(1);
      expect(fixes).toEqual([expect.stringContaining('git fetch origin main')]);
      expect(fixes[0]).toContain('git fetch --unshallow');
    });

    it('says to run from a clone when .git is missing, in CI and locally', () => {
      for (const env of [ci, {}]) {
        const { exitCode, fixes } = run({ env, execSync: () => '', existsSync: (p) => !p.endsWith('.git') });
        expect(exitCode).toBe(1);
        expect(fixes).toEqual([expect.stringContaining('SKIP_GIT_VALIDATION=1 skips it, for local use only')]);
      }
    });

    it('prints a fix for a failed git status and an unexpected error', () => {
      const status = run({ env: {}, execSync: () => { throw new Error('git status failed'); }, existsSync: () => true });
      expect(status.exitCode).toBe(1);
      expect(status.fixes).toHaveLength(1);
      const unexpected = run({ env: ci, existsSync: () => { throw new Error('disk gone'); } });
      expect(unexpected.exitCode).toBe(1);
      expect(unexpected.fixes).toHaveLength(1);
    });
  });
});
