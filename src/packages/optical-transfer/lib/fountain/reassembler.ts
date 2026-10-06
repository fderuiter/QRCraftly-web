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

import { PrismReceiver } from '../prism/receiver';
import type { OpenedTransfer } from '../prism/session';
import type { PrismManifestInfo } from '../prism/manifest';

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

/**
 * Stateless-entry reassembler: accepts Prism frames in any order from any point in the stream,
 * and on completion verifies and opens the session (decompression within the announced size,
 * SHA-256 check). Shared by the reassembly worker and the main-thread receiver fallback.
 * The old `ur:bytes/` droplets (ADR 0014) are no longer read (#1149).
 */
export class FountainReassembler {
  private readonly prism = new PrismReceiver();

  /**
   * True once all source blocks are resolved and {@link finalize} can run.
   * @returns Completion state.
   */
  public get isComplete(): boolean {
    return this.prism.isComplete;
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
   * Another stream the person may switch to, once.
   * @returns The offered stream, or null.
   */
  public takeSwitchOffer(): PrismManifestInfo | null {
    return this.prism.takeSwitchOffer();
  }

  /**
   * Switches to an offered stream.
   * @param id Session ID from the offer.
   */
  public acceptSwitch(id: string): void {
    this.prism.acceptSwitch(id);
  }

  /**
   * Keeps the current stream and stops offering the other.
   * @param id Session ID from the offer.
   */
  public declineSwitch(id: string): void {
    this.prism.declineSwitch(id);
  }

  /**
   * Sets the key code secret of a private transfer.
   * @param secret The bytes the key code stands for.
   */
  public setKey(secret: Uint8Array): void {
    this.prism.setKey(secret);
  }

  /**
   * Hands in the outer code's module for Prism streams sent with it, or null when it failed to load.
   * @param module The module from `loadFecModule`, or null.
   */
  public provideFecModule(module: WebAssembly.Module | null): void {
    this.prism.provideFecModule(module);
  }

  /** True while a private transfer is waiting for its key code. */
  public get needsKey(): boolean {
    return this.prism.needsKey;
  }

  /**
   * Current progress snapshot, or null before the first droplet.
   * @returns Progress or null.
   */
  public snapshot(): FountainProgress | null {
    return this.prism.snapshot();
  }

  /**
   * Ingests one decoded QR string.
   * @param text Decoded QR text.
   * @returns A progress snapshot when the frame was accepted, otherwise null.
   */
  public ingest(text: string): FountainProgress | null {
    if (this.prism.isComplete) return null;
    return this.prism.ingest(text);
  }

  /**
   * Reconstructs, decompresses and SHA-256-verifies the transferred file.
   * @returns The verified files with their session headers.
   * @throws Error on incomplete decoding or any integrity failure.
   */
  public async finalize(): Promise<OpenedTransfer> {
    return this.prism.finalize();
  }

  /**
   * Key of the last finished session, or null. Pass it to {@link ignoreSession} on a new reassembler.
   * @returns The session key or null.
   */
  public get finishedSessionKey(): string | null {
    return this.prism.finishedSessionId;
  }

  /**
   * Ignores frames of a session that already finished until a frame from another session is accepted.
   * @param key A {@link finishedSessionKey} value.
   */
  public ignoreSession(key: string): void {
    this.prism.ignoreSession(key);
  }

  /**
   * Clears all state for a new stream. The finished session is kept, so its frames stay ignored.
   */
  public reset(): void {
    this.prism.reset();
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
