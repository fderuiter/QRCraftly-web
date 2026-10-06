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

import { describe, it, expect } from 'vitest';
import {
  FountainEncoder,
  FountainDecoder,
  FountainRateTracker,
  buildRobustSolitonCdf,
  sampleDegreeFromCdf,
  getNeighborsForSeq,
  createPrng,
  cborEncode,
  cborDecode,
  encodeBytewordsMinimal,
  decodeBytewordsMinimal,
  crc32,
  crc32Hex,
  solveGF2,
  compressForTransfer,
  decompressTransferPayload,
  sha256Hex,
  TRANSFER_DENSITY_PROFILES,
  DEFAULT_TRANSFER_DENSITY,
  resolveTransferDensity,
  estimateTransferFrames,
  MANIFEST_INTERVAL,
  type FountainDroplet,
} from '../index';

/** Deterministic pseudo-random bytes (incompressible). */
function randomBytes(length: number, seed = 1): Uint8Array {
  const prng = createPrng(seed);
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = Math.floor(prng() * 256);
  return out;
}

/** Deterministic Fisher-Yates shuffle. */
function shuffled<T>(items: T[], seed: number): T[] {
  const prng = createPrng(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('CRC-32', () => {
  it('matches the BC-UR reference vectors', () => {
    expect(crc32Hex(new TextEncoder().encode('Hello, world!'))).toBe('ebe6c6e6');
    expect(crc32Hex(new TextEncoder().encode('Wolf'))).toBe('598c84dc');
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('Bytewords (BCR-2020-012)', () => {
  it('encodes the reference vector in minimal form', () => {
    const bytes = new Uint8Array([0, 1, 2, 128, 255]);
    expect(encodeBytewordsMinimal(bytes)).toBe('aeadaolazmjendeoti');
    expect(decodeBytewordsMinimal('AEADAOLAZMJENDEOTI')).toEqual(bytes);
  });

  it('round-trips every byte value', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(decodeBytewordsMinimal(encodeBytewordsMinimal(all))).toEqual(all);
  });

  it('rejects bad checksums, unknown words and odd lengths', () => {
    const good = encodeBytewordsMinimal(new Uint8Array([1, 2, 3]));
    const tampered = good.slice(0, 2) === 'ad' ? 'ae' + good.slice(2) : 'ad' + good.slice(2);
    expect(decodeBytewordsMinimal(tampered)).toBeNull();
    expect(decodeBytewordsMinimal('qqqqqqqqqqqq')).toBeNull();
    expect(decodeBytewordsMinimal(good.slice(1))).toBeNull();
    expect(decodeBytewordsMinimal('aead')).toBeNull();
  });
});

describe('CBOR subset', () => {
  it('round-trips integers of every head width, strings, bytes and arrays', () => {
    const value = [0, 23, 24, 255, 256, 65535, 65536, 0xffffffff, 0x100000000, 'héllo', new Uint8Array([9, 8, 7]), [1, [2]]];
    const encoded = cborEncode(value);
    expect(cborDecode(encoded)).toEqual(value);
  });

  it('uses preferred serialization for small values', () => {
    expect(Array.from(cborEncode(10))).toEqual([0x0a]);
    expect(Array.from(cborEncode(500))).toEqual([0x19, 0x01, 0xf4]);
    expect(Array.from(cborEncode(new Uint8Array([1])))).toEqual([0x41, 0x01]);
    expect(Array.from(cborEncode([1, 2]))).toEqual([0x82, 0x01, 0x02]);
  });

  it('rejects malformed or unsupported input', () => {
    expect(() => cborEncode(-1)).toThrow(RangeError);
    expect(() => cborDecode(new Uint8Array([0x0a, 0x0b]))).toThrow(/trailing/);
    expect(() => cborDecode(new Uint8Array([0x42, 0x01]))).toThrow(/truncated/);
    expect(() => cborDecode(new Uint8Array([0x5f]))).toThrow(/indefinite/);
    expect(() => cborDecode(new Uint8Array([0xa0]))).toThrow(/major type/);
    expect(() => cborDecode(new Uint8Array([0x9a, 0xff, 0xff, 0xff, 0xff]))).toThrow(/array length/);
    expect(() => cborDecode(new Uint8Array([]))).toThrow(/end of input/);
    expect(() => cborDecode(new Uint8Array([0x1b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toThrow(/safe range/);
    const deep = new Uint8Array(20).fill(0x81);
    expect(() => cborDecode(deep)).toThrow(/too deep/);
  });
});

describe('Robust Soliton distribution', () => {
  it('builds a monotonic CDF ending at 1', () => {
    const cdf = buildRobustSolitonCdf(20, 0.1, 0.05);
    expect(cdf.length).toBe(20);
    expect(cdf[cdf.length - 1]).toBe(1);
    for (let i = 1; i < cdf.length; i++) expect(cdf[i]).toBeGreaterThanOrEqual(cdf[i - 1]);
    expect(Array.from(buildRobustSolitonCdf(1))).toEqual([1]);
  });

  it('samples degrees and neighbour sets deterministically', () => {
    const cdf = buildRobustSolitonCdf(50);
    expect(sampleDegreeFromCdf(cdf, 0)).toBe(1);
    expect(sampleDegreeFromCdf(cdf, 0.9999999)).toBeGreaterThan(1);
    expect(sampleDegreeFromCdf(new Float64Array([1]), 0.5)).toBe(1);
    expect(getNeighborsForSeq(3, 50)).toEqual({ degree: 1, indices: [2] });
    expect(getNeighborsForSeq(99, 1)).toEqual({ degree: 1, indices: [0] });
    const a = getNeighborsForSeq(1234, 50, cdf);
    expect(getNeighborsForSeq(1234, 50)).toEqual(a);
    expect(new Set(a.indices).size).toBe(a.degree);
    // Degree >= k selects every block
    const all = getNeighborsForSeq(1000, 2, new Float64Array([0, 0.0000001]));
    expect(all.indices).toEqual([0, 1]);
  });
});

describe('GF(2) Gaussian elimination', () => {
  it('solves a full-rank system and reports residual equations when under-determined', () => {
    const a = new Uint8Array([1, 0]);
    const b = new Uint8Array([2, 0]);
    const c = new Uint8Array([4, 0]);
    const xor = (...xs: Uint8Array[]) => xs.reduce((acc, x) => acc.map((v, i) => v ^ x[i]), new Uint8Array(2));

    const full = solveGF2(
      [
        { columns: [0, 1], data: xor(a, b) },
        { columns: [1, 2], data: xor(b, c) },
        { columns: [0, 1, 2], data: xor(a, b, c) },
      ],
      [0, 1, 2],
      2
    );
    expect(full.rank).toBe(3);
    expect(full.solved.get(0)).toEqual(a);
    expect(full.solved.get(1)).toEqual(b);
    expect(full.solved.get(2)).toEqual(c);

    const partial = solveGF2(
      [
        { columns: [0, 1], data: xor(a, b) },
        { columns: [0, 1], data: xor(a, b) },
        { columns: [5], data: c },
      ],
      [0, 1],
      2
    );
    expect(partial.rank).toBe(1);
    expect(partial.residual).toHaveLength(1);
    expect(partial.residual[0].columns.sort()).toEqual([0, 1]);
  });

  it('handles more than 32 unknowns across coefficient words', () => {
    const n = 70;
    const blocks = Array.from({ length: n }, (_, i) => new Uint8Array([i, 255 - i]));
    // Chain equations x_i ^ x_{i+1} plus one anchor x_{n-1}
    const equations = [];
    for (let i = 0; i < n - 1; i++) {
      equations.push({ columns: [i, i + 1], data: blocks[i].map((v, j) => v ^ blocks[i + 1][j]) });
    }
    equations.push({ columns: [n - 1], data: blocks[n - 1] });
    const result = solveGF2(equations, Array.from({ length: n }, (_, i) => i), 2);
    expect(result.rank).toBe(n);
    for (let i = 0; i < n; i++) expect(result.solved.get(i)).toEqual(blocks[i]);
  });
});

describe('Fountain decoder', () => {
  it('encodes and decodes a single-block payload (K = 1)', () => {
    const original = new TextEncoder().encode('Small payload');
    const encoder = new FountainEncoder(original, { blockSize: 100 });
    expect(encoder.k).toBe(1);
    const decoder = new FountainDecoder();
    const droplet = encoder.nextDroplet();
    expect(decoder.ingest(droplet, droplet.data)).toBe(true);
    expect(decoder.isComplete).toBe(true);
    expect(decoder.progress).toBe(100);
    expect(new TextDecoder().decode(decoder.finalize()!)).toBe('Small payload');
  });

  it('decodes a loss-free systematic stream in exactly K droplets', () => {
    const original = randomBytes(500, 7);
    const encoder = new FountainEncoder(original, { blockSize: 50 });
    expect(encoder.k).toBe(10);
    const decoder = new FountainDecoder();
    for (let i = 0; i < 10; i++) {
      const d = encoder.nextDroplet();
      decoder.ingest(d, d.data);
    }
    expect(decoder.isComplete).toBe(true);
    expect(decoder.rank).toBe(10);
    expect(decoder.finalize()).toEqual(original);
  });

  /** Opens a decoder session with a repair droplet of degree >= 2 so nothing is solved yet. */
  function openSession(blocks: Uint8Array[], message: Uint8Array): FountainDecoder {
    const k = blocks.length;
    const xorOf = (cols: number[]) =>
      cols.reduce((acc, c) => acc.map((v, i) => v ^ blocks[c][i]), new Uint8Array(blocks[0].length));
    let seq = k + 1;
    while (getNeighborsForSeq(seq, k).degree < 2) seq++;
    const decoder = new FountainDecoder();
    decoder.ingest({ seq, k, messageLength: message.length, checksum: crc32(message) }, xorOf(getNeighborsForSeq(seq, k).indices));
    return decoder;
  }

  it('recovers the classic 3-block stopping set via Gaussian elimination', () => {
    const blocks = [randomBytes(8, 1), randomBytes(8, 2), randomBytes(8, 3)];
    const message = new Uint8Array(24);
    blocks.forEach((b, i) => message.set(b, i * 8));
    const xor = (...xs: Uint8Array[]) => xs.reduce((acc, x) => acc.map((v, i) => v ^ x[i]), new Uint8Array(8));

    const decoder = openSession(blocks, message);
    decoder.ingestEquation([0, 1], xor(blocks[0], blocks[1]));
    decoder.ingestEquation([1, 2], xor(blocks[1], blocks[2]));
    decoder.ingestEquation([0, 1, 2], xor(blocks[0], blocks[1], blocks[2]));
    expect(decoder.eliminationPasses).toBeGreaterThanOrEqual(1);
    expect(decoder.isComplete).toBe(true);
    expect(decoder.finalize()).toEqual(message);
  });

  it('peeling alone stalls on a pure stopping set, elimination completes it', () => {
    const k = 4;
    const blocks = Array.from({ length: k }, (_, i) => randomBytes(6, 10 + i));
    const message = new Uint8Array(k * 6);
    blocks.forEach((b, i) => message.set(b, i * 6));
    const xorOf = (cols: number[]) => cols.reduce((acc, c) => acc.map((v, i) => v ^ blocks[c][i]), new Uint8Array(6));

    const decoder = openSession(blocks, message);
    expect(decoder.resolvedBlockCount).toBe(0);

    // Every equation has degree 2 -> no ripple can start.
    for (const cols of [[0, 1], [1, 2], [2, 3], [0, 2]]) decoder.ingestEquation(cols, xorOf(cols));
    decoder.ingestEquation([0, 1, 3], xorOf([0, 1, 3]));
    expect(decoder.isComplete).toBe(true);
    expect(decoder.finalize()).toEqual(message);
  });

  it('ignores duplicates, foreign sessions, out-of-range equations and post-completion droplets', () => {
    const encoder = new FountainEncoder(randomBytes(200, 3), { blockSize: 20 });
    const decoder = new FountainDecoder();
    expect(decoder.ingestEquation([0], new Uint8Array(20))).toBe(false);
    const d1 = encoder.getDroplet(1);
    expect(decoder.ingest(d1, d1.data)).toBe(true);
    expect(decoder.ingest(d1, d1.data)).toBe(false);
    expect(decoder.dropletsReceived).toBe(1);
    expect(decoder.ingest({ ...d1, seq: 2, checksum: 1 }, d1.data)).toBe(false);
    expect(decoder.ingestEquation([99], d1.data)).toBe(false);
    expect(decoder.ingestEquation([0], d1.data)).toBe(false);
    expect(decoder.ingestEquation([1, 1], d1.data)).toBe(false);
    expect(decoder.finalize()).toBeNull();

    for (let seq = 2; seq <= encoder.k; seq++) {
      const d = encoder.getDroplet(seq);
      decoder.ingest(d, d.data);
    }
    expect(decoder.isComplete).toBe(true);
    const late = encoder.getDroplet(encoder.k + 1);
    expect(decoder.ingest(late, late.data)).toBe(false);
  });

  it('throws on CRC mismatch of the reassembled message', () => {
    const encoder = new FountainEncoder(new TextEncoder().encode('Integrity critical document'), { blockSize: 32 });
    const decoder = new FountainDecoder();
    const droplet = encoder.nextDroplet();
    droplet.data[0] ^= 0xff;
    decoder.ingest(droplet, droplet.data);
    expect(() => decoder.finalize()).toThrow(/checksum mismatch/i);
  });

  it('enables stateless stream entry mid-stream', () => {
    const original = randomBytes(1200, 11);
    const encoder = new FountainEncoder(original, { blockSize: 60 });
    const decoder = new FountainDecoder();
    for (let i = 0; i < 25; i++) encoder.nextDroplet();
    let n = 0;
    while (!decoder.isComplete && n < 400) {
      const d = encoder.nextDroplet();
      decoder.ingest(d, d.data);
      n++;
    }
    expect(decoder.isComplete).toBe(true);
    expect(decoder.finalize()).toEqual(original);
  });

  it('wraps sequence numbers after maxSeq back to the first repair droplet', () => {
    const encoder = new FountainEncoder(randomBytes(40, 2), { blockSize: 10, maxSeq: 6 });
    expect(encoder.k).toBe(4);
    expect([0, 3, 4, 5, 6, 7, 8].map(i => encoder.seqForIndex(i))).toEqual([1, 4, 5, 6, 5, 6, 5]);
    expect(encoder.getDroplet(encoder.seqForIndex(6)).seq).toBe(5);
    encoder.nextDroplet();
    encoder.reset();
    expect(encoder.nextDroplet().seq).toBe(1);
  });

  it.each([0.1, 0.3, 0.5])('recovers bit-for-bit at %s random erasure with shuffled arrival', async erasure => {
    for (const [size, blockSize, seed] of [
      [4000, 40, 1],
      [9000, 64, 2],
      [2500, 100, 3],
    ] as const) {
      const original = randomBytes(size, seed * 101);
      const encoder = new FountainEncoder(original, { blockSize });
      const drop = createPrng(seed * 7919 + Math.round(erasure * 100));

      const stream: FountainDroplet[] = [];
      for (let i = 0; i < encoder.k * 4; i++) {
        const d = encoder.nextDroplet();
        if (drop() >= erasure) stream.push(d);
      }
      const decoder = new FountainDecoder();
      for (const s of shuffled(stream, seed)) {
        decoder.ingest(s, s.data);
        if (decoder.isComplete) break;
      }
      expect(decoder.isComplete).toBe(true);
      const recovered = decoder.finalize()!;
      expect(recovered).toEqual(original);
      expect(await sha256Hex(recovered)).toBe(await sha256Hex(original));
    }
  });
});

describe('Fountain session layer', () => {
  it('compresses compressible text with deflate-raw and restores it', async () => {
    const text = new TextEncoder().encode('air-gapped optical transfer '.repeat(200));
    const { data, compression } = await compressForTransfer(text, 'text/plain');
    expect(compression).toBe('deflate-raw');
    expect(data.length).toBeLessThan(text.length * 0.95);
    expect(await decompressTransferPayload(data, compression)).toEqual(text);
  });

  it('bypasses compression for incompressible or pre-compressed payloads and flags them', async () => {
    const noise = randomBytes(4096, 5);
    const random = await compressForTransfer(noise, 'application/octet-stream');
    expect(random.compression).toBe('none');
    expect(random.data).toBe(noise);

    const text = new TextEncoder().encode('aaaa'.repeat(500));
    for (const mime of ['image/jpeg', 'application/zip', 'video/mp4']) {
      const result = await compressForTransfer(text, mime);
      expect(result.compression).toBe('none');
    }
    expect((await compressForTransfer(new Uint8Array(0))).compression).toBe('none');
    expect(await decompressTransferPayload(noise, 'none')).toBe(noise);
  });

  it('resolves unknown densities to the default and estimates frames per density', () => {
    expect(resolveTransferDensity('fast')).toBe('fast');
    expect(resolveTransferDensity('turbo')).toBe(DEFAULT_TRANSFER_DENSITY);
    expect(resolveTransferDensity(undefined)).toBe(DEFAULT_TRANSFER_DENSITY);

    const reliable = estimateTransferFrames(12 * 1024, 'reliable');
    const balanced = estimateTransferFrames(12 * 1024, 'balanced');
    const fast = estimateTransferFrames(12 * 1024, 'fast');
    expect(reliable.symbolSize).toBeLessThan(balanced.symbolSize);
    expect(balanced.symbolSize).toBeLessThan(fast.symbolSize);
    expect(fast.frames).toBeLessThan(balanced.frames);
    expect(balanced.frames).toBeLessThan(reliable.frames);
    // About 15% more symbols than source blocks, and one frame in sixteen is a manifest.
    expect(balanced.frames).toBe(Math.ceil((balanced.k * 1.15 * MANIFEST_INTERVAL) / (MANIFEST_INTERVAL - 1)));
    expect(estimateTransferFrames(12 * 1024)).toEqual(balanced);
  });

});

describe('FountainRateTracker', () => {
  it('computes FPS over a sliding window and an ETA', () => {
    const tracker = new FountainRateTracker(1000);
    expect(tracker.fps(0)).toBe(0);
    for (let t = 0; t <= 1000; t += 100) tracker.record(t);
    expect(tracker.fps(1000)).toBeCloseTo(10, 5);
    const telemetry = tracker.telemetry({ k: 100, rank: 50, resolved: 50, dropletsReceived: 50, progress: 50 }, 1000);
    expect(telemetry.fps).toBeCloseTo(10, 5);
    expect(telemetry.etaSeconds).toBeCloseTo(7, 5);
    expect(tracker.telemetry({ k: 10, rank: 10, resolved: 10, dropletsReceived: 12, progress: 100 }, 1000).etaSeconds).toBe(0);
    tracker.reset();
    expect(tracker.telemetry({ k: 10, rank: 1, resolved: 1, dropletsReceived: 1, progress: 10 }, 5000).etaSeconds).toBeNull();
  });
});
