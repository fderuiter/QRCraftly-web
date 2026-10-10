import { validateConfig } from '@/packages/qr-payload';
import type { QRConfig } from '@/types';
import { buildMatrix } from './lib/buildMatrix';
import { loadQrEncoder, QrEncodeError } from './lib/encoder';

// Start loading the encoder with the worker, so the first code does not wait on it.
// A failed load is retried by the next request.
loadQrEncoder().catch(() => undefined);

let latestSequenceId = -1;

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

self.onmessage = async (e: MessageEvent<{ config: QRConfig; sequenceId: number }>) => {
  const { config, sequenceId } = e.data;

  // Track latest sequence ID globally in the worker
  if (typeof sequenceId === 'number' && sequenceId > latestSequenceId) {
    latestSequenceId = sequenceId;
  }

  // Yield to event loop to allow incoming messages to override this one if they are newer
  await yieldToEventLoop();

  // If a newer request has already overridden this one, discard immediately
  if (sequenceId < latestSequenceId) {
    return;
  }

  try {
    // 1. Validate the configuration profile
    const violations = validateConfig(config);
    if (violations.length > 0) {
      if (sequenceId === latestSequenceId) {
        self.postMessage({
          status: 'validationFailed',
          sequenceId,
          violations,
        });
      }
      return;
    }

    // 2. Perform QR calculations (Reed-Solomon & module layout)
    const encoder = await loadQrEncoder();
    if (sequenceId < latestSequenceId) {
      return;
    }
    const modules = buildMatrix(config, encoder);

    const size = modules.size;
    const matrix = new Uint8Array(size * size);

    // Yield cooperatively during the serialization of heavy iterations
    for (let r = 0; r < size; r++) {
      if (r % 10 === 0) {
        await yieldToEventLoop();
        // Check again after yielding if we were preempted by a newer request
        if (sequenceId < latestSequenceId) {
          return;
        }
      }
      for (let c = 0; c < size; c++) {
        matrix[r * size + c] = modules.get(r, c) ? 1 : 0;
      }
    }

    if (sequenceId === latestSequenceId) {
      self.postMessage({
        status: 'success',
        sequenceId,
        size,
        matrix,
      });
    }
  } catch (error) {
    if (sequenceId === latestSequenceId) {
      self.postMessage({
        status: 'error',
        sequenceId,
        error: (error instanceof Error && error.message) || 'MATRIX_GENERATION_FAILED',
        // Lets the preview say the content is too long for the error-correction level (#1251).
        ...(error instanceof QrEncodeError ? { kind: error.kind } : {}),
      });
    }
  }
};
