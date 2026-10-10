import { execBinary } from './utils/execHelper.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { syncUICatalog } from './sync_docs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

const DEFAULT_UI_DIR = path.join(repoRoot, 'src/components/ui');
const DEFAULT_CATALOG_PATH = path.join(repoRoot, 'docs/public/UI_CATALOG.md');

const TRACKED_DIRS = [
  'src/components/ui',
  'src/components/inputs',
  'src/components/style-controls',
  // Shared feature components directly under src/components (not recursive).
  'src/components'
];

/**
 * Directories whose component edits must be accompanied by a catalog edit in the same change set.
 * Shared feature components under src/components are validated for registration (validateCatalog)
 * but, because they change often for behaviour-only reasons, edits to them do not force a catalog edit.
 */
const LINEAGE_DIRS = [
  'src/components/ui',
  'src/components/inputs',
  'src/components/style-controls'
];

/**
 * Validates that all user-facing UI components (.tsx files in src/components/ui/, src/components/inputs/,
 * src/components/style-controls/ and the shared components directly under src/components/)
 * are documented in docs/public/UI_CATALOG.md with correct file references and descriptions.
 * 
 * @param {string|string[]} uiDir Absolute path(s) to the UI directory
 * @param {string} catalogPath Absolute path to the UI_CATALOG.md file
 * @returns {string[]} List of validation error messages
 */
