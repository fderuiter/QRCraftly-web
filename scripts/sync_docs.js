import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.join(__dirname, '..');

export const DEFAULT_UI_DIRS = [
  path.join(defaultRepoRoot, 'src/components/ui'),
  path.join(defaultRepoRoot, 'src/components/inputs'),
  path.join(defaultRepoRoot, 'src/components/style-controls')
];

export const DEFAULT_CATALOG_PATH = path.join(defaultRepoRoot, 'docs/public/UI_CATALOG.md');

/**
 * Extracts JSDoc description from component file content if present.
 * @param {string} sourceCode 
 * @returns {string|null}
 */
export function extractJsDocDescription(sourceCode) {
  // Look for block comment immediately preceding an export or component declaration
  const jsdocMatch = sourceCode.match(/\/\*\*([^*]|\*(?!\/))*\*\/\s*(?:export\s+)?(?:default\s+)?(?:const|function|class)\s+([A-Za-z0-9_]+)/);
  if (jsdocMatch) {
    const rawComment = jsdocMatch[0].match(/\/\*\*([\s\S]*?)\*\//)[1];
    const rawLines = rawComment.split(/\r?\n/);
    const cleanedLines = rawLines
      .map(line => line.replace(/^\s*\* ?/, '').trim())
      .filter(line => line.length > 0 && !line.startsWith('@') && !line.startsWith('/'));
    if (cleanedLines.length > 0) {
      return cleanedLines.join(' ');
    }
  }
  return null;
}

/**
 * Parses markdown sections from UI_CATALOG.md.
 */
function parseCatalogSections(catalogContent) {
  const lines = catalogContent.split(/\r?\n/);
  const sections = [];
  let currentSection = { heading: null, lines: [], before: true };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentSection.heading || currentSection.lines.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { heading: line, lines: [], before: false };
    } else {
      currentSection.lines.push(line);
    }
  }
  if (currentSection.heading || currentSection.lines.length > 0) {
    sections.push(currentSection);
  }
  return sections;
}

/**
 * Synchronizes UI components with docs/public/UI_CATALOG.md.
 * 
 * @param {string[]} uiDirs Array of directory paths
 * @param {string} catalogPath Path to UI_CATALOG.md
 * @param {string} [_repoRoot] Optional repository root (currently unused)
 * @returns {{ changed: boolean, details: string[] }}
 */
