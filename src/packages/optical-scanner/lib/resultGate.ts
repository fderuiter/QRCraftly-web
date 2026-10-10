/**
 * Multi-frame confirmation for camera results (#1099).
 *
 * A camera scan accepts a code only once two decodes agree, so a rare misread on one frame is never
 * acted on. The decodes agree when they are within {@link ResultGateOptions.windowMs} of each other,
 * or when at most {@link ResultGateOptions.windowMisses} attempts missed in between: a slow phone
 * reads a frame every second or two, and a code that only some decode strategies read is found on
 * every second or fourth frame, so a time window alone would never confirm it (#1292). The native
 * detector is trusted on one frame. In continuous mode the same payload is not emitted again until the hold period has passed,
 * however many frames keep reading it.
 */
import type { ScanDecoder } from './contracts';

export interface ResultGateOptions {
  /** Agreeing decodes needed before a non-native result is accepted: 1 or 2 (default 2). */
  confirmations?: 1 | 2;
  /** How close together the agreeing decodes must be, in milliseconds (default 500). */
  windowMs?: number;
  /**
   * How many attempts may miss between two agreeing decodes, however long they took (default:
   * unset, so only the time window counts).
   */
  windowMisses?: number;
  /** How long an emitted payload is not emitted again, in milliseconds (default 3000; 0 = never held). */
  holdMs?: number;
}

export interface ResultGate {
  /**
   * Offers a decode at time `now`.
   * @returns Whether to emit it.
   */
  offer(text: string, decoder: ScanDecoder, now: number): boolean;
  /** Records an attempt that found no code. */
  miss(): void;
  /** Forgets candidates and held payloads (a new scan session). */
  reset(): void;
}

export const DEFAULT_CONFIRM_WINDOW_MS = 500;
export const DEFAULT_REPEAT_HOLD_MS = 3000;

/**
 * Creates a result gate.
 * @param options Confirmations, window and hold.
 */
export function createResultGate(options: ResultGateOptions = {}): ResultGate {
  const confirmations = options.confirmations ?? 2;
  const windowMs = options.windowMs ?? DEFAULT_CONFIRM_WINDOW_MS;
  const holdMs = options.holdMs ?? DEFAULT_REPEAT_HOLD_MS;
  const { windowMisses } = options;

  /** The last decode: its text, when it came and how many attempts have missed since. */
  let candidate: { text: string; at: number; misses: number } | null = null;
  const emittedAt = new Map<string, number>();

  return {
    offer(text, decoder, now) {
      const confirmed =
        confirmations === 1 ||
        decoder === 'native' ||
        (candidate !== null &&
          candidate.text === text &&
          (now - candidate.at <= windowMs || (windowMisses !== undefined && candidate.misses <= windowMisses)));
      candidate = { text, at: now, misses: 0 };
      if (!confirmed) return false;

      if (holdMs > 0) {
        const last = emittedAt.get(text);
        if (last !== undefined && now - last < holdMs) return false;
        for (const [payload, at] of emittedAt) {
          if (now - at >= holdMs) emittedAt.delete(payload);
        }
        emittedAt.set(text, now);
      }
      return true;
    },
    miss() {
      if (candidate) candidate.misses += 1;
    },
    reset() {
      candidate = null;
      emittedAt.clear();
    },
  };
}
