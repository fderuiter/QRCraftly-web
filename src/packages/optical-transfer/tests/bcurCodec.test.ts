import { describe, it, expect } from 'vitest';
import { URDecoder } from '@ngraveio/bc-ur';
import { BcUrDecoder, BcUrEncoder, isBcUr, type BcUrIngest } from '../bcur';
import { cborEncode } from '../index';
import vectors from './fixtures/bcurReference.json';

const fromHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], pair => parseInt(pair, 16));

function feed(parts: string[]): BcUrIngest {
  const decoder = new BcUrDecoder();
  let last: BcUrIngest = { status: 'rejected' };
  for (const part of parts) {
    last = decoder.ingest(part);
    if (last.status === 'complete') break;
  }
  return last;
}

describe('BC-UR codec against @ngraveio/bc-ur vectors', () => {
  for (const vector of vectors) {
    const file = fromHex(vector.fileHex);

    it(`${vector.name}: decodes the reference stream`, () => {
      const result = feed(vector.parts);
      expect(result.status).toBe('complete');
      if (result.status !== 'complete') return;
      expect(result.result.type).toBe('bytes');
      expect(result.result.content).toEqual({ kind: 'file', bytes: file });
    });

    it(`${vector.name}: decodes uppercase and out-of-order parts`, () => {
      const shuffled = vector.parts.map(p => p.toUpperCase()).reverse();
      const result = feed(shuffled);
      expect(result.status).toBe('complete');
    });

    it(`${vector.name}: emits the exact reference strings`, () => {
      const encoder = BcUrEncoder.forBytes(file, vector.maxFragmentLength);
      expect(vector.parts.map(() => encoder.nextPart())).toEqual(vector.parts);
    });

    it(`${vector.name}: the reference decoder reads our stream`, () => {
      const encoder = BcUrEncoder.forBytes(file, vector.maxFragmentLength);
      const reference = new URDecoder();
      for (let i = 0; i < encoder.fragmentCount * 4 && !reference.isComplete(); i++) {
        reference.receivePart(encoder.nextPart());
      }
      expect(reference.isSuccess()).toBe(true);
      expect(Uint8Array.from(reference.resultUR().decodeCBOR())).toEqual(file);
    });
  }

  it('recovers from mixed parts alone (pure parts lost)', () => {
    const vector = vectors.find(v => v.name === 'tiny-fragments');
    if (!vector) throw new Error('missing vector');
    const total = Number(/\/\d+-(\d+)\//.exec(vector.parts[0])?.[1]);
    const result = feed(vector.parts.slice(Math.floor(total / 2)));
    expect(result.status).toBe('complete');
  });

  it('reference decoder reads mixed-only parts from our encoder', () => {
    const file = fromHex(vectors[3].fileHex);
    const encoder = BcUrEncoder.forBytes(file, 10);
    const total = encoder.fragmentCount;
    for (let i = 0; i < total; i++) encoder.nextPart();
    const ours = new BcUrDecoder();
    const reference = new URDecoder();
    for (let i = 0; i < total * 3 && !(ours.progress === 1 && reference.isComplete()); i++) {
      const part = encoder.nextPart();
      ours.ingest(part);
      reference.receivePart(part);
    }
    expect(ours.progress).toBe(1);
    expect(reference.isSuccess()).toBe(true);
  });
});

describe('BcUrDecoder behaviour', () => {
  it('reports progress and ignores duplicates', () => {
    const vector = vectors[1];
    const decoder = new BcUrDecoder();
    const first = decoder.ingest(vector.parts[0]);
    expect(first).toMatchObject({ status: 'progress', received: 1, type: 'bytes' });
    expect(decoder.ingest(vector.parts[0])).toMatchObject({ status: 'progress', received: 1 });
    expect(decoder.progress).toBeGreaterThan(0);
  });

  it('rejects junk, bad checksums and a different message', () => {
    const decoder = new BcUrDecoder();
    expect(decoder.ingest('hello')).toEqual({ status: 'rejected' });
    const bad = vectors[1].parts[0].slice(0, -2) + (vectors[1].parts[0].endsWith('aa') ? 'bb' : 'aa');
    expect(decoder.ingest(bad)).toEqual({ status: 'rejected' });
    expect(decoder.ingest(vectors[1].parts[0]).status).toBe('progress');
    expect(decoder.ingest(vectors[2].parts[0])).toEqual({ status: 'rejected' });
    expect(decoder.ingest(vectors[1].parts[0].replace('ur:bytes', 'ur:other'))).toEqual({ status: 'rejected' });
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
    expect(isBcUr(vectors[1].parts[3])).toBe(true);
    expect(isBcUr(vectors[0].parts[0].toUpperCase())).toBe(true);
    expect(isBcUr('https://example.com')).toBe(false);
    expect(isBcUr('ur:bytes/')).toBe(false);
  });

  it('rejects invalid encoder input', () => {
    expect(() => new BcUrEncoder('Bad Type', new Uint8Array(4))).toThrow(RangeError);
    expect(() => new BcUrEncoder('bytes', new Uint8Array(0))).toThrow(RangeError);
    expect(() => new BcUrEncoder('bytes', new Uint8Array(4), 0)).toThrow(RangeError);
  });
});
