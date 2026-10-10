import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { tokenize, render, createSlugger, escapeTextContent, slugify } from './utils/markdown/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
export const docsPublicDir = path.join(repoRoot, 'docs', 'public');
export const securityDocPath = path.join(repoRoot, 'docs', 'SECURITY.md');

export function isQuarantined(fileOrPath) {
  if (!fileOrPath) return false;
  const absolutePath = path.isAbsolute(fileOrPath) ? fileOrPath : path.resolve(repoRoot, fileOrPath);
  const relativeFromRoot = path.relative(repoRoot, absolutePath);
  const pathParts = relativeFromRoot.split(/[/\\]/);
  return pathParts.some(part => {
    const lower = part.toLowerCase();
    return lower === 'internal' || lower === 'quarantine' || lower === 'quarantined';
  });
}

/**
 * Whether a document's frontmatter marks it as internal developer documentation.
 * @param {Record<string, unknown>} frontmatter Parsed frontmatter.
 * @returns {boolean} True when `audience: developers` (or `developer`) is set.
 */
export function isDeveloperAudience(frontmatter) {
  const audience = typeof frontmatter.audience === 'string' ? frontmatter.audience.trim().toLowerCase() : '';
  return audience === 'developers' || audience === 'developer';
}

/**
 * Lines taken by the frontmatter block, so parser errors can name the line in the file.
 * @param {string} content Full file content.
 * @param {string} body Content after the frontmatter.
 * @returns {number} Number of lines before the body.
 */
function countFrontmatterLines(content, body) {
  return content.slice(0, content.length - body.length).split(/\r?\n/).length - 1;
}

export function extractTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1] : 'Untitled Document';
}

export function parseFrontmatter(content) {
  // A standard frontmatter block starts at the very beginning of the file.
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  const rawYaml = match[1];
  const body = content.slice(match[0].length);

  const frontmatter = {};
  const lines = rawYaml.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex !== -1) {
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();

      // Identify and strip trailing inline comment (indicated by '#')
      let commentIndex = -1;
      if (value.startsWith('"')) {
        const lastQuoteIndex = value.lastIndexOf('"');
        if (lastQuoteIndex > 0) {
          const hashIndex = value.indexOf('#', lastQuoteIndex + 1);
          if (hashIndex !== -1) {
            commentIndex = hashIndex;
          }
        }
      } else if (value.startsWith("'")) {
        const lastQuoteIndex = value.lastIndexOf("'");
        if (lastQuoteIndex > 0) {
          const hashIndex = value.indexOf('#', lastQuoteIndex + 1);
          if (hashIndex !== -1) {
            commentIndex = hashIndex;
          }
        }
      } else {
        commentIndex = value.indexOf('#');
      }

      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim();
      }

      // Strip surrounding quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      const lowerKey = key.toLowerCase();
      const lowerValue = value.toLowerCase();

      if (lowerKey === 'draft' || lowerKey === 'publish-approved') {
        const canonicalKey = lowerKey === 'draft' ? 'draft' : 'publish-approved';
        if (['true', 'yes', 'on', '1'].includes(lowerValue)) {
          frontmatter[key] = true;
          if (key !== canonicalKey) {
            frontmatter[canonicalKey] = true;
          }
        } else if (['false', 'no', 'off', '0'].includes(lowerValue)) {
          frontmatter[key] = false;
          if (key !== canonicalKey) {
            frontmatter[canonicalKey] = false;
          }
        } else {
          frontmatter[key] = value;
        }
      } else {
        if (lowerValue === 'true') {
          frontmatter[key] = true;
        } else if (lowerValue === 'false') {
          frontmatter[key] = false;
        } else {
          frontmatter[key] = value;
        }
      }
    }
  }

  return { frontmatter, body };
}

