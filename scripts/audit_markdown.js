import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { parseFrontmatter, isQuarantined } from './compile_docs_manifest.js';

import { tokenize, walk, slugify, MarkdownSyntaxError } from './utils/markdown/index.js';

const require = createRequire(import.meta.url);
// typescript ships as CJS; use createRequire so pnpm hoisting works.
const ts = require('typescript');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');

export const parsedFilesCache = new Map();

export function getParsedFile(file) {
  if (isQuarantined(file)) {
    return { content: '', frontmatter: {}, body: '' };
  }
  const filePath = path.isAbsolute(file) ? file : path.join(repoRoot, file);
  const normalizedPath = path.resolve(filePath);
  if (parsedFilesCache.has(normalizedPath)) {
    return parsedFilesCache.get(normalizedPath);
  }
  let content = '';
  try {
    if (fs.existsSync(normalizedPath)) {
      content = fs.readFileSync(normalizedPath, 'utf-8');
    }
  } catch (err) {
    console.warn(`Warning: Could not read file at ${normalizedPath}`, err);
  }
  const { frontmatter, body } = parseFrontmatter(content);
  const result = { content, frontmatter, body };
  parsedFilesCache.set(normalizedPath, result);
  return result;
}

export const docsPublicDir = path.join(repoRoot, 'docs', 'public');

/**
 * Directories whose Markdown files are audited in full (non-recursive).
 * Paths are repository-relative POSIX paths.
 */
export const AUDITED_DOC_DIRS = ['docs', 'docs/public', 'docs/adr', 'docs/agents', 'docs/optical-transfer'];

/**
 * Individual Markdown files audited outside the directories above.
 */
export const AUDITED_DOC_FILES = [
  'README.md',
  'CONTEXT.md',
  'AGENTS.md',
  'src/components/inputs/README.md',
  'src/packages/README.md',
  '.github/rulesets/README.md'
];

/**
 * Remediation hints printed with every audit error, keyed by error kind.
 */
export const REMEDIATION_HINTS = {
  missingFile: 'Restore the file, or remove it from AUDITED_DOC_FILES in scripts/audit_markdown.js.',
  publishApproved: "Add 'publish-approved: true' to the frontmatter once the page is reviewed for public release, or move it out of docs/public/.",
  placeholder: "Resolve the placeholder, or set 'draft: true' in the frontmatter while the page is unfinished.",
  outsideRoot: 'Link to a file inside the repository, or use an absolute https:// URL for external resources.',
  brokenFile: "Fix the relative path (it resolves from the linking file's folder and is case-sensitive), or restore the target file.",
  brokenAnchor: "Point the fragment at an existing heading slug in the target file (lowercase, spaces become '-', punctuation dropped).",
  snippet: 'Make the snippet type-check against tsconfig.json, or fence it as ```text if it is only illustrative.',
  unsupported: 'Rewrite the construct with the Markdown subset scripts/utils/markdown supports (ATX headings, lists, tables, fenced code, links), or extend that parser with tests.'
};

/**
 * Prints an audit error together with the matching remediation hint and flags the run as failed.
 * @param {string|null} file Repository-relative file the error belongs to (null for global errors).
 * @param {string} message Description of the problem.
 * @param {keyof typeof REMEDIATION_HINTS} hintKey Which remediation hint to print.
 */
export function reportError(file, message, hintKey) {
  const prefix = file ? `Error in ${file}: ` : 'Error: ';
  console.error(`${prefix}${message}\n  Fix: ${REMEDIATION_HINTS[hintKey]}`);
  hasErrors = true;
}

function listMarkdown(relativeDir) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  return fs.readdirSync(absoluteDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => `${relativeDir}/${entry.name}`)
    .sort();
}

export function getFilesToAudit() {
  const rawList = [...AUDITED_DOC_DIRS.flatMap(listMarkdown), ...AUDITED_DOC_FILES];
  return [...new Set(rawList)].filter(file => !isQuarantined(file));
}

