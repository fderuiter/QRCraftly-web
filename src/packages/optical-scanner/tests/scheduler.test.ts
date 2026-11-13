import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DoubleBufferPool, AdaptiveFrameScheduler } from '../scheduler';

describe('DoubleBufferPool', () => {
  it('should initialize and resize pool correctly', () => {
    const pool = new DoubleBufferPool(10, 10);
    expect(pool.getPoolSize()).toBe(2);

    pool.resize(20, 20);
    expect(pool.getPoolSize()).toBe(2);

    // Call resize with same dimensions
    pool.resize(20, 20);
    expect(pool.getPoolSize()).toBe(2);
  });

  it('should acquire and release buffers', () => {
    const pool = new DoubleBufferPool(10, 10, 4);
    const buf1 = pool.acquire();
    const buf2 = pool.acquire();
    expect(pool.getPoolSize()).toBe(0);

    const buf3 = pool.acquire(); // Dynamic replenishment allocation
    expect(buf3.byteLength).toBe(10 * 10 * 4);

    pool.release(buf1);
    expect(pool.getPoolSize()).toBe(1);

    // Release redundant or mismatched buffer
    pool.release(buf1); // duplicate check
    expect(pool.getPoolSize()).toBe(1);

    const badBuf = new ArrayBuffer(5);
    pool.release(badBuf); // size mismatch check
    expect(pool.getPoolSize()).toBe(1);

    pool.clear();
    expect(pool.getPoolSize()).toBe(0);
  });

  it('should dynamically replenish missing buffers and enforce maxBuffers capacity cap', () => {
    const pool = new DoubleBufferPool(10, 10, 3); // Max cap 3
    expect(pool.getPoolSize()).toBe(2);
    expect(pool.getMaxBuffers()).toBe(3);

    // Acquire all pre-allocated buffers
    const b1 = pool.acquire();
    const b2 = pool.acquire();
    expect(pool.getPoolSize()).toBe(0);

    // Acquire when pool is empty (simulating dropped zero-copy transfers)
    const b3 = pool.acquire();
    const b4 = pool.acquire();
    expect(b3.byteLength).toBe(400);
    expect(b4.byteLength).toBe(400);

    // Release buffers back up to maxBuffers cap (3)
    pool.release(b1);
    pool.release(b2);
    pool.release(b3);
    expect(pool.getPoolSize()).toBe(3);

    // Releasing beyond maxBuffers capacity cap is ignored to prevent unconstrained memory usage
    pool.release(b4);
    expect(pool.getPoolSize()).toBe(3);
  });
});

