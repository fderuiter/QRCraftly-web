import fs from 'fs';
import path from 'path';

/**
 * Directories no auditor reads: dependencies, VCS data, build and coverage output, and agent
 * workspaces (#1617). One list, so a new generated folder is added once.
 */
export const DEFAULT_EXCLUDE_DIRS = Object.freeze([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.gemini',
  '.claude',
  '.agents',
]);

/**
 * Every file under `root`, depth first, as paths joined onto `root` (#1618).
 * A missing root gives an empty list.
 * @param {string} root
 * @param {{ exts?: string[], excludeDirs?: string[] }} [options]
 *   exts: keep only files ending in one of these (for example '.js'); excludeDirs: directory names to
 *   skip. Pass {@link DEFAULT_EXCLUDE_DIRS} (or a list built from it) to skip the shared set.
 * @returns {string[]}
 */
export function walkFiles(root, { exts, excludeDirs = [] } = {}) {
  const results = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, name);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (!excludeDirs.includes(name)) visit(fullPath);
      } else if (stat.isFile() && (!exts || exts.some((ext) => name.endsWith(ext)))) {
        results.push(fullPath);
      }
    }
  };
  if (fs.existsSync(root)) visit(root);
  return results;
}