export function validateCatalog(uiDir = DEFAULT_UI_DIR, catalogPath = DEFAULT_CATALOG_PATH) {
  const errors = [];

  if (!fs.existsSync(catalogPath)) {
    errors.push(`Catalog file does not exist: ${catalogPath}`);
    return errors;
  }

  let directories = [];
  if (uiDir === DEFAULT_UI_DIR) {
    directories = TRACKED_DIRS.map(dir => path.join(repoRoot, dir));
  } else if (Array.isArray(uiDir)) {
    directories = uiDir;
  } else {
    directories = [uiDir];
  }

  // Read the catalog file
  const catalogContent = fs.readFileSync(catalogPath, 'utf8');
  const catalogLines = catalogContent.split(/\r?\n/);

  // Helper: Find directory for heading line
  function findDirForHeading(headingLine, dirs, root) {
    const cleanHeading = headingLine.replace(/\\/g, '/').toLowerCase();

    // Exact match: a backticked directory path in the heading, e.g. (`src/components/ui/`).
    const backtickedPaths = Array.from(cleanHeading.matchAll(/`([^`]+)`/g), m => m[1].replace(/\/+$/, ''));
    for (const candidate of backtickedPaths) {
      const exact = dirs.find(d => path.relative(root, d).replace(/\\/g, '/').toLowerCase() === candidate);
      if (exact) {
        return exact;
      }
    }
    // A heading that names an untracked subdirectory of a tracked directory (e.g. `src/components/arcade/`)
    // documents that subdirectory, not its tracked parent, so it must not fall through to a looser match.
    const trackedPaths = dirs.map(d => path.relative(root, d).replace(/\\/g, '/').toLowerCase());
    if (backtickedPaths.some(candidate => trackedPaths.some(tracked => tracked && candidate.startsWith(`${tracked}/`)))) {
      return null;
    }
    
    // List of key segments we want to check
    const segments = ['style-controls', 'inputs', 'ui'];

    for (const segment of segments) {
      if (cleanHeading.includes(segment)) {
        // Find a directory that contains this segment in its base name or path
        const matched = dirs.find(d => {
          const norm = d.replace(/\\/g, '/').toLowerCase();
          return norm.includes(segment);
        });
        if (matched) {
          return matched;
        }
      }
    }

    // Fallback 1: Try relative path match (case-insensitive)
    for (const d of dirs) {
      const relativePath = path.relative(root, d).replace(/\\/g, '/').toLowerCase();
      if (relativePath && cleanHeading.includes(relativePath)) {
        return d;
      }
    }

    // Fallback 2: Try exact base name match as whole word or path component (case-insensitive)
    for (const d of dirs) {
      const baseName = path.basename(d).toLowerCase();
      const escapedBaseName = baseName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(?:\\b|\\/|\\\\)${escapedBaseName}(?:\\b|\\/|\\\\)`);
      if (regex.test(cleanHeading)) {
        return d;
      }
    }

    // Fallback 3: If only one directory, and heading looks like a component section, return it
    if (dirs.length === 1 && (cleanHeading.includes('component') || cleanHeading.includes('src/'))) {
      return dirs[0];
    }

    return null;
  }

  // Parse the catalog into structured sections
  const sections = [];
  let currentSection = {
    headingLine: '',
    headingName: 'Root',
    dir: null,
    lines: []
  };

  for (const line of catalogLines) {
    if (line.startsWith('##')) {
      if (currentSection.lines.length > 0 || currentSection.headingLine) {
        sections.push(currentSection);
      }
      const headingName = line.replace(/^#+\s+/, '').trim();
      const matchedDir = findDirForHeading(line, directories, repoRoot);
      currentSection = {
        headingLine: line,
        headingName,
        dir: matchedDir,
        lines: []
      };
    } else {
      currentSection.lines.push(line);
    }
  }
  if (currentSection.lines.length > 0 || currentSection.headingLine) {
    sections.push(currentSection);
  }

  // Helper: Find if a file exists in any of the tracked directories
  function findFileInDirectories(filename, dirs) {
    for (const d of dirs) {
      if (fs.existsSync(path.join(d, filename))) {
        return d;
      }
    }
    return null;
  }

  // Helper: Extract all filenames ending in .tsx from a line
  function extractFileNames(line) {
    const regex = /`([^`]+)`/g;
    const files = [];
    let match;
    while ((match = regex.exec(line)) !== null) {
      const val = match[1].trim();
      if (val.endsWith('.tsx')) {
        files.push(val);
      }
    }
    return files;
  }

  // Pass 1: Catalog -> Disk (Reverse Check)
  for (const section of sections) {
    if (section.dir) {
      if (!fs.existsSync(section.dir)) {
        errors.push(`UI directory does not exist: ${section.dir}`);
        continue;
      }

      for (const line of section.lines) {
        const referencedFiles = extractFileNames(line);
        for (const file of referencedFiles) {
          const expectedPath = path.join(section.dir, file);
          if (!fs.existsSync(expectedPath)) {
            // Check if the file exists in some other tracked directory
            const actualDir = findFileInDirectories(file, directories);
            if (actualDir) {
              errors.push(`UI component '${file}' is listed under the wrong section heading in the catalog (referenced under '${section.headingName}', but exists in '${path.basename(actualDir)}').`);
            } else {
              if (file.endsWith('.test.tsx')) {
                errors.push(`Documented test file '${file}' does not exist in the same folder as its source component.`);
              } else {
                errors.push(`Documented source file '${file}' does not exist on disk.`);
              }
            }
          }
        }
      }
    }
  }

  // Pass 2: Disk -> Catalog (Forward Check)
  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      if (!errors.includes(`UI directory does not exist: ${dir}`)) {
        errors.push(`UI directory does not exist: ${dir}`);
      }
      continue;
    }

    // Discover all UI components (.tsx files) and exclude test files (.test.tsx)
    const files = fs.readdirSync(dir);
    const componentFiles = files.filter(file => file.endsWith('.tsx') && !file.endsWith('.test.tsx'));

    // Verify each discovered component
    for (const componentFile of componentFiles) {
      // Find which section lists this component
      const listingSection = sections.find(sec => sec.lines.some(line => line.includes(`\`${componentFile}\``)));

      if (!listingSection) {
        errors.push(`UI component '${componentFile}' is missing from the catalog (${path.basename(catalogPath)}).`);
        continue;
      }

      // Verify listingSection maps to the current directory
      if (listingSection.dir !== null && listingSection.dir !== dir) {
        errors.push(`UI component '${componentFile}' exists on disk in '${path.basename(dir)}' but is listed under the wrong section heading '${listingSection.headingName}' in the catalog.`);
        continue;
      }

      const componentLine = listingSection.lines.find(line => line.includes(`\`${componentFile}\``));
      if (!componentLine) {
        continue;
      }

      // Verify correct companion test reference if the test file exists on disk
      const testFile = componentFile.replace('.tsx', '.test.tsx');
      const testFileExists = fs.existsSync(path.join(dir, testFile));

      if (testFileExists && !componentLine.includes(`\`${testFile}\``)) {
        errors.push(`UI component '${componentFile}' has a companion test file '${testFile}' on disk, but it is not referenced in the catalog entry.`);
      }

      // Verify functional description exists
      const colonIndex = componentLine.indexOf('):');
      if (colonIndex === -1) {
        errors.push(`UI component '${componentFile}' catalog entry is missing or incorrectly formatted (expected '):' before description).`);
      } else {
        const description = componentLine.slice(colonIndex + 2).trim();
        if (description.length < 10) {
          errors.push(`UI component '${componentFile}' has an insufficient or missing functional description (must be at least 10 characters).`);
        }
      }
    }
  }

  return errors;
}

