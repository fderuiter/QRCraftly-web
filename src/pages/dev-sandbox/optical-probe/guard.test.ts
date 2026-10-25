import { afterEach, describe, expect, it, vi } from 'vitest';
import { guard } from './+guard';

/** The abort a guard threw, or null. */
function abortOf(run: () => void): { abortStatusCode?: number } | null {
  try {
    run();
    return null;
  } catch (error) {
    return (error as { _pageContextAbort?: { abortStatusCode?: number } })._pageContextAbort ?? {};
  }
}

describe('optical probe guard (#1619)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('answers 404 in a production build with the flag off', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_OPTICAL_MODEM', '');
    expect(abortOf(guard)?.abortStatusCode).toBe(404);
  });

  it('serves the probe in a production build with the flag on', () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('VITE_OPTICAL_MODEM', 'true');
    expect(abortOf(guard)).toBeNull();
  });

  it('serves the switched-off notice in development', () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('VITE_OPTICAL_MODEM', '');
    expect(abortOf(guard)).toBeNull();
  });
});