export let hasErrors = false;

export function resetErrors() {
  hasErrors = false;
  parsedFilesCache.clear();
  tokenCache.clear();
}

export function setErrors(val) {
  hasErrors = val;
}

export { slugify };

/** Tokens per file and source, so each file is parsed (and reports a syntax error) once. */
const tokenCache = new Map();

/**
 * Tokenizes a file's Markdown body. Unsupported syntax is reported as an audit error.
 * @param {string} file Repository-relative file name.
 * @param {string} content Full file content (with frontmatter).
 * @returns {object[]} Tokens, or an empty list when the file cannot be parsed.
 */
function tokensFor(file, content) {
  const key = `${file}\0${content}`;
  if (tokenCache.has(key)) return tokenCache.get(key);
  const { body } = parseFrontmatter(content);
  const lineOffset = content.slice(0, content.length - body.length).split(/\r?\n/).length - 1;
  let tokens = [];
  try {
    tokens = tokenize(body, { file, lineOffset });
  } catch (err) {
    if (!(err instanceof MarkdownSyntaxError)) throw err;
    reportError(file, `Unsupported Markdown: ${err.message}`, 'unsupported');
  }
  tokenCache.set(key, tokens);
  return tokens;
}

/**
 * Heading slugs of a file.
 * @param {string} file Repository-relative file name.
 * @param {string} content Full file content.
 * @returns {Set<string>} Slugs.
 */
function headingSlugs(file, content) {
  const headings = new Set();
  walk(tokensFor(file, content), token => {
    if (token.type === 'heading') {
      headings.add(slugify(token.text));
    }
  });
  return headings;
}

export function checkPublishApproved(file, content) {
  if (isQuarantined(file)) {
    return false;
  }
  
  const filePathAbs = path.isAbsolute(file) ? file : path.resolve(repoRoot, file);
  const docsPublicDirAbs = path.resolve(docsPublicDir);
  const isInPublicDir = filePathAbs.startsWith(docsPublicDirAbs + path.sep) || filePathAbs === docsPublicDirAbs;
  
  if (!isInPublicDir) {
    return false;
  }
  
  const { frontmatter } = parseFrontmatter(content);
  if (frontmatter['publish-approved'] !== true) {
    reportError(file, "Public document is missing the required 'publish-approved: true' metadata attribute.", 'publishApproved');
    return true;
  }
  return false;
}

export function checkPlaceholders(file, content) {
  if (isQuarantined(file)) {
    return false;
  }
  const { frontmatter, body } = parseFrontmatter(content);
  if (frontmatter.draft === true) {
    return false;
  }
  let localHasErrors = false;
  const placeholderRegex = /(TODO|FIXME)/g;
  let match;
  while ((match = placeholderRegex.exec(body)) !== null) {
    reportError(file, `Found placeholder string '${match[0]}'`, 'placeholder');
    localHasErrors = true;
  }
  return localHasErrors;
}

export function buildFileHeadings(file, content) {
  if (isQuarantined(file)) {
    return new Set();
  }
  return headingSlugs(file, content);
}

export function existsSyncCaseSensitive(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return false;
  }

  const resolvedPath = path.resolve(targetPath);
  let current = repoRoot;
  let relative = path.relative(repoRoot, resolvedPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const parsed = path.parse(resolvedPath);
    current = parsed.root;
    relative = path.relative(current, resolvedPath);
  }

  if (!relative) return true;

  const parts = relative.split(/[/\\]/).filter(Boolean);

  for (const part of parts) {
    try {
      if (!fs.existsSync(current)) break;
      const entries = fs.readdirSync(current);
      if (entries.includes(part)) {
        current = path.join(current, part);
        continue;
      }
      const partLower = part.toLowerCase();
      const hasCaseInsensitiveMatch = entries.some(e => e.toLowerCase() === partLower);
      if (hasCaseInsensitiveMatch) {
        return false;
      }
      current = path.join(current, part);
    } catch {
      break;
    }
  }

  return true;
}