/**
 * Checks for missing catalog updates in the current changed/staged files.
 * If any UI component files under tracked directories are modified,
 * the UI_CATALOG.md file must be modified/updated in the same change set.
 * 
 * @param {Set<string>} modifiedFiles Set of relative or normalized modified file paths
 * @returns {Array<{codeFile: string, catalogFile: string}>} Array of missing catalog updates
 */
export function checkLineage(modifiedFiles) {
  const missingUpdates = [];
  
  // Find modified UI components (.tsx or .test.tsx in tracked directories)
  const changedUiFiles = Array.from(modifiedFiles).filter(file => {
    const normalized = file.replace(/\\/g, '/');
    const isInTrackedDir = LINEAGE_DIRS.some(dir => normalized.startsWith(dir + '/'));
    return isInTrackedDir && (normalized.endsWith('.tsx') || normalized.endsWith('.test.tsx'));
  });

  if (changedUiFiles.length > 0) {
    const catalogRelative = 'docs/public/UI_CATALOG.md';
    const isCatalogUpdated = Array.from(modifiedFiles).some(file => file.replace(/\\/g, '/') === catalogRelative);
    
    if (!isCatalogUpdated) {
      for (const codeFile of changedUiFiles) {
        missingUpdates.push({
          codeFile,
          catalogFile: catalogRelative
        });
      }
    }
  }

  return missingUpdates;
}

/**
 * Decodes octal and other backslash escape sequences from git output.
 */
