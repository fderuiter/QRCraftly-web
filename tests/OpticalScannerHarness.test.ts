// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpticalScannerHarness, HarnessFrameResult } from './utils/OpticalScannerHarness';
import { fakeQrRead } from './utils/fakeQrRead';

const qrRead = vi.fn();
/** The harness's reader, scripted per test. */
const reader = { read: qrRead };

describe('OpticalScannerHarness Unit & Integration Tests', () => {
  let harness: OpticalScannerHarness;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (harness) {
      harness.stop();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should initialize cleanly and start/stop without side effects', () => {
    harness = new OpticalScannerHarness({ reader });
    expect(harness.getMetrics().totalFramesPushed).toBe(0);

    harness.start();
    const metrics = harness.getMetrics();
    expect(metrics.activeWorkerInstances).toBe(1);
    expect(metrics.totalFramesPushed).toBe(0);

    harness.stop();
  });

  it('Requirement 1 & AC1: executes automated integration runs combining frame scheduling, mock queues, and optical blur', () => {
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com/integration-test')]);

    const processedResults: HarnessFrameResult[] = [];
    harness = new OpticalScannerHarness({
      reader,
      onFrameProcessed: (res) => processedResults.push(res),
      opticalProfile: { noiseLevel: 5, enabled: true },
    });

    harness.start();
    const mockPixels = new Uint8ClampedArray(400);

    const seqId = harness.pushFrame(mockPixels, 10, 10);
    expect(seqId).toBe(1);

    expect(processedResults).toHaveLength(1);
    expect(processedResults[0].sequenceId).toBe(1);
    expect(processedResults[0].status).toBe('pass');
    expect(processedResults[0].decodedData).toBe('https://qrcraftly.com/integration-test');
    expect(processedResults[0].digitalScannable).toBe(true);
    expect(processedResults[0].opticalScannable).toBe(true);
    expect(processedResults[0].scannabilityClassification).toBe('scannable');

    const metrics = harness.getMetrics();
    expect(metrics.totalFramesPushed).toBe(1);
    expect(metrics.framesAccepted).toBe(1);
    expect(metrics.framesProcessed).toBe(1);
    expect(metrics.passCount).toBe(1);
    expect(metrics.scannabilityPassRate).toBe(100);
  });

  it('Requirement 2 & AC2: verifies scheduler backpressure locks reject excess frame requests during worker latency spikes', () => {
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com/backpressure')]);
    let backpressureCount = 0;

    harness = new OpticalScannerHarness({
      reader,
      workerConfig: { latencyMs: 200 },
      onBackpressureDrop: () => {
        backpressureCount += 1;
      },
    });

    harness.start();
    const mockPixels = new Uint8ClampedArray(400);

    // First frame pushed, goes in flight with 200ms latency
    const seq1 = harness.pushFrame(mockPixels, 10, 10);
    expect(seq1).toBe(1);

    // Second and third frames pushed immediately while first is in flight -> rejected by backpressure
    const seq2 = harness.pushFrame(mockPixels, 10, 10);
    const seq3 = harness.pushFrame(mockPixels, 10, 10);

    expect(seq2).toBeNull();
    expect(seq3).toBeNull();

    const metrics = harness.getMetrics();
    expect(metrics.totalFramesPushed).toBe(3);
    expect(metrics.framesAccepted).toBe(1);
    expect(metrics.framesBackpressured).toBe(2);
    expect(backpressureCount).toBe(2);

    // Fast forward 200ms for first frame to complete
    vi.advanceTimersByTime(200);

    // Now that worker completed first frame, subsequent push should succeed!
    const seq4 = harness.pushFrame(mockPixels, 10, 10);
    expect(seq4).toBe(2);
  });

  it('Requirement 3 & AC3: verifies simulated worker stalls trigger starvation watchdog to recreate worker instances', () => {
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com/stall')]);

    let watchdogTriggered = false;
    let workerRecreated = false;

    let nowTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowTime);

    harness = new OpticalScannerHarness({
      reader,
      workerConfig: { stallWorker: true }, // Simulate worker stall
      onWatchdogTriggered: () => {
        watchdogTriggered = true;
      },
      onWorkerRecreated: () => {
        workerRecreated = true;
      },
    });

    harness.start();
    const mockPixels = new Uint8ClampedArray(400);

    // Push frame, which becomes stuck in flight at t=1000ms
    const seqId = harness.pushFrame(mockPixels, 10, 10);
    expect(seqId).toBe(1);

    // Advance time past the 5000ms hang budget to t=6200ms
    nowTime = 6200;
    vi.advanceTimersByTime(5200);

    // Watchdog automatic timer fired during advanceTimersByTime
    expect(watchdogTriggered).toBe(true);
    expect(workerRecreated).toBe(true);

    const metrics = harness.getMetrics();
    expect(metrics.watchdogTriggers).toBe(1);
    expect(metrics.workerRecreations).toBe(1);

    // Disable worker stall to verify pipeline recovered and accepts new frames
    harness.setWorkerConfig({ stallWorker: false });
    const seq2 = harness.pushFrame(mockPixels, 10, 10);
    expect(seq2).toBe(2);
  });

  it('Requirement 4 & AC5: returns expected scannability classifications (scannable, degraded, unscannable) under optical simulation', () => {
    const mockPixels = new Uint8ClampedArray(400);

    harness = new OpticalScannerHarness({ reader });
    harness.start();

    // 1. Pristine QR code with low noise -> 'scannable'
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com')]);
    const res1 = harness.evaluateScannability(mockPixels, 10, 10);
    expect(res1.digitalScannable).toBe(true);
    expect(res1.opticalScannable).toBe(true);
    expect(res1.scannabilityClassification).toBe('scannable');

    // 2. Pristine QR code with severe noise -> 'degraded' (digital pass, optical fail)
    qrRead
      .mockReturnValueOnce([fakeQrRead('https://qrcraftly.com')]) // digital
      .mockReturnValueOnce([]); // optical
    qrRead.mockReturnValueOnce([]); // optical (inverted)

    const res2 = harness.evaluateScannability(mockPixels, 10, 10);
    expect(res2.digitalScannable).toBe(true);
    expect(res2.opticalScannable).toBe(false);
    expect(res2.scannabilityClassification).toBe('degraded');

    // 3. Blank image -> 'unscannable'
    qrRead.mockReturnValue([]);
    const res3 = harness.evaluateScannability(mockPixels, 10, 10);
    expect(res3.digitalScannable).toBe(false);
    expect(res3.opticalScannable).toBe(false);
    expect(res3.scannabilityClassification).toBe('unscannable');
  });

  it('Requirement 5 & AC4: asserts that out-of-order execution responses with outdated sequence identifiers are discarded', () => {
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com')]);

    let staleCount = 0;
    const staleSeqIds: number[] = [];

    harness = new OpticalScannerHarness({
      reader,
      onStaleFrameDiscarded: (seqId) => {
        staleCount += 1;
        staleSeqIds.push(seqId);
      },
    });

    harness.start();
    const mockPixels = new Uint8ClampedArray(400);

    // Frame 1 (seq 1) pushed with 200ms latency
    const seq1 = harness.pushFrame(mockPixels, 10, 10, false, 200);
    // Frame 2 (seq 2) forced with 50ms latency
    const seq2 = harness.pushFrame(mockPixels, 10, 10, true, 50);

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);

    // Fast-forward 60ms: Frame 2 (seq 2) completes first at t=50ms
    vi.advanceTimersByTime(60);

    // Fast-forward to 210ms: Frame 1 (seq 1) completes second at t=200ms
    vi.advanceTimersByTime(150);

    const metrics = harness.getMetrics();
    expect(metrics.staleFramesDiscarded).toBe(1);
    expect(staleCount).toBe(1);
    expect(staleSeqIds).toContain(1);
  });

  it('should process a batch of frame inputs via runIntegrationBatch', async () => {
    vi.useRealTimers();
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com/batch')]);

    harness = new OpticalScannerHarness({
      reader,
      opticalProfile: { noiseLevel: 5 },
    });

    const mockPixels = new Uint8ClampedArray(400);
    const frames = [
      { pixels: mockPixels, width: 10, height: 10 },
      { pixels: mockPixels, width: 10, height: 10 },
      { pixels: mockPixels, width: 10, height: 10 },
    ];

    const metrics = await harness.runIntegrationBatch(frames);

    expect(metrics.totalFramesPushed).toBe(3);
    expect(metrics.framesProcessed).toBeGreaterThanOrEqual(1);
  });
});