export function verifyLinks(file, content, fileHeadings) {
  if (isQuarantined(file)) {
    return false;
  }
  let localHasErrors = false;
  const filePath = path.join(repoRoot, file);

  walk(tokensFor(file, content), token => {
    if (token.type === 'link') {
      const href = token.href;
      
      // Ignore external HTTP/HTTPS links and mailto:
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        return;
      }
      
      let targetFile = file;
      let targetHash = null;
      
      if (href.startsWith('#')) {
        targetHash = href.slice(1);
      } else {
        const parts = href.split('#');
        const relativeTargetFile = parts[0];
        const targetFilePathAbs = path.resolve(path.dirname(filePath), relativeTargetFile);
        
        // Block path traversal and any link outside repository root
        const relativeFromRoot = path.relative(repoRoot, targetFilePathAbs);
        if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
          reportError(file, `Relative link '${href}' resolves to a path outside the repository root.`, 'outsideRoot');
          localHasErrors = true;
          return;
        }

        targetFile = relativeFromRoot;
        if (parts.length > 1) {
          targetHash = parts[1];
        }
      }
      
      // Verify file exists
      if (targetFile) {
        const targetFilePath = path.join(repoRoot, targetFile);
        if (!existsSyncCaseSensitive(targetFilePath)) {
          reportError(file, `Broken link references missing file '${targetFile}' (href: '${href}')`, 'brokenFile');
          localHasErrors = true;
          return;
        }
        
        // Verify hash exists in the target file
        if (targetHash) {
          let headingsToSearch = fileHeadings[targetFile];
          
          if (!headingsToSearch) {
            // Target file is valid but wasn't audited yet (e.g. README.md)
            headingsToSearch = headingSlugs(targetFile, getParsedFile(targetFile).content);
            fileHeadings[targetFile] = headingsToSearch;
          }
          
          const targetSlug = slugify(targetHash);
          if (!headingsToSearch.has(targetSlug) && !headingsToSearch.has(targetHash)) {
            reportError(file, `Broken link references missing anchor '#${targetHash}' in '${targetFile}' (href: '${href}')`, 'brokenAnchor');
            localHasErrors = true;
          }
        }
      }
    }
  });
  return localHasErrors;
}

