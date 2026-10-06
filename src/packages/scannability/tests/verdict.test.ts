import { describe, expect, it } from 'vitest';
import { getScanAdvice, getScanChecks, getScanVerdict, type ExportRiskPolicyInput, type ScanVerdict } from '../index';

describe('getScanVerdict', () => {
  const cases: [ExportRiskPolicyInput['status'], ExportRiskPolicyInput['health'], ScanVerdict | null][] = [
    ['idle', undefined, null],
    ['checking', undefined, 'checking'],
    ['physical-pass', undefined, 'reliable'],
    ['physical-pass', { score: 100, warnings: [] }, 'reliable'],
    ['physical-pass', { score: 90, warnings: [] }, 'reliable'],
    ['physical-pass', { score: 89, warnings: [] }, 'fragile'],
    ['physical-pass', { score: 95, warnings: ['Contrast ratio is low'] }, 'fragile'],
    ['physical-pass', { score: 95, warnings: [], criticalWarnings: ['critical-contrast'] }, 'unreliable'],
    ['digital-pass', { score: 100, warnings: [] }, 'fragile'],
    ['fail', { score: 100, warnings: [] }, 'unreliable'],
    ['fail', undefined, 'unreliable'],
  ];
  it.each(cases)('%s with %j is %s', (status, health, expected) => {
    expect(getScanVerdict({ status, health })).toBe(expected);
  });
});

describe('getScanAdvice', () => {
  it('gives no advice for a reliable design', () => {
    expect(getScanAdvice({ status: 'physical-pass', health: { score: 100, warnings: [] } })).toBeNull();
  });

  it.each([
    ['Contrast ratio is critically low', 'M', 'increase-contrast'],
    ['Contrast ratio is low', 'M', 'increase-contrast'],
    ['Local contrast drop detected across 4 module zones', 'M', 'raise-error-correction'],
    ['Local contrast drop detected across 4 module zones', 'H', 'standard-pattern'],
    ['Pattern complexity too high for current contrast', 'M', 'standard-pattern'],
    ['Logo size might obscure too much data', 'M', 'smaller-logo'],
    ['Low error correction with logo', 'L', 'raise-error-correction'],
  ])('maps "%s" (EC %s) to the %s fix in plain words', (warning, errorCorrectionLevel, fix) => {
    const advice = getScanAdvice({ status: 'physical-pass', health: { score: 70, warnings: [warning] }, errorCorrectionLevel });
    expect(advice?.fix).toBe(fix);
    expect(advice?.message).not.toMatch(/module zone|ratio/i);
  });

  it.each([
    ['M', 'raise-error-correction'],
    ['H', 'standard-pattern'],
  ])('offers a print fix and a camera test for a screen-only pass (EC %s)', (errorCorrectionLevel, fix) => {
    const advice = getScanAdvice({ status: 'digital-pass', health: { score: 100, warnings: [] }, errorCorrectionLevel });
    expect(advice?.fix).toBe(fix);
    expect(advice?.message).toMatch(/blur away.*phone camera/);
  });

  it('suggests contrast for a failure without warnings', () => {
    expect(getScanAdvice({ status: 'fail' })?.fix).toBe('increase-contrast');
  });
});

describe('getScanChecks', () => {
  it('lists what was tested', () => {
    expect(getScanChecks('checking')).toEqual([]);
    expect(getScanChecks('physical-pass').every((c) => c.passed)).toBe(true);
    expect(getScanChecks('digital-pass')).toEqual([
      { label: 'Screen scan', passed: true },
      { label: 'Print simulation', passed: false },
    ]);
    expect(getScanChecks('fail').some((c) => c.passed)).toBe(false);
  });
});
