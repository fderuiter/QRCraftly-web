/*
    QRCraftly
    Copyright (C) 2025 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { MANIFEST_INTERVAL, OUTER_CODE_UNAVAILABLE, TRANSFER_DENSITY_PROFILES, createPrismSession, createPrng, loadFecModule } from '../index';

type Handler = (event: { data: unknown }) => Promise<void> | void;
type Posted = { type: string; [key: string]: unknown };

const globalScope = globalThis as unknown as {
  self: unknown;
  onmessage: Handler | null;
  postMessage: (message: Posted) => void;
};

// The worker's own load fails, as in a browser that cannot compile the outer code; the sender still uses the real module.
const fec = vi.hoisted(() => ({ failWorkerLoad: false }));
vi.mock('../lib/fec/codec', async (importOriginal) => {
  const actual = await importOriginal<{ loadFecModule: typeof loadFecModule }>();
  return {
    ...actual,
    loadFecModule: () => (fec.failWorkerLoad ? Promise.reject(new Error('no WebAssembly')) : actual.loadFecModule()),
  };
});

let reassemblyHandler: Handler;
const posted: Posted[] = [];

describe('Reassembly worker without the outer code', () => {
  beforeAll(async () => {
    globalScope.self = globalThis;
    globalScope.postMessage = (message: Posted) => {
      posted.push(message);
    };
    fec.failWorkerLoad = true;
    vi.resetModules();
    await import('../worker-reassembly');
    reassemblyHandler = globalScope.onmessage as Handler;
    // Let the rejected load settle before any frame arrives.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fec.failWorkerLoad = false;
  });

  it('tells the page once when a stream needs the outer code', async () => {
    const prng = createPrng(5);
    const file = Uint8Array.from({ length: 1500 }, () => Math.floor(prng() * 256));
    const profile = TRANSFER_DENSITY_PROFILES.balanced;
    const { stream, outerCode } = await createPrismSession(file, {
      fileName: 'x.bin',
      errorCorrectionLevel: profile.errorCorrectionLevel,
      maxVersion: profile.maxVersion,
      mimeType: 'application/octet-stream',
      fecModule: await loadFecModule(),
    });
    expect(outerCode).toBe('fec');

    for (let i = 0; i < MANIFEST_INTERVAL * 2 + 1; i++) {
      await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: stream.frameText(i) } });
    }

    const errors = posted.filter((message) => message.type === 'ERROR');
    expect(errors).toEqual([{ type: 'ERROR', error: OUTER_CODE_UNAVAILABLE, isFountain: true }]);
    expect(posted.some((message) => message.type === 'MANIFEST' || message.type === 'COMPLETE')).toBe(false);
  });
});
