/*
    QRCraftly
    Copyright (C) 2025 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { FountainDecoder } from './decoder';
import { isFountainDropletString, parseDropletString } from './envelope';
import { PrismReceiver } from '../prism/receiver';
import type { PrismManifestInfo } from '../prism/manifest';
import { FountainSessionHeader, openFountainSession } from './session';
import { LARGE_BLOCK_COUNT } from '../limits';

/**
 * Decoder progress snapshot reported after each accepted droplet.
 */
export interface FountainProgress {
  /** Source block count K. */
  k: number;
  /** Rank of the received equation system (lower bound, equals K when done). */
  rank: number;
  /** Source blocks resolved so far. */
  resolved: number;
  /** Unique droplets accepted for this session. */
  dropletsReceived: number;
  /** Resolved blocks as a percentage of K. */
  progress: number;
}

/** Consecutive droplets from a different session before the reassembler switches to it. */
const SESSION_SWITCH_THRESHOLD = 8;

/** Key prefix that tells a Prism session from a `ur:bytes/` one in {@link FountainReassembler.finishedSessionKey}. */
const PRISM_KEY_PREFIX = 'prism:';

/**
 * Stateless-entry reassembler: accepts Prism frames and legacy `ur:bytes/` droplets in any order
 * from any point in the stream, and on completion verifies and opens the session
 * (decompression within the announced size, SHA-256 check). Shared by the reassembly worker and
 * the main-thread receiver fallback.
 */
export class FountainReassembler {
  private decoder = new FountainDecoder();
  private readonly prism = new PrismReceiver();
  /** Which format the stream being decoded uses; set by the last accepted frame. */
  private format: 'ur' | 'prism' = 'prism';
  private foreignStreak = 0;
  private currentSession: string | null = null;
  /**
   * The last session that finished. Its droplets are ignored until a droplet from another session
   * is accepted, so a camera still pointed at the finished stream can't receive the same file again.
   */
  private finishedSession: string | null = null;

  /**
   * True once all source blocks are resolved and {@link finalize} can run.
   * @returns Completion state.
   */
  public get isComplete(): boolean {
    return this.format === 'prism' ? this.prism.isComplete : this.decoder.isComplete;
  }

  /**
   * The manifest accepted since the last call, once, so the page can show the file's name, size and
   * type before any data has been decoded.
   * @returns The manifest, or null when there is no new one.
   */
  public takeManifest(): PrismManifestInfo | null {
    return this.prism.takeAnnouncement();
  }

  /**
   * A message the person should see (a newer format, a size over the limit), once.
   * @returns The message, or null.
   */
  public takeRejection(): string | null {
    return this.prism.takeRejection();
  }

  /**
   * Current progress snapshot, or null before the first droplet.
   * @returns Progress or null.
   */
  public snapshot(): FountainProgress | null {
    if (this.format === 'prism') return this.prism.snapshot();
    const { k } = this.decoder;
    if (k === null) return null;
    return {
      k,
      rank: this.decoder.rank,
      resolved: this.decoder.resolvedBlockCount,
      dropletsReceived: this.decoder.dropletsReceived,
      progress: this.decoder.progress,
    };
  }

  /**
   * Ingests one decoded QR string.
   * @param text Decoded QR text.
   * @returns A progress snapshot when the droplet was accepted, otherwise null.
   */
  public ingest(text: string): FountainProgress | null {
    if (!isFountainDropletString(text)) {
      if (this.format === 'ur' && this.decoder.isComplete) return null;
      if (this.format === 'prism' && this.prism.isComplete) return null;
      const progress = this.prism.ingest(text);
      if (progress) this.format = 'prism';
      return progress;
    }
    if (this.format === 'prism' ? this.prism.isComplete : this.decoder.isComplete) return null;
    const parsed = parseDropletString(text);
    if (!parsed) return null;
    const { k, messageLength, checksum } = parsed.meta;
    const session = `${k}:${messageLength}:${checksum}:${parsed.data.length}`;
    if (session === this.finishedSession) return null;

    // A stream claiming a very large block count must repeat before decoder tables (tens of MB)
    // are built for it, so a flood of one-off bogus droplets cannot churn memory.
    if (this.decoder.k === null && parsed.meta.k > LARGE_BLOCK_COUNT && !this.confirmLargeSession(parsed.meta)) {
      return null;
    }

    if (!this.decoder.matchesSession(parsed.meta, parsed.data.length)) {
      this.foreignStreak += 1;
      if (this.foreignStreak < SESSION_SWITCH_THRESHOLD) return null;
      this.decoder.reset();
    }
    this.foreignStreak = 0;

    const before = this.decoder.dropletsReceived;
    this.decoder.ingest(parsed.meta, parsed.data);
    if (this.decoder.dropletsReceived === before) return null;
    this.currentSession = session;
    this.finishedSession = null;
    this.format = 'ur';
    return this.snapshot();
  }

