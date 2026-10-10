import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The browser sink inventory in docs/SECURITY.md ("Browser Trust Boundaries", #1350). Every file
 * that turns text into markup, a document, a URL to open or a navigation is listed here with the
 * control that keeps it safe. A new sink fails this test until it is reviewed and added to both.
 */

const SINKS: Record<string, RegExp> = {
  'raw HTML': /dangerouslySetInnerHTML|\.innerHTML\b|outerHTML|insertAdjacentHTML|document\.write|srcdoc/,
  'markup parser': /new DOMParser\b/,
  'object URL': /URL\.createObjectURL\(/,
  'new window or navigation': /window\.open\(|location\.(assign|replace)\(|location\.href\s*=/,
  'string as code': /\beval\(|new Function\(|set(Timeout|Interval)\(\s*['"`]/,
};

/** Reviewed files per sink, with the control that applies (see docs/SECURITY.md). */
const INVENTORY: Record<string, string[]> = {
  'raw HTML': [
    'src/components/ui/JsonLdScript.tsx', // build-time data through safeJsonLdStringify
    'src/components/ui/SanitizedHtml.tsx', // build-time docs only (the /security page)
    'src/layouts/Head.tsx', // static theme script, allowed by its CSP hash
    'src/pages/security/+Page.tsx', // reads its own prerendered docs back
  ],
  'markup parser': [
    'src/hooks/useImageUpload.ts', // inert SVG document, then sanitizeSvg
    'src/packages/qr-export/lib/vectorScene.ts', // our own SVG export, read for EPS and PDF
    'src/utils/security.ts', // sanitizeSvg itself
  ],
  'object URL': [
    'src/components/transfer/TransferComplete.tsx', // received file: safe types only open in a tab
    'src/hooks/useQRDownload.ts', // downloads
    'src/packages/optical-transfer/lib/receiver/useOpticalReceiver.ts', // a chosen video file
    'src/packages/qr-export/lib/svgExport.ts', // rasterises our own SVG
    'src/utils/brandTemplateManager.ts', // template export download
    'src/utils/downloadManager.ts', // downloads
    'src/utils/imageResizeHelper.ts', // decodes an uploaded image
  ],
  'new window or navigation': [
    'src/components/arcade/StressTestButton.tsx', // fixed path /arcade
    'src/components/transfer/TransferComplete.tsx', // blob: URL of a safe received type
  ],
  'string as code': [],
};

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'tests' || entry.name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('browser sink inventory (#1350)', () => {
  const root = process.cwd();
  const files = sourceFiles(path.join(root, 'src')).map((full) => ({
    file: path.relative(root, full).split(path.sep).join('/'),
    text: fs.readFileSync(full, 'utf8'),
  }));

  for (const [sink, pattern] of Object.entries(SINKS)) {
    it(`lists every ${sink} sink in docs/SECURITY.md`, () => {
      const found = files.filter(({ text }) => pattern.test(text)).map(({ file }) => file).sort();
      expect(found).toEqual([...INVENTORY[sink]].sort());
    });
  }

  it('keeps SanitizedHtml for build-time content on the security page only', () => {
    const users = files.filter(({ file, text }) => file !== 'src/components/ui/SanitizedHtml.tsx' && /<SanitizedHtml\b/.test(text)).map(({ file }) => file);
    expect(users).toEqual(['src/pages/security/+Page.tsx']);
  });
});