export function decodeGitPath(filePath) {
  if (filePath.startsWith('"') && filePath.endsWith('"')) {
    filePath = filePath.slice(1, -1);
  }

  const bytes = [];
  let i = 0;
  while (i < filePath.length) {
    if (filePath[i] === '\\') {
      if (i + 1 < filePath.length) {
        const nextChar = filePath[i + 1];
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
            bytes.push('\\'.charCodeAt(0));
            for (let c = 0; c < octalStr.length; c++) {
              bytes.push(octalStr.charCodeAt(c));
            }
          } else {
            bytes.push(byteVal);
          }
          i += 1 + octalStr.length;
        } else {
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
            bytes.push('\\'.charCodeAt(0));
            bytes.push(nextChar.charCodeAt(0));
          }
          i += 2;
        }
      } else {
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

/**
 * Parses git status porcelain output.
 */
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

/**
 * Parses command line arguments into clean relative file paths.
 */
export function parseArgs(args) {
  const files = [];
  const positionalArgs = args.filter(arg => !arg.startsWith('-'));

  for (const arg of positionalArgs) {
    if (!arg || !arg.trim()) continue;

    const hasSpaceOrComma = /[\s,]/.test(arg);

    if (hasSpaceOrComma) {
      const normalized = arg.replace(/\\/g, '/');
      const existsOnDisk = fs.existsSync(normalized) || fs.existsSync(path.join(repoRoot, normalized));

      if (existsOnDisk) {
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

function runValidator() {
  console.log('🔄 Running Automated UI Component Catalog Synchronization Validation...');
  const startTime = Date.now();

  try {
    // 0. Optional Auto-Fix Flag (--fix)
    const hasFixFlag = process.argv.includes('--fix');
    if (hasFixFlag) {
      console.log('🛠️ Auto-fix flag (--fix) detected. Synchronizing UI catalog entries...');
      syncUICatalog(
        TRACKED_DIRS.map(dir => path.join(repoRoot, dir)),
        DEFAULT_CATALOG_PATH,
        repoRoot
      );
    }

    // 1. Run Catalog Integrity Verification
    const validationErrors = validateCatalog(DEFAULT_UI_DIR, DEFAULT_CATALOG_PATH);
    if (validationErrors.length > 0) {
      console.error('\n❌ [UI Catalog Sync] Catalog Integrity Validation Failed:');
      for (const err of validationErrors) {
        console.error(`  - ${err}`);
      }
      console.error('\nPlease register/update your UI components and companion test files in docs/public/UI_CATALOG.md.');
      process.exit(1);
    }
    console.log('✅ UI Catalog Integrity matches shared components perfectly.');

    // 2. Run Git Lineage / Change Set verification
    const isCloudflare = !!process.env.CF_PAGES || Object.keys(process.env).some(key => key.startsWith('CF_') || key.startsWith('CLOUDFLARE_'));
    const isGHA = !!process.env.GITHUB_ACTIONS || (!!process.env.CI && !isCloudflare && !process.env.SKIP_GIT_VALIDATION);
    const isOtherCI = !!process.env.CI && !isGHA;

    if (process.env.SKIP_GIT_VALIDATION || isOtherCI) {
      console.log('[UI Catalog Sync] SKIP_GIT_VALIDATION or non-GHA CI environment detected. Skipping git lineage check.');
      console.log(`\n🎉 All catalog synchronization validations passed in ${Date.now() - startTime}ms.`);
      return;
    }

    const args = process.argv.slice(2);
    const explicitFiles = parseArgs(args);
    let modifiedFiles = new Set();

    if (explicitFiles.length > 0) {
      console.log(`[UI Catalog Sync] Evaluating lineage check on ${explicitFiles.length} explicit staged/modified files...`);
      modifiedFiles = new Set(explicitFiles);
    } else {
      console.log('[UI Catalog Sync] No explicit file list provided. Querying git repository state...');
      if (!fs.existsSync(path.join(repoRoot, '.git'))) {
        console.error('❌ [UI Catalog Sync] Not a git repository or .git folder missing. Failed closed.');
        process.exit(1);
      } else {
        let stdout = '';
        if (process.env.CI && !process.env.SKIP_GIT_VALIDATION) {
          // CI Pipeline check: inspect files changed in this branch/PR
          const target = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main';
          console.log(`[UI Catalog Sync] CI Context detected. Querying diff against target ${target}...`);
          try {
            stdout = execBinary('git', ['diff', '--name-only', `${target}...HEAD`], { cwd: repoRoot });
          } catch (err) {
            console.error(`❌ [UI Catalog Sync] Target branch comparison failed: ${err.message}`);
            process.exit(1);
          }
          // Normalize git diff line endings and filter non-empty lines
          if (stdout) {
            const filesList = stdout
              .split(/\r?\n/)
              .map(f => f.trim())
              .filter(Boolean);
            modifiedFiles = new Set(filesList);
          }
        } else {
          // Local/dev: check uncommitted staged and unstaged files
          try {
            stdout = execBinary('git', ['status', '--porcelain'], { cwd: repoRoot });
            if (stdout.trim()) {
              modifiedFiles = parseGitStatus(stdout);
            }
          } catch (err) {
            console.error(`❌ [UI Catalog Sync] Failed to query git status: ${err.message}`);
            process.exit(1);
          }
        }
      }
    }

    const lineageErrors = checkLineage(modifiedFiles);
    if (lineageErrors.length > 0) {
      console.error('\n❌ [UI Catalog Sync] Missing Concurrent Documentation Update!');
      for (const { codeFile, catalogFile } of lineageErrors) {
        console.error(`  - UI component file '${codeFile}' was modified, but the central catalog '${catalogFile}' was not in the same change set.`);
      }
      console.error(`\nTo resolve this, please update and commit a change to '${DEFAULT_CATALOG_PATH}' detailing your component changes.`);
      process.exit(1);
    }

    console.log('✅ UI Catalog change set lineage is fully synchronized.');
    console.log(`\n🎉 All catalog synchronization validations passed in ${Date.now() - startTime}ms.`);
  } catch (error) {
    console.error('[UI Catalog Sync] Unexpected fatal error during validation:', error);
    process.exit(1);
  }
}

// Only run automatically if executed directly from node CLI
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('validate_ui_catalog.js'))) {
  runValidator();
}
