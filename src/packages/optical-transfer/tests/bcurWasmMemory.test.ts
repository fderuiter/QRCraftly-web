/*
 * The WebAssembly BC-UR decoder reuses the memory each frame frees (#1611). Its handle lives for
 * the whole transfer, and the old bump allocator only rewound once nothing was live, so every frame
 * added to linear memory. This drives the committed module directly and measures memory_size.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { instantiateWasmSync, type WasmInstance } from '@/packages/wasm-runtime';
import { BcUrEncoder } from '../bcur';

function instantiate(): WasmInstance {
  const bytes = readFileSync(new URL('../../../wasm/fountain-bcur.wasm', import.meta.url));
  return instantiateWasmSync(new WebAssembly.Module(bytes));
}

describe('WebAssembly BC-UR decoder memory (#1611)', () => {
  it('stays flat over 10,000 frames while the decoder handle is alive', () => {
    const wasm = instantiate();
    const encoder = BcUrEncoder.forBytes(new Uint8Array(20_000).map((_, i) => i * 7), 100);
    // 100 of the 200 plain parts, sent over and over: the transfer never completes, so the
    // handle and everything it holds stay live for the whole run.
    const frames = Array.from({ length: 100 }, () => new TextEncoder().encode(encoder.nextPart()));
    const handle = wasm.fn('bcur_decoder_new')();
    const ingestStr = wasm.fn('bcur_decoder_ingest_str');
    // withBytes allocates the frame, calls in and frees it, as the decoder wrapper does.
    const ingest = (frame: Uint8Array) => wasm.withBytes(frame, (ptr, len) => ingestStr(handle, ptr, len));

    for (let i = 0; i < 100; i++) expect(ingest(frames[i])).toBe(1);
    const after100 = wasm.memory.buffer.byteLength;
    for (let i = 100; i < 10_000; i++) expect(ingest(frames[i % 100])).toBe(1);
    const after10k = wasm.memory.buffer.byteLength;

    expect(after10k).toBeLessThanOrEqual(after100 * 2);
    wasm.fn('bcur_decoder_free')(handle);
  });
});