export function syncUICatalog(
  uiDirs = DEFAULT_UI_DIRS,
  catalogPath = DEFAULT_CATALOG_PATH,
  _repoRoot = defaultRepoRoot
) {
  const details = [];
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`UI Catalog file not found: ${catalogPath}`);
  }

  const catalogContent = fs.readFileSync(catalogPath, 'utf8');
  const sections = parseCatalogSections(catalogContent);

  // Map directory segments to headings
  const segmentToDir = {};
  for (const dir of uiDirs) {
    // Match on the directory's own name, not the absolute path, so parent folders
    // (for example a home directory containing "ui") never change the mapping.
    const base = path.basename(dir.replace(/\\/g, '/').replace(/\/+$/, '')).toLowerCase();
    if (base === 'style-controls') {
      segmentToDir['style-controls'] = dir;
    } else if (base === 'inputs') {
      segmentToDir['inputs'] = dir;
    } else if (base === 'ui') {
      segmentToDir['ui'] = dir;
    } else if (base === 'components') {
      segmentToDir['components'] = dir;
    }
  }

  let catalogModified = false;

  for (const section of sections) {
    if (!section.heading) continue;

    const headingLower = section.heading.replace(/\\/g, '/').toLowerCase();
    let targetDir = null;
    if (headingLower.includes('`src/components/`')) {
      targetDir = segmentToDir['components'];
    } else if (headingLower.includes('style-controls')) {
      targetDir = segmentToDir['style-controls'];
    } else if (headingLower.includes('inputs')) {
      targetDir = segmentToDir['inputs'];
    } else if (
      (headingLower.includes('/ui/') || headingLower.includes('components/ui') || /\bui\b/.test(headingLower)) &&
      !headingLower.includes('guidelines') &&
      !headingLower.includes('guardrails') &&
      !headingLower.includes('catalog')
    ) {
      targetDir = segmentToDir['ui'];
    }

    if (!targetDir || !fs.existsSync(targetDir)) {
      continue;
    }

    // Read component files from disk
    const diskFiles = fs.readdirSync(targetDir);
    const componentFiles = diskFiles
      .filter(f => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
      .sort((a, b) => a.localeCompare(b));

    // Map component name -> entry in catalog section
    // Format: - **Name** (`Name.tsx` / `Name.test.tsx`): Description
    // or: - **Name** (`Name.tsx`): Description
    const entryRegex = /^\s*-\s*\*\*([A-Za-z0-9_]+)\*\*\s*(\([^)]+\)):\s*(.*)$/;
    
    // Parse existing entries in section
    const existingEntries = new Map();
    const nonEntryLines = [];

    for (const line of section.lines) {
      const match = line.match(entryRegex);
      if (match) {
        existingEntries.set(match[1], {
          name: match[1],
          ref: match[2],
          desc: match[3],
          raw: line
        });
      } else {
        nonEntryLines.push(line);
      }
    }

    const updatedEntries = new Map(existingEntries);

    // Prune entries that no longer exist on disk
    for (const [name] of existingEntries) {
      if (!componentFiles.includes(`${name}.tsx`)) {
        updatedEntries.delete(name);
        catalogModified = true;
        details.push(`Pruned deleted component entry: ${name}`);
      }
    }

    // Update or scaffold entries
    for (const file of componentFiles) {
      const name = file.replace('.tsx', '');
      const testFile = `${name}.test.tsx`;
      const testExists = diskFiles.includes(testFile);
      const expectedRef = testExists ? `(\`${name}.tsx\` / \`${testFile}\`)` : `(\`${name}.tsx\`)`;

      if (updatedEntries.has(name)) {
        const entry = updatedEntries.get(name);
        if (entry.ref !== expectedRef) {
          entry.ref = expectedRef;
          entry.raw = `- **${name}** ${expectedRef}: ${entry.desc}`;
          updatedEntries.set(name, entry);
          catalogModified = true;
          details.push(`Updated test reference for ${name} -> ${expectedRef}`);
        }
      } else {
        // Scaffold new entry
        const sourcePath = path.join(targetDir, file);
        const sourceCode = fs.readFileSync(sourcePath, 'utf8');
        const jsDoc = extractJsDocDescription(sourceCode);
        const desc = jsDoc || `Scaffolded entry for ${name}.`;

        const newRaw = `- **${name}** ${expectedRef}: ${desc}`;
        updatedEntries.set(name, {
          name,
          ref: expectedRef,
          desc,
          raw: newRaw
        });
        catalogModified = true;
        details.push(`Scaffolded missing component entry: ${name}`);
      }
    }

    // Reconstruct section lines sorted alphabetically
    const sortedEntries = Array.from(updatedEntries.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    // Preserve blank leading/trailing lines in nonEntryLines
    const headerLines = [];
    const trailerLines = [];
    let seenEntries = false;

    // Separate leading prose from trailing prose
    for (const line of section.lines) {
      if (line.match(entryRegex)) {
        seenEntries = true;
      } else if (!seenEntries) {
        headerLines.push(line);
      } else {
        trailerLines.push(line);
      }
    }

    // Clean up empty lines around entries
    const newSectionLines = [
      ...headerLines,
      ...sortedEntries.map(e => e.raw),
      ...trailerLines
    ];

    section.lines = newSectionLines;
  }

  if (catalogModified) {
    const newContent = sections
      .map(s => (s.heading ? `${s.heading}\n${s.lines.join('\n')}` : s.lines.join('\n')))
      .join('\n');
    fs.writeFileSync(catalogPath, newContent, 'utf8');
  }

  return { changed: catalogModified, details };
}

/**
 * Runs the full documentation synchronization engine.
 * 
 * @param {object} [options]
 * @returns {{ changed: boolean, details: string[] }}
 */
export function syncAll(options = {}) {
  const startTime = Date.now();
  console.log('🔄 Running Documentation Synchronization Engine (docs:sync)...');

  const allDetails = [];
  let anyChanged = false;

  // 1. Sync UI Catalog
  try {
    const catalogRes = syncUICatalog(
      options.uiDirs || DEFAULT_UI_DIRS,
      options.catalogPath || DEFAULT_CATALOG_PATH,
      options.root || defaultRepoRoot
    );
    if (catalogRes.changed) {
      anyChanged = true;
      allDetails.push(...catalogRes.details);
      console.log(`✅ UI Catalog synchronized: ${catalogRes.details.length} changes applied.`);
    } else {
      console.log('✅ UI Catalog is already fully synchronized.');
    }
  } catch (err) {
    console.error(`❌ UI Catalog synchronization failed: ${err.message}`);
  }

  console.log(`🎉 Documentation synchronization completed in ${Date.now() - startTime}ms.`);
  return { changed: anyChanged, details: allDetails };
}

// Run CLI if invoked directly
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('sync_docs.js'))) {
  syncAll();
}