/**
 * Renders one document for the /security page: the H1 is dropped (the page shows the title),
 * headings move down one level and get unique `<docId>-<slug>` ids, and in-page and cross-doc
 * links point at those ids.
 * @param {{ id: string, content: string, source?: string, lineOffset?: number }} doc The document.
 * @param {{ id: string, filename: string }[]} manifest Every published document (link targets).
 * @returns {string} HTML.
 */
export function compileDocHtml(doc, manifest) {
  const contentWithoutH1 = doc.content.replace(/^#\s+.+$/m, '');
  const slugger = createSlugger();
  const file = doc.source ? path.relative(repoRoot, doc.source).split(path.sep).join('/') : undefined;
  const tokens = tokenize(contentWithoutH1, { file, lineOffset: doc.lineOffset });
  return render(tokens, {
    heading({ text, depth }) {
      const newDepth = Math.min(depth + 1, 6);
      const id = `${doc.id}-${slugger.slug(text)}`;
      return `<h${newDepth} id="${id}">${escapeTextContent(text)}</h${newDepth}>`;
    },
    link(href) {
      if (href.startsWith('#')) {
        const fragment = href.slice(1);
        return fragment ? `#${doc.id}-${slugify(fragment)}` : href;
      }
      const [targetFile, hash] = href.split('#');
      const baseName = targetFile.split('/').pop() || targetFile;
      const targetDoc = manifest.find(d => d.filename && d.filename.toLowerCase() === baseName.toLowerCase());
      if (!targetDoc) return href;
      return hash ? `#${targetDoc.id}-${slugify(hash)}` : `#${targetDoc.id}`;
    }
  });
}

/**
 * Compiles the public docs into the manifest the /security page renders. The Vite plugin in
 * `scripts/vite/docsManifest.ts` serves the result as `virtual:docs-manifest` at build, dev and
 * test time, so no generated copy is committed (and none can conflict in a merge).
 *
 * @param {string} [inputDir] Folder of Markdown sources.
 * @returns {{ id: string, filename: string, title: string, html: string }[]} The published documents.
 */
export function buildManifest(inputDir = docsPublicDir) {
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Docs directory ${inputDir} does not exist.`);
  }

  const files = fs.readdirSync(inputDir).filter(file => file.endsWith('.md'));
  const manifest = [];

  for (const file of files) {
    const filePath = path.join(inputDir, file);
    if (isQuarantined(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    if (inputDir === docsPublicDir) {
      if (frontmatter['publish-approved'] !== true || frontmatter.draft === true) {
        continue;
      }
    } else {
      // Skip compiling files where draft frontmatter flag is explicitly true
      if (frontmatter.draft === true) {
        continue;
      }
    }

    // Developer-facing references (style guide, UI catalog, capacity planning) stay in the
    // repository but are not published to end users on the /security page.
    if (isDeveloperAudience(frontmatter)) {
      continue;
    }

    const title = extractTitle(body);
    
    // Unique ID/slug could be based on filename without extension
    const id = path.parse(file).name.toLowerCase();

    manifest.push({
      id,
      filename: file,
      title,
      content: body,
      source: filePath,
      lineOffset: countFrontmatterLines(content, body)
    });
  }

  // If we are compiling the standard docs folder, explicitly include docs/SECURITY.md
  if (inputDir === docsPublicDir) {
    const securityPath = securityDocPath;
    if (fs.existsSync(securityPath) && !isQuarantined(securityPath)) {
      const content = fs.readFileSync(securityPath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(content);
      if (frontmatter.draft !== true) {
        const title = extractTitle(body);
        manifest.push({
          id: 'security',
          filename: 'SECURITY.md',
          title,
          content: body,
          source: securityPath,
          lineOffset: countFrontmatterLines(content, body)
        });
      }
    }
  }

  for (const doc of manifest) {
    doc.html = compileDocHtml(doc, manifest);
  }
  for (const doc of manifest) {
    delete doc.content;
    delete doc.source;
    delete doc.lineOffset;
  }

  return manifest;
}
