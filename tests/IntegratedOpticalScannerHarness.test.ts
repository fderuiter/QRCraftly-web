// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpticalScannerHarness, type HarnessFrameResult } from './utils/OpticalScannerHarness';
import { fakeQrRead } from './utils/fakeQrRead';

const qrRead = vi.fn();
/** The harness's reader, scripted per test. */
const reader = { read: qrRead };

describe('Integrated Optical Scanner Test Harness - Integration Suite', () => {
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

  it('Acceptance Criteria 1: Harness executes automated integration runs combining frame scheduling, worker queues, and optical blur evaluations', () => {
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com/e2e-pass')]);

    const frameResults: HarnessFrameResult[] = [];
    harness = new OpticalScannerHarness({
      reader,
      opticalProfile: { enabled: true },
      workerConfig: { latencyMs: 20 },
      onFrameProcessed: (res) => frameResults.push(res),
    });

    harness.start();
    const mockPixels = new Uint8ClampedArray(400);

    // Push 3 frames with 30ms intervals so backpressure permits each after worker latency 20ms completes
    const seq1 = harness.pushFrame(mockPixels, 10, 10);
    expect(seq1).toBe(1);

    vi.advanceTimersByTime(30);

    const seq2 = harness.pushFrame(mockPixels, 10, 10);
    expect(seq2).toBe(2);

    vi.advanceTimersByTime(30);

    const seq3 = harness.pushFrame(mockPixels, 10, 10);
    expect(seq3).toBe(3);

    vi.advanceTimersByTime(30);

    const metrics = harness.getMetrics();
    expect(metrics.totalFramesPushed).toBe(3);
    expect(metrics.framesAccepted).toBe(3);
    expect(metrics.framesBackpressured).toBe(0);
    expect(metrics.framesProcessed).toBe(3);
    expect(metrics.scannabilityPassRate).toBe(100);
    expect(frameResults).toHaveLength(3);
  });

  it('Acceptance Criteria 2: Harness verifies scheduler backpressure locks reject excess incoming frame requests during worker latency spikes', () => {
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com/latency-spike')]);

    const droppedSeqIds: (number | null)[] = [];
    harness = new OpticalScannerHarness({
      reader,
      workerConfig: { latencyMs: 500 }, // Heavy latency spike
      onBackpressureDrop: (seq) => droppedSeqIds.push(seq),
    });

    harness.start();
    const mockPixels = new Uint8ClampedArray(400);

    // Frame 1 accepted
    const seq1 = harness.pushFrame(mockPixels, 10, 10);
    expect(seq1).toBe(1);

    // Frames 2..10 pushed rapidly while Frame 1 is still in flight (latency = 500ms)
    for (let i = 0; i < 9; i++) {
      const seq = harness.pushFrame(mockPixels, 10, 10);
      expect(seq).toBeNull();
    }

    const metrics = harness.getMetrics();
    expect(metrics.totalFramesPushed).toBe(10);
    expect(metrics.framesAccepted).toBe(1);
    expect(metrics.framesBackpressured).toBe(9);
    expect(droppedSeqIds).toHaveLength(9);

    // Advance timers past latency spike
    vi.advanceTimersByTime(550);

    // After spike resolves, next frame is accepted cleanly
    const seqNext = harness.pushFrame(mockPixels, 10, 10);
    expect(seqNext).toBe(2);
  });

  it('Acceptance Criteria 3: System verifies simulated worker stalls trigger starvation watchdog to recreate worker instances', () => {
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com/watchdog-test')]);

    let watchdogFired = false;
    let workerRecreated = false;

    let nowTime = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => nowTime);

    harness = new OpticalScannerHarness({
      reader,
      workerConfig: { stallWorker: true },
      onWatchdogTriggered: () => {
        watchdogFired = true;
      },
      onWorkerRecreated: () => {
        workerRecreated = true;
      },
    });

    harness.start();
    const mockPixels = new Uint8ClampedArray(400);

    const seq1 = harness.pushFrame(mockPixels, 10, 10);
    expect(seq1).toBe(1);

    // Advance fake time past the 5000ms hang budget
    nowTime = 10200;
    vi.advanceTimersByTime(5200);

    expect(watchdogFired).toBe(true);
    expect(workerRecreated).toBe(true);

    const metrics = harness.getMetrics();
    expect(metrics.watchdogTriggers).toBe(1);
    expect(metrics.workerRecreations).toBe(1);

    // Pipeline recovers, subsequent frames accepted
    harness.setWorkerConfig({ stallWorker: false });
    const seq2 = harness.pushFrame(mockPixels, 10, 10);
    expect(seq2).toBe(2);
  });

  it('Acceptance Criteria 4: Harness asserts out-of-order execution responses with outdated sequence identifiers are discarded', () => {
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com/out-of-order')]);

    const discardedSeqIds: number[] = [];
    harness = new OpticalScannerHarness({
      reader,
      onStaleFrameDiscarded: (seq) => discardedSeqIds.push(seq),
    });

    harness.start();
    const mockPixels = new Uint8ClampedArray(400);

    // Frame 1 (seq 1) pushed with 300ms worker latency
    const seq1 = harness.pushFrame(mockPixels, 10, 10, false, 300);
    // Frame 2 (seq 2) forced with 50ms worker latency
    const seq2 = harness.pushFrame(mockPixels, 10, 10, true, 50);

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);

    // At t=60ms, Frame 2 finishes first -> completedSequenceId = 2
    vi.advanceTimersByTime(60);

    // At t=310ms, Frame 1 finishes -> sequenceId (1) <= completedSequenceId (2), discarded as stale
    vi.advanceTimersByTime(250);

    const metrics = harness.getMetrics();
    expect(metrics.staleFramesDiscarded).toBe(1);
    expect(discardedSeqIds).toEqual([1]);
  });

  it('Acceptance Criteria 5: System returns expected optical scannability classifications when processing frames through the print simulation', () => {
    const mockPixels = new Uint8ClampedArray(400);

    harness = new OpticalScannerHarness({ reader });
    harness.start();

    // 1. Scannable (pass digital, pass optical)
    qrRead.mockReturnValue([fakeQrRead('https://qrcraftly.com/valid')]);
    const eval1 = harness.evaluateScannability(mockPixels, 10, 10);
    expect(eval1.scannabilityClassification).toBe('scannable');

    // 2. Degraded (pass digital, fail optical)
    qrRead
      .mockReturnValueOnce([fakeQrRead('https://qrcraftly.com/valid')]) // digital
      .mockReturnValueOnce([]) // optical
      .mockReturnValueOnce([]); // optical (inverted)

    const eval2 = harness.evaluateScannability(mockPixels, 10, 10);
    expect(eval2.scannabilityClassification).toBe('degraded');

    // 3. Unscannable (fail digital)
    qrRead.mockReturnValue([]);
    const eval3 = harness.evaluateScannability(mockPixels, 10, 10);
    expect(eval3.scannabilityClassification).toBe('unscannable');
  });
});
