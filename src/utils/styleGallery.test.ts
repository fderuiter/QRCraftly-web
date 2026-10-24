import { describe, expect, it } from 'vitest';
import { PRESET_COLORS } from '../constants';
import { LOW_RELIABILITY_PATTERNS } from '@/packages/scannability';
import { QRStyle } from '@/packages/core/types';
import { styleScanTone, surpriseStyle, type StyleChoice } from './styleGallery';

/** Small seeded generator (mulberry32) so the test is repeatable. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const classic: StyleChoice = { style: QRStyle.STANDARD, fgColor: '#000000', bgColor: '#ffffff', eyeColor: '#000000' };

describe('styleScanTone', () => {
  it('trusts high contrast with a simple pattern', () => {
    expect(styleScanTone(classic)).toBe('good');
  });

  it('flags low contrast', () => {
    expect(styleScanTone({ ...classic, fgColor: '#cccccc' })).toBe('check');
    expect(styleScanTone({ ...classic, eyeColor: '#dddddd' })).toBe('check');
  });

  it('flags the complex patterns', () => {
    for (const style of LOW_RELIABILITY_PATTERNS) expect(styleScanTone({ ...classic, style })).toBe('check');
  });
});

describe('surpriseStyle', () => {
  it('only picks looks expected to scan, over 200 seeds', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const pick = surpriseStyle(seeded(seed), classic);
      expect(styleScanTone(pick)).toBe('good');
      expect(LOW_RELIABILITY_PATTERNS).not.toContain(pick.style);
      expect(PRESET_COLORS.some((p) => p.fg === pick.fgColor && p.bg === pick.bgColor && p.eye === pick.eyeColor)).toBe(true);
    }
  });

  it('differs from the current look', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      expect(surpriseStyle(seeded(seed), classic)).not.toEqual(classic);
    }
  });

  it('can reach more than one look', () => {
    const picks = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(surpriseStyle(seeded(i + 1)))));
    expect(picks.size).toBeGreaterThan(5);
  });
});
