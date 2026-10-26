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
  'markup parser': /new DOMParser\b|parseInertMarkup\(/,
  'script URL': /new (?:Shared)?Worker\(|\.register\(/,
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
    'src/packages/qr-export/lib/sceneReader.ts', // our own SVG export, read for EPS and PDF
    'src/packages/core/security.ts', // parseInertMarkup, the one DOMParser, and sanitizeSvg
  ],
  'script URL': [
    'src/hooks/useServiceWorkerUpdate.ts', // /sw.js, through trustedScriptUrl (the rest through sameOriginWorker)
    'src/packages/optical-scanner/lib/workerRunner.ts', // scanner worker
    'src/packages/optical-transfer/lib/receiver/media.ts', // reassembly and tiles workers
    'src/packages/optical-transfer/lib/sender/workers.ts', // slice worker
    'src/packages/qr-matrix/lib/workerFactory.ts', // matrix and maze workers
    'src/packages/scannability/lib/workerFactory.ts', // scannability worker
    'src/utils/imageResizeHelper.ts', // image resize worker
  ],
  'object URL': [
    'src/components/transfer/TransferComplete.tsx', // received file: safe types only open in a tab
    'src/packages/optical-transfer/lib/receiver/useFrameSource.ts', // a chosen video file
    'src/packages/qr-export/lib/svgExport.ts', // rasterises our own SVG
    'src/utils/blobHandoff.ts', // handOffBlob: blob: URL downloads
    'src/utils/imageResizeHelper.ts', // decodes an uploaded image
  ],
  'new window or navigation': [
    'src/utils/blobHandoff.ts', // handOffBlob: opens a blob: URL of a safe received type
    'src/components/arcade/StressTestButton.tsx', // fixed path /arcade
    'src/components/wallet/GooglePassPanel.tsx', // fixed https://pay.google.com/ prefix plus our own JWT, after a confirmation
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

  it('passes every worker and service worker script URL through the Trusted Types policy (#1172)', () => {
    // Each `new Worker(new URL(...))` keeps the text Vite looks for, with `Worker` bound to sameOriginWorker() in the same block.
    const workers = files.flatMap(({ file, text }) =>
      [...text.matchAll(/new (?:Shared)?Worker\(/g)].map((match) => ({ file, before: text.slice(Math.max(0, text.lastIndexOf('{', match.index)), match.index) }))
    );
    expect(workers).toHaveLength(8);
    expect(workers.filter(({ before }) => !/const Worker = sameOriginWorker\(\);/.test(before)).map(({ file }) => file)).toEqual([]);
    const registrations = files.flatMap(({ file, text }) => (text.match(/\.register\([^)\n]*\)?/g) ?? []).map((call) => ({ file, call })));
    expect(registrations).toEqual([{ file: 'src/hooks/useServiceWorkerUpdate.ts', call: ".register(trustedScriptUrl('/sw.js')" }]);
  });

  it('keeps DOMParser behind parseInertMarkup, the one place that holds the Trusted Types HTML rule (#1172)', () => {
    expect(files.filter(({ text }) => /new DOMParser\b/.test(text)).map(({ file }) => file)).toEqual(['src/packages/core/security.ts']);
  });

  it('keeps SanitizedHtml for build-time content on the security page only', () => {
    const users = files.filter(({ file, text }) => file !== 'src/components/ui/SanitizedHtml.tsx' && /<SanitizedHtml\b/.test(text)).map(({ file }) => file);
    expect(users).toEqual(['src/pages/security/+Page.tsx']);
  });
});
