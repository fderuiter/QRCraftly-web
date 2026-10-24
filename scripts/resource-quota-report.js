/**
 * Resource quota report (#1618): how close the built site is to the Workers Static Assets
 * limits, posted on every PR by the Build job (main.yml, "Generate Resource Quota Report").
 *
 * Production is Workers Static Assets with no Worker script (ADR 0012). The limits checked are
 * the per-version file count on the Workers Free plan and the size of one asset; see
 * https://developers.cloudflare.com/workers/static-assets/#limits (checked 2026-10-24).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { walkFiles } from './utils/sourceFiles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist/client');
const REPORT_FILE = path.join(ROOT, 'quota-report.md');

/** Static assets per version on the Workers Free plan (Paid allows 100,000). */
export const MAX_FILES = 20000;
/** Largest single static asset. */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
/** A resource at or above this share of its ceiling is flagged. */
export const WARNING_PCT = 90;

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2);
const status = (pct) => (pct >= WARNING_PCT ? '⚠️ WARNING' : '✅ OK');

/**
 * Builds the report for a list of built files.
 * @param {Array<{ path: string, size: number }>} files paths as they should appear in the report
 * @returns {{ fileCount: number, totalSize: number, maxFileSize: number, maxFileName: string, fileCountPct: number, maxFilePct: number, warning: boolean, markdown: string }}
 */
export function buildQuotaReport(files) {
  let maxFileSize = 0;
  let maxFileName = '';
  let totalSize = 0;
  for (const file of files) {
    totalSize += file.size;
    if (file.size > maxFileSize) {
      maxFileSize = file.size;
      maxFileName = file.path;
    }
  }
  const fileCount = files.length;
  const fileCountPct = (fileCount / MAX_FILES) * 100;
  const maxFilePct = (maxFileSize / MAX_FILE_SIZE_BYTES) * 100;
  const warning = fileCountPct >= WARNING_PCT || maxFilePct >= WARNING_PCT;

  const markdown = `## 📊 Resource Impact Report

| Resource | Current Usage | Hard Ceiling | % Used | Status |
|---|---|---|---|---|
| **File Count** | ${fileCount} | ${MAX_FILES} | ${fileCountPct.toFixed(2)}% | ${status(fileCountPct)} |
| **Max File Size** | ${mb(maxFileSize)} MB | 25 MB | ${maxFilePct.toFixed(2)}% | ${status(maxFilePct)} |
| **Total Size** | ${mb(totalSize)} MB | N/A | N/A | ℹ️ INFO |

*(Largest file: \`${maxFileName || 'N/A'}\`)*

${warning ? `> **⚠️ WARNING:** Your changes bring the project within ${100 - WARNING_PCT}% of a Workers Static Assets hard ceiling.` : '> ✅ Resource usage is well within limits.'}
`;

  return { fileCount, totalSize, maxFileSize, maxFileName, fileCountPct, maxFilePct, warning, markdown };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const files = walkFiles(DIST_DIR).map((file) => ({
    path: path.relative(ROOT, file),
    size: fs.statSync(file).size,
  }));
  const report = buildQuotaReport(files);

  console.log(`Resource Quota Report:`);
  console.log(`Files: ${report.fileCount} / ${MAX_FILES} (${report.fileCountPct.toFixed(2)}%)`);
  console.log(`Largest File: ${report.maxFileName} - ${mb(report.maxFileSize)}MB / 25MB (${report.maxFilePct.toFixed(2)}%)`);
  console.log(`Total Size: ${mb(report.totalSize)}MB`);

  fs.writeFileSync(REPORT_FILE, report.markdown);
}