  private candidate: { key: string; count: number } | null = null;

  /** True once the same large-K session has been seen {@link SESSION_SWITCH_THRESHOLD} times in a row. */
  private confirmLargeSession(meta: { k: number; messageLength: number; checksum: number }): boolean {
    const key = `${meta.k}:${meta.messageLength}:${meta.checksum}`;
    this.candidate = this.candidate?.key === key ? { key, count: this.candidate.count + 1 } : { key, count: 1 };
    return this.candidate.count >= SESSION_SWITCH_THRESHOLD;
  }

  /**
   * Reconstructs, decompresses and SHA-256-verifies the transferred file.
   * @returns The verified file bytes and its session header.
   * @throws Error on incomplete decoding or any integrity failure.
   */
  public async finalize(): Promise<{ data: Uint8Array; header: FountainSessionHeader }> {
    if (this.format === 'prism') return this.prism.finalize();
    const message = this.decoder.finalize();
    if (!message) throw new Error('Fountain decoding is not complete.');
    const opened = await openFountainSession(message);
    this.finishedSession = this.currentSession;
    return opened;
  }

  /**
   * Key of the last finished session, or null. Pass it to {@link ignoreSession} on a new reassembler.
   * @returns The session key or null.
   */
  public get finishedSessionKey(): string | null {
    if (this.format === 'prism' && this.prism.finishedSessionId) return `${PRISM_KEY_PREFIX}${this.prism.finishedSessionId}`;
    return this.finishedSession;
  }

  /**
   * Ignores droplets of a session that already finished until a droplet from another session is accepted.
   * @param key A {@link finishedSessionKey} value.
   */
  public ignoreSession(key: string): void {
    if (key.startsWith(PRISM_KEY_PREFIX)) this.prism.ignoreSession(key.slice(PRISM_KEY_PREFIX.length));
    else this.finishedSession = key;
  }

  /**
   * Clears all state for a new stream. The finished session is kept, so its droplets stay ignored.
   */
  public reset(): void {
    this.prism.reset();
    this.decoder.reset();
    this.foreignStreak = 0;
    this.currentSession = null;
    this.candidate = null;
  }
}

/**
 * Receiver-side telemetry derived from decoder progress and scan timing.
 */
export interface FountainTelemetry extends FountainProgress {
  /** Droplet QR codes decoded per second over the recent window. */
  fps: number;
  /** Estimated seconds until completion, or null when unknown. */
  etaSeconds: number | null;
}

/**
 * Tracks scan throughput (decoded droplets per second over a sliding window)
 * and estimates time remaining for a rateless transfer.
 */
export class FountainRateTracker {
  private stamps: number[] = [];

  constructor(private readonly windowMs = 2000) {}

  /**
   * Records one decoded droplet frame.
   * @param now Timestamp in milliseconds.
   */
  public record(now: number): void {
    this.stamps.push(now);
    const cutoff = now - this.windowMs;
    while (this.stamps.length > 0 && this.stamps[0] < cutoff) this.stamps.shift();
  }

  /**
   * Droplet frames per second over the window ending at `now`.
   * @param now Timestamp in milliseconds.
   * @returns Frames per second (0 when idle).
   */
  public fps(now: number): number {
    const cutoff = now - this.windowMs;
    const recent = this.stamps.filter(t => t >= cutoff);
    if (recent.length < 2) return 0;
    const span = Math.max(recent[recent.length - 1] - recent[0], 1);
    return ((recent.length - 1) * 1000) / span;
  }

  /**
   * Combines a progress snapshot with the current rate into telemetry.
   * Remaining work assumes the typical ~20% Robust Soliton reception overhead
   * over K, and never less than the missing rank.
   * @param progress Decoder progress.
   * @param now Timestamp in milliseconds.
   * @returns Telemetry including FPS and ETA.
   */
  public telemetry(progress: FountainProgress, now: number): FountainTelemetry {
    const fps = this.fps(now);
    const remaining = Math.max(progress.k - progress.rank, Math.ceil(progress.k * 1.2) - progress.dropletsReceived, 0);
    const etaSeconds = remaining === 0 ? 0 : fps > 0 ? remaining / fps : null;
    return { ...progress, fps, etaSeconds };
  }

  /**
   * Clears recorded timestamps.
   */
  public reset(): void {
    this.stamps = [];
  }
}
