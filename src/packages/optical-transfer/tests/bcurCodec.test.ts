import { describe, it, expect } from 'vitest';
import { BcUrDecoder, BcUrEncoder, isBcUr, type BcUrIngest } from '../bcur';
import { cborEncode } from '../index';
import reference from './fixtures/bcur/reference-streams.json';
import published from './fixtures/bcur/published.json';
import crossChecks from './fixtures/bcur/ours-decoded-by-reference.json';

// Vectors frozen from @ngraveio/bc-ur 1.1.13 and the BCR specs by
// scripts/fixtures/generate_bcur_vectors.ts (#1181, ADR 0040).
const vectors = reference.vectors;

const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], pair => parseInt(pair, 16));

function feed(parts: readonly string[]): BcUrIngest {
  const decoder = new BcUrDecoder();
  let last: BcUrIngest = { status: 'rejected' };
  for (const part of parts) {
    last = decoder.ingest(part);
    if (last.status === 'complete') break;
  }
  return last;
}

function vector(name: string): (typeof vectors)[number] {
  const found = vectors.find(v => v.name === name);
  if (!found) throw new Error(`missing vector ${name}`);
  return found;
}

describe('BC-UR codec against the reference encoder', () => {
  for (const entry of vectors) {
    const file = fromHex(entry.fileHex);

    it(`${entry.name}: decodes the reference stream`, () => {
      const result = feed(entry.parts);
      expect(result.status).toBe('complete');
      if (result.status !== 'complete') return;
      expect(result.result.type).toBe('bytes');
      expect(result.result.content).toEqual({ kind: 'file', bytes: file });
    });

    it(`${entry.name}: decodes uppercase and out-of-order parts`, () => {
      const shuffled = entry.parts.map(p => p.toUpperCase()).reverse();
      const result = feed(shuffled);
      expect(result.status).toBe('complete');
    });

    it(`${entry.name}: emits the exact reference strings`, () => {
      const encoder = BcUrEncoder.forBytes(file, entry.maxFragmentLength);
      expect(entry.parts.map(() => encoder.nextPart())).toEqual(entry.parts);
    });
  }

  it('recovers when half the pure parts are lost', () => {
    const entry = vector('medium');
    const total = Number(/\/\d+-(\d+)\//.exec(entry.parts[0])?.[1]);
    const result = feed(entry.parts.slice(Math.floor(total / 2)));
    expect(result.status).toBe('complete');
  });
});

describe('BC-UR codec against the reference decoder', () => {
  for (const entry of crossChecks.vectors) {
    const file = fromHex(entry.fileHex);

    it(`${entry.name}: still emits the parts the reference decoder read back`, () => {
      const encoder = BcUrEncoder.forBytes(file, entry.maxFragmentLength);
      if (entry.skipPure) for (let i = 0; i < encoder.fragmentCount; i++) encoder.nextPart();
      expect(entry.parts.map(() => encoder.nextPart())).toEqual(entry.parts);
    });

    it(`${entry.name}: our decoder reads the same parts`, () => {
      const result = feed(entry.parts);
      expect(result.status).toBe('complete');
      if (result.status === 'complete') expect(result.result.content).toEqual({ kind: 'file', bytes: file });
    });
  }
});

describe('BC-UR published test vectors', () => {
  it('BCR-2020-005: decodes the single-part seed URs', () => {
    for (const entry of published.bcr2020005.singlePart) {
      const result = feed([entry.ur]);
      expect(result).toMatchObject({ status: 'complete', result: { type: entry.type, content: { kind: 'cbor', bytes: fromHex(entry.cborHex) } } });
      expect(new BcUrEncoder(entry.type, fromHex(entry.cborHex)).nextPart()).toBe(entry.ur);
    }
  });

  it('BCR-2020-005: reads the first part of a multipart seed', () => {
    const { ur, type, seqLen } = published.bcr2020005.firstOfMultiPart;
    const decoder = new BcUrDecoder();
    expect(decoder.ingest(ur)).toMatchObject({ status: 'progress', received: 1, type });
    expect(decoder.progress).toBeCloseTo(1 / seqLen);
  });

  it('BCR-2024-001 testEncoderCBOR: emits the published fountain parts', () => {
    const { messageHex, maxFragmentLength, parts } = published.bcr2024001.testEncoderCBOR;
    const encoder = new BcUrEncoder('bytes', fromHex(messageHex), maxFragmentLength);
    expect(parts.map(() => encoder.nextPart())).toEqual(parts);
  });
});

describe('BcUrDecoder behaviour', () => {
  it('reports progress and ignores duplicates', () => {
    const stream = vector('seven-fragments');
    const decoder = new BcUrDecoder();
    const first = decoder.ingest(stream.parts[0]);
    expect(first).toMatchObject({ status: 'progress', received: 1, type: 'bytes' });
    expect(decoder.ingest(stream.parts[0])).toMatchObject({ status: 'progress', received: 1 });
    expect(decoder.progress).toBeGreaterThan(0);
  });

  it('rejects junk, bad checksums and a different message', () => {
    const decoder = new BcUrDecoder();
    expect(decoder.ingest('hello')).toEqual({ status: 'rejected' });
    const bad = vector('seven-fragments').parts[0].slice(0, -2) + (vector('seven-fragments').parts[0].endsWith('aa') ? 'bb' : 'aa');
    expect(decoder.ingest(bad)).toEqual({ status: 'rejected' });
    expect(decoder.ingest(vector('seven-fragments').parts[0]).status).toBe('progress');
    expect(decoder.ingest(vector('medium').parts[0])).toEqual({ status: 'rejected' });
    expect(decoder.ingest(vector('seven-fragments').parts[0].replace('ur:bytes', 'ur:other'))).toEqual({ status: 'rejected' });
  });

  it('offers text for a CBOR text string and raw CBOR otherwise', () => {
    const textUr = new BcUrEncoder('note', cborEncode('hello wallet'), 8);
    const textResult = feed(Array.from({ length: 8 }, () => textUr.nextPart()));
    expect(textResult).toMatchObject({ status: 'complete', result: { type: 'note', content: { kind: 'text', text: 'hello wallet' } } });

    const raw = cborEncode([1, 2, 3]);
    const rawUr = new BcUrEncoder('crypto-thing', raw, 100);
    expect(feed([rawUr.nextPart()])).toMatchObject({ status: 'complete', result: { content: { kind: 'cbor', bytes: raw } } });
  });

  it('round-trips a large message through our own codec', () => {
    const file = Uint8Array.from({ length: 5000 }, (_, i) => (i * 31 + 7) & 0xff);
    const encoder = BcUrEncoder.forBytes(file, 120);
    const decoder = new BcUrDecoder();
    let result: BcUrIngest = { status: 'rejected' };
    for (let i = 0; i < encoder.fragmentCount * 3 && result.status !== 'complete'; i++) {
      if (i % 3 === 1) {
        encoder.nextPart();
        continue;
      }
      result = decoder.ingest(encoder.nextPart());
    }
    expect(result.status).toBe('complete');
    if (result.status === 'complete') expect(result.result.content).toEqual({ kind: 'file', bytes: file });
  });

  it('detects UR syntax', () => {
    expect(isBcUr(vector('seven-fragments').parts[3])).toBe(true);
    expect(isBcUr(vector('single-small').parts[0].toUpperCase())).toBe(true);
    expect(isBcUr('https://example.com')).toBe(false);
    expect(isBcUr('ur:bytes/')).toBe(false);
  });

  it('rejects invalid encoder input', () => {
    expect(() => new BcUrEncoder('Bad Type', new Uint8Array(4))).toThrow(RangeError);
    expect(() => new BcUrEncoder('bytes', new Uint8Array(0))).toThrow(RangeError);
    expect(() => new BcUrEncoder('bytes', new Uint8Array(4), 0)).toThrow(RangeError);
  });

  it('reassembles 2000+ fragment streams under 200ms using inverted index peeling', () => {
    const file = Uint8Array.from({ length: 20000 }, (_, i) => (i * 17 + 13) & 0xff);
    const encoder = BcUrEncoder.forBytes(file, 10);
    expect(encoder.fragmentCount).toBeGreaterThanOrEqual(2000);
    const decoder = new BcUrDecoder();

    const parts: string[] = [];
    for (let i = 0; i < encoder.fragmentCount * 1.5; i++) {
      parts.push(encoder.nextPart());
    }

    const start = performance.now();
    let result: BcUrIngest = { status: 'rejected' };
    for (const part of parts) {
      result = decoder.ingest(part);
      if (result.status === 'complete') break;
    }
    const duration = performance.now() - start;

    expect(result.status).toBe('complete');
    if (result.status === 'complete') expect(result.result.content).toEqual({ kind: 'file', bytes: file });
    expect(duration).toBeLessThan(200);
  });
});
