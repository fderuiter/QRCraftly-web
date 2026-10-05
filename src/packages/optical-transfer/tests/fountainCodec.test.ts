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
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import {
  FountainEncoder,
  FountainDecoder,
  FountainReassembler,
  FountainRateTracker,
  buildRobustSolitonCdf,
  sampleDegreeFromCdf,
  getNeighborsForSeq,
  createPrng,
  serializeDroplet,
  MAX_RECEIVE_MESSAGE_BYTES,
  parseDropletString,
  isFountainDropletString,
  cborEncode,
  cborDecode,
  encodeBytewordsMinimal,
  decodeBytewordsMinimal,
  crc32,
  crc32Hex,
  solveGF2,
  createFountainSession,
  openFountainSession,
  encodeSessionMessage,
  decodeSessionMessage,
  compressForTransfer,
  decompressTransferPayload,
  resolveFountainSymbolSize,
  maxDropletStringLength,
  sha256Hex,
  MAX_QR_VERSION,
  TRANSFER_DENSITY_PROFILES,
  DEFAULT_TRANSFER_DENSITY,
  resolveTransferDensity,
  estimateTransferFrames,
  MANIFEST_INTERVAL,
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

describe('BC-UR droplet envelope', () => {
  const droplet = {
    seq: 42,
    k: 10,
    messageLength: 48,
    checksum: 0xa1b2c3d4,
    degree: 1,
    indices: [3],
    data: new Uint8Array([1, 2, 3, 4, 5]),
  };

  it('serializes as uppercase ur:bytes/<seq>-<k>/<bytewords> and round-trips', () => {
    const str = serializeDroplet(droplet);
    expect(str).toMatch(/^UR:BYTES\/42-10\/[A-Z]+$/);
    expect(isFountainDropletString(str)).toBe(true);
    expect(isFountainDropletString(str.toLowerCase())).toBe(true);

    const parsed = parseDropletString(str.toLowerCase());
    expect(parsed).not.toBeNull();
    expect(parsed!.meta).toEqual({ seq: 42, k: 10, messageLength: 48, checksum: 0xa1b2c3d4 });
    expect(parsed!.data).toEqual(droplet.data);

    // The body is a BC-UR fragment: CBOR [seq, k, messageLen, checksum, data]
    const body = decodeBytewordsMinimal(str.split('/')[2]);
    expect(cborDecode(body!)).toEqual([42, 10, 48, 0xa1b2c3d4, droplet.data]);
  });

  it('rejects a droplet claiming more than the receive limit, or a huge block count (#1154)', () => {
    const claim = (k: number, messageLength: number, data = new Uint8Array(32)) =>
      serializeDroplet({ seq: 1, k, messageLength, checksum: 1, degree: 1, indices: [0], data });
    // Valid shape: k fragments of 32 bytes.
    expect(parseDropletString(claim(10, 10 * 32 - 5))).not.toBeNull();
    // A claim of 134 MB (k * 32 B) fits the arithmetic but not the receive limit.
    expect(parseDropletString(claim(1 << 22, (1 << 22) * 32 - 1))).toBeNull();
    // k above the absolute cap.
    expect(parseDropletString(claim((1 << 22) + 1, (1 << 22) + 1))).toBeNull();
    // Just under the receive limit is still accepted.
    expect(parseDropletString(claim(MAX_RECEIVE_MESSAGE_BYTES / 32, MAX_RECEIVE_MESSAGE_BYTES - 1))).not.toBeNull();
  });

  it('rejects malformed, mismatched or corrupted droplets', () => {
    const str = serializeDroplet(droplet);
    expect(parseDropletString('F|0|2|abc')).toBeNull();
    expect(parseDropletString('ur:bytes/')).toBeNull();
    expect(parseDropletString('ur:bytes/42-10')).toBeNull();
    expect(parseDropletString(str.replace('/42-10/', '/43-10/'))).toBeNull();
    expect(parseDropletString(str.replace('/42-10/', '/42-11/'))).toBeNull();
    // Flip one byteword: CRC must catch it
    const body = str.split('/')[2];
    const flipped = (body.startsWith('AE') ? 'AD' : 'AE') + body.slice(2);
    expect(parseDropletString(`UR:BYTES/42-10/${flipped}`)).toBeNull();

    const wrap = (value: Parameters<typeof cborEncode>[0]) =>
      `ur:bytes/42-10/${encodeBytewordsMinimal(cborEncode(value))}`;
    expect(parseDropletString(wrap([42, 10, 45]))).toBeNull();
    expect(parseDropletString(wrap('not-an-array'))).toBeNull();
    expect(parseDropletString(wrap([42, 10, 45, 1, new Uint8Array(0)]))).toBeNull();
    expect(parseDropletString(wrap([42, 10, 500, 1, new Uint8Array(5)]))).toBeNull();
    expect(parseDropletString(wrap([42, 10, 45, 1, 'text']))).toBeNull();
    expect(parseDropletString(`ur:bytes/42-10/${encodeBytewordsMinimal(new Uint8Array([0x5f]))}`)).toBeNull();
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
    expect(decoder.ingestString(encoder.nextDropletString())).toBe(true);
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
    expect(decoder.ingestString('not a droplet')).toBe(false);
    expect(decoder.finalize()).toBeNull();

    for (let seq = 2; seq <= encoder.k; seq++) decoder.ingestString(serializeDroplet(encoder.getDroplet(seq)));
    expect(decoder.isComplete).toBe(true);
    expect(decoder.ingestString(serializeDroplet(encoder.getDroplet(encoder.k + 1)))).toBe(false);
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
      decoder.ingestString(encoder.nextDropletString());
      n++;
    }
    expect(decoder.isComplete).toBe(true);
    expect(decoder.finalize()).toEqual(original);
  });

  it('wraps sequence numbers after maxSeq back to the first repair droplet', () => {
    const encoder = new FountainEncoder(randomBytes(40, 2), { blockSize: 10, maxSeq: 6 });
    expect(encoder.k).toBe(4);
    expect([0, 3, 4, 5, 6, 7, 8].map(i => encoder.seqForIndex(i))).toEqual([1, 4, 5, 6, 5, 6, 5]);
    expect(parseDropletString(encoder.dropletStringForIndex(6))!.meta.seq).toBe(5);
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

      const stream: string[] = [];
      for (let i = 0; i < encoder.k * 4; i++) {
        const s = encoder.nextDropletString();
        if (drop() >= erasure) stream.push(s);
      }
      const decoder = new FountainDecoder();
      for (const s of shuffled(stream, seed)) {
        decoder.ingestString(s);
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
  it('round-trips the session header and rejects malformed messages', () => {
    const header = {
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      fileSize: 3,
      sha256: 'ab'.repeat(32),
      compression: 'deflate-raw' as const,
    };
    const message = encodeSessionMessage(header, new Uint8Array([1, 2, 3]));
    expect(decodeSessionMessage(message)).toEqual({ header, payload: new Uint8Array([1, 2, 3]) });
    expect(decodeSessionMessage(cborEncode([1, 2]))).toBeNull();
    expect(decodeSessionMessage(cborEncode(cborEncode([2, 'a', 'b', 1, new Uint8Array(32), 0, new Uint8Array(0)])))).toBeNull();
    expect(decodeSessionMessage(cborEncode(cborEncode([1, 'a', 'b', 1, new Uint8Array(32), 7, new Uint8Array(0)])))).toBeNull();
    expect(decodeSessionMessage(new Uint8Array([0xff]))).toBeNull();
  });

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

  it('keeps every droplet within QR version 7 at ECC Q and H for any file size', () => {
    const sizes = { Q: [1, 100, 5000, 250_000, 5_000_000, 60_000_000], H: [1, 100, 5000, 250_000, 5_000_000] };
    for (const ecc of ['Q', 'H'] as const) {
      for (const size of sizes[ecc]) {
        const { symbolSize, k, maxSeq } = resolveFountainSymbolSize(size, ecc);
        expect(symbolSize).toBeGreaterThanOrEqual(8);
        expect(symbolSize).toBeLessThanOrEqual(100);
        expect(k).toBe(Math.ceil(size / symbolSize));
        const longest = maxDropletStringLength(symbolSize, k, size, maxSeq);

        // Build a real worst-case droplet string and encode it.
        const worst = serializeDroplet({
          seq: maxSeq,
          k,
          messageLength: size,
          checksum: 0xffffffff,
          degree: 1,
          indices: [0],
          data: new Uint8Array(symbolSize).fill(0xff),
        });
        expect(worst.length).toBeLessThanOrEqual(longest);
        const qr = QRCode.create(worst, { errorCorrectionLevel: ecc });
        expect(qr.version).toBeLessThanOrEqual(7);
      }
    }
  });

  it.each(Object.entries(TRANSFER_DENSITY_PROFILES))(
    'keeps every %s droplet within its QR version and ECC for any file size',
    (_density, { maxVersion, errorCorrectionLevel }) => {
      expect(maxVersion).toBeLessThanOrEqual(MAX_QR_VERSION);
      for (const size of [1, 100, 5000, 250_000, 5_000_000]) {
        const { symbolSize, k, maxSeq } = resolveFountainSymbolSize(size, errorCorrectionLevel, undefined, maxVersion);
        const worst = serializeDroplet({
          seq: maxSeq,
          k,
          messageLength: size,
          checksum: 0xffffffff,
          degree: 1,
          indices: [0],
          data: new Uint8Array(symbolSize).fill(0xff),
        });
        expect(worst.length).toBeLessThanOrEqual(maxDropletStringLength(symbolSize, k, size, maxSeq));
        expect(QRCode.create(worst, { errorCorrectionLevel }).version).toBeLessThanOrEqual(maxVersion);
      }
    }
  );

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

  it('honours a smaller requested symbol size and lower version ceilings', () => {
    expect(resolveFountainSymbolSize(1000, 'Q', 12).symbolSize).toBe(12);
    const v5 = resolveFountainSymbolSize(1000, 'M', 100, 5);
    const v7 = resolveFountainSymbolSize(1000, 'M', 100, 7);
    expect(v5.symbolSize).toBeLessThan(v7.symbolSize);
    expect(() => resolveFountainSymbolSize(1000, 'H', 100, 1)).toThrow(RangeError);
    // ECC H leaves too little room for the header of very large sessions.
    expect(() => resolveFountainSymbolSize(60_000_000, 'H')).toThrow(/too large/);
  });

  it('creates and opens a verified session end-to-end, detecting tampering', async () => {
    const file = new TextEncoder().encode('Transfer me through the air gap. '.repeat(40));
    const { encoder, header, symbolSize } = await createFountainSession(file, {
      fileName: 'gap.txt',
      mimeType: 'text/plain',
      errorCorrectionLevel: 'Q',
    });
    expect(header.compression).toBe('deflate-raw');
    expect(header.sha256).toBe(await sha256Hex(file));
    expect(encoder.blockSize).toBe(symbolSize);

    const reassembler = new FountainReassembler();
    let index = 0;
    while (!reassembler.isComplete && index < encoder.k * 4) {
      reassembler.ingest(encoder.dropletStringForIndex(index++));
    }
    const {
      files: [{ data, header: received }],
    } = await reassembler.finalize();
    expect(data).toEqual(file);
    expect(received).toEqual(header);

    const badHash = encodeSessionMessage({ ...header, compression: 'none', fileSize: 3, sha256: '00'.repeat(32) }, new Uint8Array([1, 2, 3]));
    await expect(openFountainSession(badHash)).rejects.toThrow(/SHA-256 mismatch/);
    const badSize = encodeSessionMessage({ ...header, compression: 'none', fileSize: 9 }, new Uint8Array([1, 2, 3]));
    await expect(openFountainSession(badSize)).rejects.toThrow(/size/);
    await expect(openFountainSession(new Uint8Array([0]))).rejects.toThrow(/Malformed/);
    await expect(new FountainReassembler().finalize()).rejects.toThrow(/not complete/);
  });
});

describe('FountainReassembler & telemetry', () => {
  it('reports droplet/rank progress, ignores junk and switches to a new session after a streak', async () => {
    const a = await createFountainSession(randomBytes(600, 21), { fileName: 'a.bin', mimeType: 'application/octet-stream' });
    const b = await createFountainSession(randomBytes(300, 22), { fileName: 'b.bin', mimeType: 'application/octet-stream' });

    const reassembler = new FountainReassembler();
    expect(reassembler.snapshot()).toBeNull();
    expect(reassembler.ingest('hello')).toBeNull();
    const first = reassembler.ingest(a.encoder.dropletStringForIndex(0))!;
    expect(first).toMatchObject({ k: a.encoder.k, rank: 1, resolved: 1, dropletsReceived: 1 });
    expect(reassembler.ingest(a.encoder.dropletStringForIndex(0))).toBeNull();

    for (let i = 0; i < 7; i++) expect(reassembler.ingest(b.encoder.dropletStringForIndex(i))).toBeNull();
    const switched = reassembler.ingest(b.encoder.dropletStringForIndex(7))!;
    expect(switched.k).toBe(b.encoder.k);
    expect(switched.dropletsReceived).toBe(1);

    reassembler.reset();
    expect(reassembler.snapshot()).toBeNull();
  });

  it('ignores the finished session after a reset until another session is accepted', async () => {
    const a = await createFountainSession(randomBytes(200, 31), { fileName: 'a.bin', mimeType: 'application/octet-stream' });
    const b = await createFountainSession(randomBytes(200, 32), { fileName: 'b.bin', mimeType: 'application/octet-stream' });
    const reassembler = new FountainReassembler();
    let index = 0;
    while (!reassembler.isComplete) reassembler.ingest(a.encoder.dropletStringForIndex(index++));
    expect((await reassembler.finalize()).files[0].header.fileName).toBe('a.bin');

    // A camera still pointed at the finished stream must not start receiving the same file again.
    reassembler.reset();
    for (let i = 0; i < 20; i++) expect(reassembler.ingest(a.encoder.dropletStringForIndex(i))).toBeNull();
    expect(reassembler.snapshot()).toBeNull();

    expect(reassembler.ingest(b.encoder.dropletStringForIndex(0))).toMatchObject({ k: b.encoder.k, dropletsReceived: 1 });
    reassembler.reset();
    expect(reassembler.ingest(a.encoder.dropletStringForIndex(0))).toMatchObject({ k: a.encoder.k, dropletsReceived: 1 });
  });

  it('carries the finished session over to a fresh reassembler', async () => {
    const a = await createFountainSession(randomBytes(200, 33), { fileName: 'a.bin', mimeType: 'application/octet-stream' });
    const first = new FountainReassembler();
    expect(first.finishedSessionKey).toBeNull();
    let index = 0;
    while (!first.isComplete) first.ingest(a.encoder.dropletStringForIndex(index++));
    await first.finalize();
    const key = first.finishedSessionKey;
    expect(key).toEqual(expect.any(String));

    const next = new FountainReassembler();
    next.ignoreSession(key!);
    expect(next.ingest(a.encoder.dropletStringForIndex(0))).toBeNull();
  });

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

describe('large block counts are confirmed before decoder tables are built (#1154)', () => {
  it('needs 8 consistent droplets for a stream claiming k > 65,536', () => {
    const reassembler = new FountainReassembler();
    const k = 100_000;
    const droplet = (seq: number) =>
      serializeDroplet({ seq, k, messageLength: k * 32 - 1, checksum: 7, degree: 1, indices: [0], data: new Uint8Array(32) });

    for (let seq = 1; seq <= 7; seq++) {
      expect(reassembler.ingest(droplet(seq))).toBeNull();
    }
    expect(reassembler.snapshot()).toBeNull();
    expect(reassembler.ingest(droplet(8))).not.toBeNull();
  });

  it('does not let one-off bogus droplets build tables', () => {
    const reassembler = new FountainReassembler();
    for (let i = 0; i < 20; i++) {
      const k = 100_000 + i;
      const text = serializeDroplet({ seq: 1, k, messageLength: k * 32 - 1, checksum: i, degree: 1, indices: [0], data: new Uint8Array(32) });
      expect(reassembler.ingest(text)).toBeNull();
    }
    expect(reassembler.snapshot()).toBeNull();
  });

  it('accepts ordinary streams on the first droplet', () => {
    const encoder = new FountainEncoder(new Uint8Array(500).fill(7), { blockSize: 32, maxSeq: 1000 });
    expect(new FountainReassembler().ingest(encoder.nextDropletString())).not.toBeNull();
  });
});
