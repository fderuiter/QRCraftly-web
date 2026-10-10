import fs from 'fs';
import path from 'path';
import type { Plugin } from 'vite';
import { buildManifest, docsPublicDir, securityDocPath } from '../compile_docs_manifest.js';

export const DOCS_MANIFEST_ID = 'virtual:docs-manifest';
const RESOLVED_ID = `\0${DOCS_MANIFEST_ID}`;

/**
 * Serves the public docs (`docs/public/*.md` and `docs/SECURITY.md`) to the /security page as
 * `virtual:docs-manifest`, compiled when the build, dev server or test run loads it. Nothing is
 * written to disk, so docs changes in two pull requests never conflict in a generated file.
 * @returns The Vite plugin.
 */
export function docsManifest(): Plugin {
  return {
    name: 'qrcraftly:docs-manifest',
    resolveId(id) {
      return id === DOCS_MANIFEST_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      // Rebuild in `pnpm dev` when a published doc changes.
      for (const file of fs.readdirSync(docsPublicDir)) {
        if (file.endsWith('.md')) this.addWatchFile(path.join(docsPublicDir, file));
      }
      this.addWatchFile(securityDocPath);
      return `export default ${JSON.stringify(buildManifest())};`;
    },
  };
}
