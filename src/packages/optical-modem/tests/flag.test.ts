import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOpticalModemEnabled } from '../flag';

describe('optical modem flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off unless the value is exactly "true"', () => {
    expect(isOpticalModemEnabled({ viteValue: undefined, nodeValue: undefined })).toBe(false);
    expect(isOpticalModemEnabled({ viteValue: 'false', nodeValue: undefined })).toBe(false);
    expect(isOpticalModemEnabled({ viteValue: '1', nodeValue: undefined })).toBe(false);
    expect(isOpticalModemEnabled({ viteValue: 'TRUE', nodeValue: undefined })).toBe(false);
    expect(isOpticalModemEnabled({ viteValue: 'true', nodeValue: undefined })).toBe(true);
    expect(isOpticalModemEnabled({ viteValue: undefined, nodeValue: 'true' })).toBe(true);
  });

  it('prefers the build-time value over the Node environment', () => {
    expect(isOpticalModemEnabled({ viteValue: 'false', nodeValue: 'true' })).toBe(false);
  });

  it('is off by default and reads the build environment when asked', () => {
    expect(isOpticalModemEnabled()).toBe(false);
    vi.stubEnv('VITE_OPTICAL_MODEM', 'true');
    expect(isOpticalModemEnabled()).toBe(true);
  });
});
