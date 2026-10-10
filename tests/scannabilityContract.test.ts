import { describe, it, expect } from 'vitest';
import {
  isWorkerRequest,
  assertWorkerRequest,
  isWorkerResponse,
  assertWorkerResponse,
} from '@/packages/scannability';

describe('sharedContract runtime assertion logic', () => {
  describe('isWorkerRequest & assertWorkerRequest', () => {
    it('should validate valid worker requests with Uint8ClampedArray', () => {
      const valid = {
        imageData: {
          data: new Uint8ClampedArray(4),
        },
        width: 100,
        height: 100,
        configId: 'test-config',
      };
      expect(isWorkerRequest(valid)).toBe(true);
      expect(() => assertWorkerRequest(valid)).not.toThrow();
    });

    it('should validate valid worker requests with ImageBitmap objects', () => {
      const valid = {
        imageBitmap: { width: 100, height: 100, close: () => {} } as unknown as ImageBitmap,
        width: 100,
        height: 100,
        configId: 'test-config',
      };
      expect(isWorkerRequest(valid)).toBe(true);
      expect(() => assertWorkerRequest(valid)).not.toThrow();
    });

    it('should validate when configId is null or undefined', () => {
      const validUndefined = {
        imageData: {
          data: new Uint8ClampedArray(4),
        },
        width: 100,
        height: 100,
        configId: undefined,
      };
      const validNull = {
        imageData: {
          data: new Uint8ClampedArray(4),
        },
        width: 100,
        height: 100,
        configId: null,
      };
      expect(isWorkerRequest(validUndefined)).toBe(true);
      expect(isWorkerRequest(validNull)).toBe(true);
    });

    it('should reject non-object payloads', () => {
      expect(isWorkerRequest(null)).toBe(false);
      expect(isWorkerRequest('string')).toBe(false);
      expect(isWorkerRequest(undefined)).toBe(false);
      expect(() => assertWorkerRequest(null)).toThrow('Worker request must be a non-null object');
    });

    it('should reject missing or invalid imageData object', () => {
      const invalid = { width: 100, height: 100 };
      expect(isWorkerRequest(invalid)).toBe(false);
      expect(() => assertWorkerRequest(invalid)).toThrow('Worker request must contain an imageData object');

      const invalidImageDataNull = { imageData: null, width: 100, height: 100 };
      expect(isWorkerRequest(invalidImageDataNull)).toBe(false);
      expect(() => assertWorkerRequest(invalidImageDataNull)).toThrow('Worker request must contain an imageData object');
    });

    it('should reject missing or invalid imageData.data', () => {
      const invalidNoData = {
        imageData: {},
        width: 100,
        height: 100,
      };
      expect(isWorkerRequest(invalidNoData)).toBe(false);
      expect(() => assertWorkerRequest(invalidNoData)).toThrow('Worker request imageData.data must be a Uint8ClampedArray');

      const invalidDataType = {
        imageData: { data: 'not-clamped-array' },
        width: 100,
        height: 100,
      };
      expect(isWorkerRequest(invalidDataType)).toBe(false);
      expect(() => assertWorkerRequest(invalidDataType)).toThrow('Worker request imageData.data must be a Uint8ClampedArray');
    });

    it('should reject invalid width', () => {
      const invalidNoWidth = {
        imageData: { data: new Uint8ClampedArray(4) },
        height: 100,
      };
      expect(isWorkerRequest(invalidNoWidth)).toBe(false);
      expect(() => assertWorkerRequest(invalidNoWidth)).toThrow('Worker request width must be a positive number');

      const invalidWidthNaN = {
        imageData: { data: new Uint8ClampedArray(4) },
        width: NaN,
        height: 100,
      };
      expect(isWorkerRequest(invalidWidthNaN)).toBe(false);
      expect(() => assertWorkerRequest(invalidWidthNaN)).toThrow('Worker request width must be a positive number');

      const invalidWidthNegative = {
        imageData: { data: new Uint8ClampedArray(4) },
        width: -5,
        height: 100,
      };
      expect(isWorkerRequest(invalidWidthNegative)).toBe(false);
      expect(() => assertWorkerRequest(invalidWidthNegative)).toThrow('Worker request width must be a positive number');
    });

    it('should reject invalid height', () => {
      const invalidNoHeight = {
        imageData: { data: new Uint8ClampedArray(4) },
        width: 100,
      };
      expect(isWorkerRequest(invalidNoHeight)).toBe(false);
      expect(() => assertWorkerRequest(invalidNoHeight)).toThrow('Worker request height must be a positive number');

      const invalidHeightNaN = {
        imageData: { data: new Uint8ClampedArray(4) },
        width: 100,
        height: NaN,
      };
      expect(isWorkerRequest(invalidHeightNaN)).toBe(false);
      expect(() => assertWorkerRequest(invalidHeightNaN)).toThrow('Worker request height must be a positive number');

      const invalidHeightNegative = {
        imageData: { data: new Uint8ClampedArray(4) },
        width: 100,
        height: 0,
      };
      expect(isWorkerRequest(invalidHeightNegative)).toBe(false);
      expect(() => assertWorkerRequest(invalidHeightNegative)).toThrow('Worker request height must be a positive number');
    });

    it('should reject invalid configId', () => {
      const invalidConfigId = {
        imageData: { data: new Uint8ClampedArray(4) },
        width: 100,
        height: 100,
        configId: 12345,
      };
      expect(isWorkerRequest(invalidConfigId)).toBe(false);
      expect(() => assertWorkerRequest(invalidConfigId)).toThrow('Worker request configId must be a string');
    });
  });

  describe('isWorkerResponse & assertWorkerResponse', () => {
    it('should validate valid worker responses', () => {
      const valid = {
        success: true,
        physicalReady: false,
        error: 'SOME_ERROR',
        configId: 'some-config',
      };
      expect(isWorkerResponse(valid)).toBe(true);
      expect(() => assertWorkerResponse(valid)).not.toThrow();
    });

    it('should validate dropped worker acknowledgments', () => {
      const dropped = { configId: 'stale-config', dropped: true };

      expect(isWorkerResponse(dropped)).toBe(true);
      expect(() => assertWorkerResponse(dropped)).not.toThrow();
    });

    it('should validate image-data retry responses', () => {
      const retry = { configId: 'unsupported-canvas', retryWithImageData: true };

      expect(isWorkerResponse(retry)).toBe(true);
      expect(() => assertWorkerResponse(retry)).not.toThrow();
    });

    it('accepts a retry that hands the bitmap back and rejects a malformed one', () => {
      expect(isWorkerResponse({ configId: 'r', retryWithImageData: true, imageBitmap: { width: 1, height: 1 } })).toBe(true);
      expect(isWorkerResponse({ configId: 'r', retryWithImageData: true, imageBitmap: 'bitmap' })).toBe(false);
    });

    it('should validate with optional fields as undefined or null', () => {
      const validUndefined = {
        success: true,
        physicalReady: true,
      };
      const validNull = {
        success: false,
        physicalReady: false,
        error: null,
        configId: null,
      };
      expect(isWorkerResponse(validUndefined)).toBe(true);
      expect(isWorkerResponse(validNull)).toBe(true);
    });

    it('should reject non-object response payloads', () => {
      expect(isWorkerResponse(null)).toBe(false);
      expect(isWorkerResponse('string')).toBe(false);
      expect(() => assertWorkerResponse(null)).toThrow('Worker response must be a non-null object');
    });

    it('should reject missing or invalid success flag', () => {
      const invalid = { physicalReady: true };
      expect(isWorkerResponse(invalid)).toBe(false);
      expect(() => assertWorkerResponse(invalid)).toThrow('Worker response success must be a boolean');

      const invalidSuccessType = { success: 'yes', physicalReady: true };
      expect(isWorkerResponse(invalidSuccessType)).toBe(false);
      expect(() => assertWorkerResponse(invalidSuccessType)).toThrow('Worker response success must be a boolean');
    });

    it('should reject missing or invalid physicalReady flag', () => {
      const invalid = { success: true };
      expect(isWorkerResponse(invalid)).toBe(false);
      expect(() => assertWorkerResponse(invalid)).toThrow('Worker response physicalReady must be a boolean');

      const invalidPhysicalReadyType = { success: true, physicalReady: 1 };
      expect(isWorkerResponse(invalidPhysicalReadyType)).toBe(false);
      expect(() => assertWorkerResponse(invalidPhysicalReadyType)).toThrow('Worker response physicalReady must be a boolean');
    });

    it('should reject invalid error field', () => {
      const invalidError = {
        success: false,
        physicalReady: false,
        error: 123,
      };
      expect(isWorkerResponse(invalidError)).toBe(false);
      expect(() => assertWorkerResponse(invalidError)).toThrow('Worker response error must be a string');
    });

    it('should reject invalid configId field', () => {
      const invalidConfigId = {
        success: true,
        physicalReady: true,
        configId: {},
      };
      expect(isWorkerResponse(invalidConfigId)).toBe(false);
      expect(() => assertWorkerResponse(invalidConfigId)).toThrow('Worker response configId must be a string');
    });
  });
});
