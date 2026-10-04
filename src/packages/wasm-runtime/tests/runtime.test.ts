/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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

import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  ABI_VERSION,
  WASM_STATUS,
  WasmModuleError,
  checkStatus,
  clearWasmCache,
  compileWasmBytes,
  compileWasmUrl,
  instantiateWasm,
  resolveSameOrigin,
} from '../index';

const here = path.dirname(fileURLToPath(import.meta.url));
const selftestBytes = new Uint8Array(fs.readFileSync(path.resolve(here, '../../../wasm/selftest.wasm')));
const ORIGIN = 'https://qrcraftly.com/scanner';

async function loadSelftest() {
  return instantiateWasm(await compileWasmBytes(selftestBytes));
}

function wasmResponse(contentType: string): Response {
  return new Response(selftestBytes, { status: 200, headers: { 'content-type': contentType } });
}

/** The smallest valid module (no imports, no exports). */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** A module that imports env.f and exports nothing else. */
const IMPORTING_MODULE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x02, 0x09, 0x01, 0x03, 0x65,
  0x6e, 0x76, 0x01, 0x66, 0x00, 0x00,
]);

afterEach(() => {
  clearWasmCache();
});

describe('the self-test module through the loader', () => {
  it('speaks the loader ABI and computes CRC-32 over copied-in bytes', async () => {
    const wasm = await loadSelftest();
    expect(wasm.fn('abi_version')()).toBe(ABI_VERSION);
    const crc = wasm.withBytes(new TextEncoder().encode('123456789'), (ptr, len) => wasm.fn('selftest_crc32')(ptr, len));
    expect(crc >>> 0).toBe(0xcbf43926);
  });

  it('reads results out and reports status codes as typed errors', async () => {
    const wasm = await loadSelftest();
    const scale = wasm.fn('selftest_scale');
    const input = new Uint8Array([0, 1, 2, 0x80]);
    const out = wasm.withBytes(input, (inPtr, len) =>
      wasm.withOutput(len, (outPtr, outLen) => checkStatus(scale(inPtr, len, 2, outPtr, outLen), 'selftest_scale')),
    );
    expect(Array.from(out)).toEqual([0, 2, 4, 0x1d]);

    expect(() =>
      wasm.withBytes(input, (inPtr, len) =>
        wasm.withOutput(len, (outPtr, outLen) => checkStatus(scale(inPtr, len, 0, outPtr, outLen), 'selftest_scale')),
      ),
    ).toThrow(expect.objectContaining({ kind: 'status', status: WASM_STATUS.BAD_INPUT }));
  });

  it('turns a trap into a typed error and keeps working afterwards', async () => {
    const wasm = await loadSelftest();
    expect(() => wasm.fn('selftest_trap')()).toThrow(expect.objectContaining({ kind: 'trap' }));
    expect(wasm.fn('selftest_gf_mul')(2, 0x80)).toBe(0x1d);
  });

  it('frees input even when the callback throws, so memory is reused', async () => {
    const wasm = await loadSelftest();
    const first = wasm.alloc(16);
    wasm.free(first, 16);
    expect(() =>
      wasm.withBytes(new Uint8Array(16), () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(wasm.alloc(16)).toBe(first);
  });

  it('keeps reads valid when a large allocation grows memory', async () => {
    const wasm = await loadSelftest();
    const before = wasm.memory.buffer.byteLength;
    const big = new Uint8Array(4 * 65536).fill(7);
    const crc = wasm.withBytes(big, (ptr, len) => {
      expect(wasm.read(ptr + len - 1, 1)[0]).toBe(7);
      return wasm.fn('selftest_crc32')(ptr, len);
    });
    expect(wasm.memory.buffer.byteLength).toBeGreaterThan(before);
    expect(crc).not.toBe(0);
  });

  it('rejects missing exports and modules that do not follow the ABI', async () => {
    const wasm = await loadSelftest();
    expect(() => wasm.fn('nope')).toThrow(expect.objectContaining({ kind: 'abi' }));
    await expect(instantiateWasm(await compileWasmBytes(EMPTY_MODULE))).rejects.toMatchObject({ kind: 'abi' });
    await expect(instantiateWasm(await compileWasmBytes(IMPORTING_MODULE))).rejects.toMatchObject({ kind: 'abi' });
  });

  it('reports bytes that are not WebAssembly as a compile error', async () => {
    await expect(compileWasmBytes(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(WasmModuleError);
  });
});

describe('fetching modules', () => {
  it('only loads from the page origin', () => {
    expect(resolveSameOrigin('/assets/selftest.wasm', ORIGIN).href).toBe('https://qrcraftly.com/assets/selftest.wasm');
    expect(() => resolveSameOrigin('https://cdn.example.com/x.wasm', ORIGIN)).toThrow(
      expect.objectContaining({ kind: 'origin' }),
    );
    expect(() => resolveSameOrigin('/x.wasm', undefined)).toThrow(expect.objectContaining({ kind: 'origin' }));
  });

  it('compiles a streamed response once and serves later calls from the cache', async () => {
    const fetchImpl = vi.fn(async () => wasmResponse('application/wasm'));
    const first = await compileWasmUrl('/assets/selftest.wasm', { base: ORIGIN, fetchImpl });
    const second = await compileWasmUrl('/assets/selftest.wasm', { base: ORIGIN, fetchImpl });
    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await instantiateWasm(first)).fn('selftest_gf_mul')(3, 3)).toBe(5);
  });

  it('falls back to compiling bytes when the server sends another content type', async () => {
    const fetchImpl = vi.fn(async () => wasmResponse('application/octet-stream'));
    const module = await compileWasmUrl('/assets/selftest.wasm', { base: ORIGIN, fetchImpl });
    expect(WebAssembly.Module.exports(module).map((e) => e.name)).toContain('selftest_crc32');
  });

  it('does not cache a failed load', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(wasmResponse('application/wasm'));
    await expect(compileWasmUrl('/assets/selftest.wasm', { base: ORIGIN, fetchImpl })).rejects.toMatchObject({
      kind: 'fetch',
    });
    await expect(compileWasmUrl('/assets/selftest.wasm', { base: ORIGIN, fetchImpl })).resolves.toBeInstanceOf(
      WebAssembly.Module,
    );
  });

  it('reports a streamed response that is not WebAssembly as a compile error', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/wasm' } }),
    );
    await expect(compileWasmUrl('/assets/bad.wasm', { base: ORIGIN, fetchImpl })).rejects.toMatchObject({
      kind: 'compile',
    });
  });
});
