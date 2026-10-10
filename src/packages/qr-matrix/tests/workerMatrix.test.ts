import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { loadWorkerModule, type InThreadWorkerScope, type WorkerModuleUnderTest } from '../../../../tests/utils/inThreadWorker';
import { type QRConfig, QRType, QRStyle, QRErrorCorrectionLevel, SocialFormat, TemplateStyle } from '@/types';

describe('Matrix Worker', () => {
  let workerHandler: WorkerModuleUnderTest['handle'];
  let worker: WorkerModuleUnderTest;
  let scope: InThreadWorkerScope;
  let originalPostMessage: any;

  beforeAll(async () => {
    worker = await loadWorkerModule(new URL('../worker-matrix.ts', import.meta.url));
    scope = worker.scope;
    workerHandler = worker.handle;
  });

  beforeEach(() => {
    originalPostMessage = scope.postMessage;
    vi.clearAllMocks();
  });

  afterEach(() => {
    scope.postMessage = originalPostMessage;
  });

  const createDummyConfig = (value = 'https://example.com'): QRConfig => ({
    value,
    type: QRType.URL,
    fgColor: '#000000',
    bgColor: '#ffffff',
    style: QRStyle.STANDARD,
    logoUrl: null,
    logoSize: 0.15,
    logoPaddingStyle: 'none',
    logoPadding: 0,
    logoBackgroundColor: '#ffffff',
    eyeColor: '#000000',
    errorCorrectionLevel: QRErrorCorrectionLevel.M,
    isBorderEnabled: false,
    borderSize: 0,
    borderColor: '#000000',
    borderStyle: 'solid',
    borderText: '',
    borderTextPosition: 'top-center',
    borderTextColor: '#000000',
    borderLogoUrl: null,
    borderLogoPosition: 'bottom-center',
    socialFormat: SocialFormat.SQUARE_1_1,
    templateStyle: TemplateStyle.NONE,
  });

  it('generates QR matrix and sends success message', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    await workerHandler({
      data: {
        config: createDummyConfig(),
        sequenceId: 1,
      },
    } as MessageEvent);

    // Give time for timeout yields to process
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(postMessageSpy).toHaveBeenCalled();
    const lastCall = postMessageSpy.mock.calls[postMessageSpy.mock.calls.length - 1][0];
    expect(lastCall.status).toBe('success');
    expect(lastCall.sequenceId).toBe(1);
    expect(lastCall.size).toBeGreaterThan(0);
    expect(lastCall.matrix).toBeInstanceOf(Uint8Array);
  });

  it('fails validation and returns validationFailed message', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    // Border Text contains strict control char
    const invalidConfig = createDummyConfig();
    invalidConfig.borderText = '\x00ControlChar';

    await workerHandler({
      data: {
        config: invalidConfig,
        sequenceId: 2,
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(postMessageSpy).toHaveBeenCalledWith({
      status: 'validationFailed',
      sequenceId: 2,
      violations: expect.arrayContaining([expect.stringContaining('Border Text')]),
    });
  });

  it('discards stale requests based on sequence ID sequenceId tracking', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    // Dispatch a request with sequenceId = 3, then a newer request with sequenceId = 4
    const p1 = workerHandler({
      data: {
        config: createDummyConfig('Request 3'),
        sequenceId: 3,
      },
    } as MessageEvent);

    const p2 = workerHandler({
      data: {
        config: createDummyConfig('Request 4'),
        sequenceId: 4,
      },
    } as MessageEvent);

    await Promise.all([p1, p2]);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The older request (3) should be discarded and never posted
    const postedSequenceIds = postMessageSpy.mock.calls.map(call => call[0].sequenceId);
    expect(postedSequenceIds).not.toContain(3);
    expect(postedSequenceIds).toContain(4);
  });

  it('handles generation exceptions and reports error status', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    // Trigger an error in qrcode library by sending an undefined value
    const invalidPayloadConfig = createDummyConfig();
    invalidPayloadConfig.value = undefined as any;

    await workerHandler({
      data: {
        config: invalidPayloadConfig,
        sequenceId: 5,
      },
    } as MessageEvent);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(postMessageSpy).toHaveBeenCalledWith({
      status: 'error',
      sequenceId: 5,
      error: expect.any(String),
      kind: 'invalid',
    });
  });

  it('tells the preview when the content is too long for one code (#1251)', async () => {
    const postMessageSpy = vi.fn();
    scope.postMessage = postMessageSpy;

    await workerHandler({
      data: {
        config: createDummyConfig('x'.repeat(4000)),
        sequenceId: 6,
      },
    } as MessageEvent);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(postMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', sequenceId: 6, kind: 'too-long' }));
  });
});