export function checkCodeSnippets(filesList) {
  let localHasErrors = false;
  const virtualFiles = new Map();
  try {
    let snippetIndex = 0;
    for (const file of filesList) {
      const filePath = path.join(repoRoot, file);
      if (!fs.existsSync(filePath)) continue;
      const { frontmatter, content } = getParsedFile(file);
      if (frontmatter.draft === true) {
        continue;
      }

      walk(tokensFor(file, content), token => {
        if (token.type === 'code') {
          const lang = (token.lang || '').toLowerCase();
          if (['ts', 'tsx', 'typescript', 'typescriptreact'].includes(lang)) {
            const fileDir = path.dirname(filePath);
            const tempFileName = `virtual_snippet_${snippetIndex++}.tsx`;
            const tempFilePath = path.resolve(fileDir, tempFileName);
            virtualFiles.set(tempFilePath, {
              file: file,
              lang: lang,
              text: token.text
            });
          }
        }
      });
    }

    const fileNames = Array.from(virtualFiles.keys());
    if (fileNames.length > 0) {
      const tsconfigPath = path.join(repoRoot, 'tsconfig.json');
      const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      if (readResult.error) {
        reportError('tsconfig.json', `Could not read tsconfig.json: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, '\n')}`, 'snippet');
        localHasErrors = true;
      } else {
        const parsedConfig = ts.parseJsonConfigFileContent(
          readResult.config,
          ts.sys,
          repoRoot
        );

        const compilerOptions = {
          ...parsedConfig.options,
          noEmit: true,
          skipLibCheck: true,
        };

        const defaultHost = ts.createCompilerHost(compilerOptions);

        const customHost = {
          ...defaultHost,
          fileExists(fileName) {
            const normalizedPath = path.resolve(fileName);
            if (virtualFiles.has(normalizedPath)) {
              return true;
            }
            return defaultHost.fileExists(fileName);
          },
          readFile(fileName) {
            const normalizedPath = path.resolve(fileName);
            if (virtualFiles.has(normalizedPath)) {
              return virtualFiles.get(normalizedPath).text;
            }
            return defaultHost.readFile(fileName);
          },
          getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) {
            const normalizedPath = path.resolve(fileName);
            if (virtualFiles.has(normalizedPath)) {
              const virtualFileInfo = virtualFiles.get(normalizedPath);
              if (!virtualFileInfo.sourceFile) {
                const languageVersion = typeof languageVersionOrOptions === 'object'
                  ? languageVersionOrOptions.target
                  : languageVersionOrOptions;
                virtualFileInfo.sourceFile = ts.createSourceFile(
                  normalizedPath,
                  virtualFileInfo.text,
                  languageVersion || ts.ScriptTarget.Latest,
                  true
                );
              }
              return virtualFileInfo.sourceFile;
            }
            return defaultHost.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
          },
          writeFile() {
            // No physical output files generated
          },
          directoryExists(directoryName) {
            const normalizedDir = path.resolve(directoryName);
            for (const virtualPath of virtualFiles.keys()) {
              if (virtualPath.startsWith(normalizedDir)) {
                return true;
              }
            }
            if (defaultHost.directoryExists) {
              return defaultHost.directoryExists(directoryName);
            }
            return false;
          }
        };

        const program = ts.createProgram(fileNames, compilerOptions, customHost);
        const emitResult = program.emit();

        const allDiagnostics = ts
          .getPreEmitDiagnostics(program)
          .concat(emitResult.diagnostics);

        for (const diagnostic of allDiagnostics) {
          if (diagnostic.category === ts.DiagnosticCategory.Error) {
            localHasErrors = true;
            hasErrors = true;
            if (diagnostic.file) {
              const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start);
              const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
              const fileName = path.resolve(diagnostic.file.fileName);
              const tempFileInfo = virtualFiles.get(fileName);
              if (tempFileInfo) {
                reportError(tempFileInfo.file, `TS type check error in snippet on line ${line + 1}, col ${character + 1}: ${message}`, 'snippet');
              } else {
                reportError(null, `TS error in ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`, 'snippet');
              }
            } else {
              reportError(null, `TS error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`, 'snippet');
            }
          }
        }
      }
    }
  } catch (err) {
    reportError(null, `TS snippet extraction or compilation failed: ${err instanceof Error ? err.message : String(err)}`, 'snippet');
    localHasErrors = true;
  }
  return localHasErrors;
}

export function runAudit() {
  hasErrors = false;
  const files = getFilesToAudit();
  const fileHeadings = {};
  
  // 1. Build a map of headings for each file and check for placeholders
  for (const file of files) {
    const filePath = path.join(repoRoot, file);
    if (!fs.existsSync(filePath)) {
      reportError(file, `File does not exist at ${filePath}`, 'missingFile');
      continue;
    }
    const { content } = getParsedFile(file);
    checkPublishApproved(file, content);
    checkPlaceholders(file, content);
    fileHeadings[file] = buildFileHeadings(file, content);
  }
  
  // 2 & 3. Extract and validate links
  for (const file of files) {
    const filePath = path.join(repoRoot, file);
    if (!fs.existsSync(filePath)) continue;
    const { content } = getParsedFile(file);
    verifyLinks(file, content, fileHeadings);
  }
  
  // 3. Extract and verify TypeScript/TSX code blocks
  checkCodeSnippets(files);
  
  if (hasErrors) {
    process.exit(1);
  } else {
    console.log('Markdown audit passed successfully.');
    process.exit(0);
  }
}

// Only run automatically if executed directly
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('audit_markdown.js'))) {
  runAudit();
}
