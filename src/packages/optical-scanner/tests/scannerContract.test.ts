import { describe, it, expect } from 'vitest';
import {
  isValidScannerRequest,
  assertScannerRequest,
  isValidScannerResponse,
  assertScannerResponse,
  isValidScanOptions,
  assertScanOptions,
} from '../index';

if (typeof (globalThis as any).ImageBitmap === 'undefined') {
  (globalThis as any).ImageBitmap = class ImageBitmap {
    width: number;
    height: number;
    constructor(width = 100, height = 100) {
      this.width = width;
      this.height = height;
    }
    close() {}
  };
}

describe('Scanner Contract Payload Validation', () => {
  describe('isValidScannerRequest', () => {
    it('should validate valid scanner requests', () => {
      const valid = {
        image: new (ImageBitmap as any)(100, 100),
        width: 100,
        height: 100,
        sequenceId: 5,
      };
      expect(isValidScannerRequest(valid)).toBe(true);
      expect(() => assertScannerRequest(valid)).not.toThrow();
    });

    it('should invalidate invalid scanner requests', () => {
      const missingImage = {
        width: 100,
        height: 100,
        sequenceId: 5,
      };
      const invalidWidth = {
        image: new (ImageBitmap as any)(100, 100),
        width: -10,
        height: 100,
        sequenceId: 5,
      };
      const invalidSeq = {
        image: new (ImageBitmap as any)(100, 100),
        width: 100,
        height: 100,
        sequenceId: NaN,
      };

      expect(isValidScannerRequest(missingImage)).toBe(false);
      expect(isValidScannerRequest(invalidWidth)).toBe(false);
      expect(isValidScannerRequest(invalidSeq)).toBe(false);

      expect(() => assertScannerRequest(missingImage)).toThrow();
      expect(() => assertScannerRequest(invalidWidth)).toThrow();
    });
  });

  describe('isValidScannerResponse', () => {
    it('should validate valid scanner responses', () => {
      const validPass = {
        status: 'pass' as const,
        sequenceId: 4,
        decodedData: 'https://qrcraftly.com',
      };
      const validFail = {
        status: 'fail' as const,
        sequenceId: 4,
        error: 'DECODE_ERROR',
      };

      expect(isValidScannerResponse(validPass)).toBe(true);
      expect(isValidScannerResponse(validFail)).toBe(true);
      expect(() => assertScannerResponse(validPass)).not.toThrow();
      expect(() => assertScannerResponse(validFail)).not.toThrow();
    });

    it('should invalidate invalid scanner responses', () => {
      const missingStatus = {
        sequenceId: 4,
      };
      const invalidStatus = {
        status: 'unknown',
        sequenceId: 4,
      };

      expect(isValidScannerResponse(missingStatus)).toBe(false);
      expect(isValidScannerResponse(invalidStatus)).toBe(false);

      expect(() => assertScannerResponse(missingStatus)).toThrow();
    });

    it('accepts only the decoders in the chain: native and qr-decode (ADR 0036)', () => {
      const answer = (decoder: string) => ({ status: 'pass', sequenceId: 4, decodedData: 'A', decoder });

      expect(isValidScannerResponse(answer('native'))).toBe(true);
      expect(isValidScannerResponse(answer('qr-decode'))).toBe(true);
      expect(isValidScannerResponse(answer('zxing'))).toBe(false);
    });
  });

  describe('malformed messages (#1607)', () => {
    const image = () => new (ImageBitmap as any)(100, 100);
    const request = (extra: Record<string, unknown>) => ({ image: image(), width: 100, height: 100, sequenceId: 1, ...extra });
    const response = (extra: Record<string, unknown>) => ({ status: 'pass', sequenceId: 1, ...extra });

    it.each([null, undefined, 'text', 42, []])('refuses a request that is %j', (value) => {
      expect(isValidScannerRequest(value)).toBe(false);
      expect(() => assertScannerRequest(value)).toThrow();
    });

    it.each([
      ['a bad epoch', { epochId: 'one' }],
      ['a region that is not an object', { region: 'centre' }],
      ['a region with a missing side', { region: { x: 0, y: 0, width: 10 } }],
      ['a region with no size', { region: { x: 0, y: 0, width: 0, height: 10 } }],
      ['a region with an infinite corner', { region: { x: Infinity, y: 0, width: 10, height: 10 } }],
    ])('refuses a request with %s', (_label, extra) => {
      expect(isValidScannerRequest(request(extra))).toBe(false);
      expect(() => assertScannerRequest(request(extra))).toThrow();
    });

    it('accepts a request with a valid region', () => {
      expect(isValidScannerRequest(request({ region: { x: 0, y: 0, width: 10, height: 10 } }))).toBe(true);
    });

    it.each([null, 'text', 7])('refuses a response that is %j', (value) => {
      expect(isValidScannerResponse(value)).toBe(false);
      expect(() => assertScannerResponse(value)).toThrow();
    });

    it.each([
      ['a non-string payload', { decodedData: 5 }],
      ['a non-string error', { error: {} }],
      ['bytes that are not a Uint8Array', { decodedBytes: [1, 2] }],
      ['seven corner numbers', { corners: [1, 2, 3, 4, 5, 6, 7] }],
      ['an unknown decoder', { decoder: 'zxing' }],
      ['a decoder that is not a string', { decoder: 1 }],
    ])('refuses a response with %s', (_label, extra) => {
      expect(isValidScannerResponse(response(extra))).toBe(false);
      expect(() => assertScannerResponse(response(extra))).toThrow();
    });

    it('refuses a response buffer that is not an ArrayBuffer', () => {
      expect(() => assertScannerResponse(response({ buffer: 'bytes' }))).toThrow('buffer');
    });

    it.each([
      ['a string', 'fast'],
      ['a signal that is not an AbortSignal', { signal: {} }],
      ['a negative size limit', { maxDimension: -1 }],
      ['an infinite size limit', { maxDimension: Infinity }],
    ])('refuses scan options that are %s', (_label, value) => {
      expect(isValidScanOptions(value)).toBe(false);
      expect(() => assertScanOptions(value)).toThrow();
    });

    it('accepts missing and valid scan options', () => {
      expect(isValidScanOptions(undefined)).toBe(true);
      expect(isValidScanOptions({ signal: new AbortController().signal, maxDimension: 800 })).toBe(true);
      expect(() => assertScanOptions(null)).not.toThrow();
    });
  });
});
