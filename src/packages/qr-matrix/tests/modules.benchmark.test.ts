import { describe, test, expect } from 'vitest';
import { getLogoMetrics, renderModules } from '../index';
import { DEFAULT_CONFIG } from '@/constants';
import { type QRConfig, QRErrorCorrectionLevel, QRStyle } from '@/types';

describe('Performance Benchmark: renderModules', () => {
  const runBenchmark = (style: QRStyle, name: string) => {
    const isCI = !!(process.env.CI || process.env.GITHUB_ACTIONS || process.env.VITEST_COVERAGE || process.env.COVERAGE || process.env.SKIP_BENCHMARKS || process.argv.some(arg => arg.includes('coverage')));
    const moduleCount = 53;
    const cellSize = 10;
    const iterations = isCI ? 0 : 500;

    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      style,
      logoUrl: 'https://example.com/logo.png',
      logoSize: 0.2,
      logoPadding: 1,
      logoPaddingStyle: 'circle',
      errorCorrectionLevel: QRErrorCorrectionLevel.H
    };

    const modules = {
      size: moduleCount,
      get: (r: number, c: number) => (r + c) % 2 === 0
    };

    const logoMetrics = getLogoMetrics(config, moduleCount, cellSize);

    const ctx = {
      fillStyle: '',
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      rect: () => {},
      arc: () => {},
      roundRect: () => {},
      quadraticCurveTo: () => {}
    } as any;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      renderModules(ctx, modules as any, config, 0, 0, cellSize, moduleCount, logoMetrics);
    }
    const end = performance.now();

    if (!isCI) {
      console.log(`${name} Total duration for ${iterations} iterations: ${(end - start).toFixed(2)}ms`);
      expect(end - start).toBeLessThan(2500);
    } else {
      console.log(`${name} benchmark loop skipped in CI`);
    }
  };

  test('Benchmark HIVE execution time', () => runBenchmark(QRStyle.HIVE, 'HIVE'), 10000);
  test('Benchmark STARBURST execution time', () => runBenchmark(QRStyle.STARBURST, 'STARBURST'), 10000);
  test('Benchmark MODERN execution time', () => runBenchmark(QRStyle.MODERN, 'MODERN'), 10000);
  test('Benchmark CIRCUIT execution time', () => runBenchmark(QRStyle.CIRCUIT, 'CIRCUIT'), 10000);
  test('Benchmark SWISS execution time', () => runBenchmark(QRStyle.SWISS, 'SWISS'), 10000);
  test('Benchmark FLUID execution time', () => runBenchmark(QRStyle.FLUID, 'FLUID'), 10000);
  test('Benchmark STANDARD execution time', () => runBenchmark(QRStyle.STANDARD, 'STANDARD'), 10000);
});

