import { describe, test, expect } from 'vitest';
import { getLogoMetrics, getIsCoveredByLogo } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import { type QRConfig, QRErrorCorrectionLevel } from '@/types';

describe('Performance Benchmark: getIsCoveredByLogo', () => {
  test('Benchmark execution time', () => {
    const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.VITEST_COVERAGE || process.env.COVERAGE || process.argv.some(arg => arg.includes('coverage')));
    const moduleCount = 53;
    const cellSize = 10;
    const iterations = isCI ? 0 : 50000;

    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      logoUrl: 'https://example.com/logo.png',
      logoSize: 0.2,
      logoPadding: 1,
      logoPaddingStyle: 'circle',
      errorCorrectionLevel: QRErrorCorrectionLevel.H
    };

    const metrics = getLogoMetrics(config, moduleCount, cellSize);
    const isCovered = getIsCoveredByLogo(config, moduleCount, metrics);

    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          isCovered(r, c);
        }
      }
    }

    const end = performance.now();
    const duration = end - start;

    if (!isCI) {
      console.log(`\nBenchmark Results:`);
      console.log(`Total duration for ${iterations} iterations (x ${moduleCount*moduleCount} calls): ${duration.toFixed(2)}ms`);
      console.log(`Average time per iteration: ${(duration / iterations).toFixed(4)}ms`);
      console.log(`Average time per call: ${(duration / (iterations * moduleCount * moduleCount)).toFixed(6)}ms\n`);

      expect(duration).toBeLessThan(1200);
    } else {
      console.log('Skipped logo coverage benchmark loop and assertion in CI');
    }
  }, 10000);
});