describe('AdaptiveFrameScheduler', () => {
  let mockTime = 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    mockTime = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should handle start, stop, and basic lifecycle', () => {
    const onStatusChange = vi.fn();
    const scheduler = new AdaptiveFrameScheduler({ onStatusChange });

    expect(scheduler.getInFlight()).toBe(false);
    expect(scheduler.getSamplingDelay()).toBe(33);
    expect(scheduler.getLatencyHistory()).toEqual([]);

    scheduler.start();
    expect(scheduler.getWatchdogTimeout()).toBe(5000);

    scheduler.setWatchdogTimeout(2000);
    expect(scheduler.getWatchdogTimeout()).toBe(2000);

    const seqId = scheduler.beginFrame();
    expect(seqId).toBe(1);
    expect(scheduler.getInFlight()).toBe(true);
    expect(onStatusChange).toHaveBeenCalledWith('checking');

    // Attempt concurrent frame request (backpressure)
    const seqId2 = scheduler.beginFrame();
    expect(seqId2).toBeNull();

    scheduler.stop();
    expect(scheduler.getInFlight()).toBe(false);
  });

  it('should end frames and scale sampling delay dynamically', () => {
    const onDelayChange = vi.fn();
    const onLatencyHistoryChange = vi.fn();
    const onScanFail = vi.fn();
    const scheduler = new AdaptiveFrameScheduler({
      minSamplingDelay: 10,
      maxSamplingDelay: 1000,
      onDelayChange,
      onLatencyHistoryChange,
      onScanFail,
    });

    scheduler.start();

    // End frame with stale error
    const seq1 = scheduler.beginFrame();
    scheduler.endFrame(seq1!, 'fail', null, 'STALE_FRAME');
    expect(scheduler.getInFlight()).toBe(false);

    // Fast frame to scale up
    const seq2 = scheduler.beginFrame();
    mockTime += 5; // Simulate 5ms latency
    scheduler.endFrame(seq2!, 'pass', 'data', null);
    expect(scheduler.getInFlight()).toBe(false);
    const prevDelay = scheduler.getSamplingDelay();
    expect(prevDelay).toBeLessThan(33); // Latency < 40ms triggers increase in capture frequency (smaller delay)

    // Normal successful frame (high latency)
    const seq3 = scheduler.beginFrame();
    mockTime += 200; // Simulate 200ms latency
    scheduler.endFrame(seq3!, 'pass', 'data', null);
    expect(scheduler.getSamplingDelay()).toBeGreaterThan(prevDelay); // Latency > 100ms triggers decrease in capture frequency

    // Older out of order frame should be discarded
    const seq4 = scheduler.beginFrame();
    const seq5 = scheduler.beginFrame(true); // force
    const mockRecycled = new ArrayBuffer(0);
    scheduler.endFrame(seq5!, 'pass', 'data', null, mockRecycled);
    scheduler.endFrame(seq4!, 'pass', 'data', null); // Should return early as out-of-order

    // Fail frame with error
    const seqFail = scheduler.beginFrame(true);
    scheduler.endFrame(seqFail!, 'fail', null, 'some_error');
    expect(onScanFail).toHaveBeenCalledWith('some_error');

    // Fail frame with empty error
    const seqFail2 = scheduler.beginFrame(true);
    scheduler.endFrame(seqFail2!, 'fail', null, null);
    expect(onScanFail).toHaveBeenCalledWith(undefined);

    // Shift history by having 6 iterations (capacity 5)
    for (let i = 0; i < 6; i++) {
      const seq = scheduler.beginFrame(true);
      scheduler.endFrame(seq!, 'pass', 'data', null);
    }
    expect(scheduler.getLatencyHistory().length).toBe(5);
  });

  it('should ignore single isolated frame spike and not increase sampling delay', () => {
    const scheduler = new AdaptiveFrameScheduler({
      minSamplingDelay: 10,
      maxSamplingDelay: 1000,
    });
    scheduler.start();

    // Establish healthy history of 4 frames at 20ms
    for (let i = 0; i < 4; i++) {
      const seq = scheduler.beginFrame(true);
      mockTime += 20;
      scheduler.endFrame(seq!, 'pass', 'data', null);
    }
    const delayBeforeSpike = scheduler.getSamplingDelay();

    // Isolated single-frame spike of 300ms
    const seqSpike = scheduler.beginFrame(true);
    mockTime += 300;
    scheduler.endFrame(seqSpike!, 'pass', 'data', null);

    // Median of [20, 20, 20, 20, 300] is 20ms, so delay should NOT increase
    expect(scheduler.getSamplingDelay()).toBeLessThanOrEqual(delayBeforeSpike);
  });

  it('settles near 1.2x a steady decode latency instead of ratcheting to the maximum (#1096)', () => {
    const scheduler = new AdaptiveFrameScheduler({ minSamplingDelay: 16, maxSamplingDelay: 1000 });
    scheduler.start();

    const delays: number[] = [];
    for (let i = 0; i < 30; i++) {
      const seq = scheduler.beginFrame(true);
      mockTime += 150;
      scheduler.endFrame(seq!, 'fail', null, null);
      delays.push(scheduler.getSamplingDelay());
    }
    // The old rule added 50 ms per slow frame and reached 1000 ms after about 16 frames.
    expect(Math.max(...delays)).toBeLessThanOrEqual(250);
    expect(scheduler.getSamplingDelay()).toBeGreaterThanOrEqual(150);
    expect(new Set(delays.slice(-10)).size).toBe(1);
  });

  it('rises gradually, so one slow burst does not pin sampling at the maximum', () => {
    const scheduler = new AdaptiveFrameScheduler({ minSamplingDelay: 16, maxSamplingDelay: 1000 });
    scheduler.start();
    for (let i = 0; i < 5; i++) {
      const seq = scheduler.beginFrame(true);
      mockTime += 2000;
      scheduler.endFrame(seq!, 'fail', null, null);
    }
    expect(scheduler.getSamplingDelay()).toBeLessThanOrEqual(1000);
    expect(scheduler.getSamplingDelay()).toBeGreaterThan(500);
  });

  it('returns to the minimum delay as soon as the median latency is healthy again', () => {
    const scheduler = new AdaptiveFrameScheduler({ minSamplingDelay: 16, maxSamplingDelay: 1000 });
    scheduler.start();
    for (let i = 0; i < 10; i++) {
      const seq = scheduler.beginFrame(true);
      mockTime += 900;
      scheduler.endFrame(seq!, 'fail', null, null);
    }
    expect(scheduler.getSamplingDelay()).toBeGreaterThanOrEqual(990);

    // Three fast frames turn the 5-frame median healthy.
    for (let i = 0; i < 3; i++) {
      const seq = scheduler.beginFrame(true);
      mockTime += 10;
      scheduler.endFrame(seq!, 'pass', 'data', null);
    }
    expect(scheduler.getSamplingDelay()).toBe(16);
  });

  it('recovers from the maximum delay when decodes settle at a moderate 40-100 ms', () => {
    const scheduler = new AdaptiveFrameScheduler({ minSamplingDelay: 16, maxSamplingDelay: 1000 });
    scheduler.start();

    for (let i = 0; i < 10; i++) {
      const seq = scheduler.beginFrame(true);
      mockTime += 900;
      scheduler.endFrame(seq!, 'fail', null, null);
    }
    expect(scheduler.getSamplingDelay()).toBeGreaterThanOrEqual(990);

    // Dense QR codes decode in about 70 ms: the delay must fall back towards that, not stay at 1 fps.
    for (let i = 0; i < 20; i++) {
      const seq = scheduler.beginFrame(true);
      mockTime += 70;
      scheduler.endFrame(seq!, 'fail', null, null);
    }
    expect(scheduler.getSamplingDelay()).toBe(84);
  });

  it('measures the hang budget from the last heartbeat, not from when the frame started', () => {
    const onWatchdogTriggered = vi.fn();
    const scheduler = new AdaptiveFrameScheduler({ onWatchdogTriggered });
    scheduler.start();
    scheduler.beginFrame();
    mockTime += 4000;
    scheduler.heartbeat();
    mockTime += 4000;
    expect(scheduler.checkWatchdog()).toBe(false);
    mockTime += 1100;
    expect(scheduler.checkWatchdog()).toBe(true);
    expect(onWatchdogTriggered).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('should handle watchdog checking and triggers', () => {
    const onWatchdogTriggered = vi.fn();
    const scheduler = new AdaptiveFrameScheduler({ onWatchdogTriggered });

    scheduler.start();
    expect(scheduler.checkWatchdog()).toBe(false);

    scheduler.beginFrame();
    mockTime += 4900;
    expect(scheduler.checkWatchdog()).toBe(false);
    mockTime += 200;

    // On-demand watchdog check
    expect(scheduler.checkWatchdog()).toBe(true);
    expect(onWatchdogTriggered).toHaveBeenCalledTimes(1);

    // Trigger recovery redundantly (should guard against it)
    scheduler.triggerRecovery(2000);
    expect(onWatchdogTriggered).toHaveBeenCalledTimes(1);
    expect(scheduler.getInFlight()).toBe(false);
    scheduler.stop();
  });

  it('should trigger watchdog automatically via setInterval', () => {
    const onWatchdogTriggered = vi.fn();
    const scheduler = new AdaptiveFrameScheduler({ onWatchdogTriggered });

    scheduler.start();
    scheduler.beginFrame();

    mockTime += 5200;
    vi.advanceTimersByTime(5200); // Trigger setInterval
    expect(onWatchdogTriggered).toHaveBeenCalled();

    scheduler.stop();
  });
});

