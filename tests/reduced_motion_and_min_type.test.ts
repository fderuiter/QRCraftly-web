import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(root, ...relative.split('/')), 'utf8');

/** An `animate-*` utility with no variant prefix (so it ignores prefers-reduced-motion). */
const UNGUARDED_ANIMATION = /(?<![\w:-])animate-(?:spin|pulse|ping|bounce)\b/;

/** Arbitrary sub-12px text sizes, below the `text-xs` floor for readable UI copy. */
const TINY_TEXT = /\btext-\[(?:[0-9]|1[01])px\]/;

describe('Reduced motion guards (WCAG 2.3.3)', () => {
  it.each([
    'src/components/inputs/UrlInput.tsx',
  ])('%s gates every animation behind motion-safe:', file => {
    const offending = read(file)
      .split(/\r?\n/)
      .filter(line => UNGUARDED_ANIMATION.test(line));
    expect(offending).toEqual([]);
  });

  it('gates the receiver compilation-status spinner behind motion-safe:', () => {
    const lines = read('src/components/transfer/receive/ReceiveTelemetry.tsx').split(/\r?\n/);
    const start = lines.findIndex(line => line.includes('data-testid="compilation-status"'));
    expect(start).toBeGreaterThan(-1);
    const block = lines.slice(start, start + 2);
    expect(block.some(line => UNGUARDED_ANIMATION.test(line))).toBe(false);
    expect(block.join('\n')).toContain('motion-safe:animate-pulse');
    expect(block.join('\n')).toContain('motion-safe:animate-spin');
  });
});

describe('Minimum text size', () => {
  it.each(['src/components/inputs/UrlInput.tsx', 'src/components/ui/PrimaryNav.tsx'])(
    '%s uses no text smaller than text-xs',
    file => {
      const offending = read(file)
        .split(/\r?\n/)
        .filter(line => TINY_TEXT.test(line));
      expect(offending).toEqual([]);
    }
  );
});