describe('AdaptiveFrameScheduler.retireFrame (#1699)', () => {
  it('frees the newest frame silently: no result, no latency, no status', () => {
    const onScanFail = vi.fn();
    const onStatusChange = vi.fn();
    const onLatencyHistoryChange = vi.fn();
    const scheduler = new AdaptiveFrameScheduler({ onScanFail, onStatusChange, onLatencyHistoryChange });
    scheduler.start();
    const seq = scheduler.beginFrame();
    onStatusChange.mockClear();
    expect(seq).not.toBeNull();
    scheduler.retireFrame(seq ?? -1);

    expect(scheduler.getInFlight()).toBe(false);
    expect(scheduler.getStartTimeMap().size).toBe(0);
    expect(onScanFail).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(onLatencyHistoryChange).not.toHaveBeenCalled();
    // A late answer for the retired frame counts for nothing either.
    scheduler.endFrame(seq ?? -1, 'pass', 'LATE');
    expect(scheduler.getLatencyHistory()).toEqual([]);
    scheduler.stop();
  });

  it('keeps backpressure for a newer frame in flight', () => {
    const scheduler = new AdaptiveFrameScheduler();
    scheduler.start();
    const older = scheduler.beginFrame();
    scheduler.triggerRecovery(0, false);
    const newer = scheduler.beginFrame();
    expect(newer).not.toBeNull();
    scheduler.retireFrame(older ?? -1);
    expect(scheduler.getInFlight()).toBe(true);
    expect(scheduler.beginFrame()).toBeNull();
    scheduler.stop();
  });
});
