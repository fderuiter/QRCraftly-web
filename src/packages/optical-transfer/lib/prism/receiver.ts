/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { FountainDecoder } from '../fountain/decoder';
import type { FountainProgress } from '../fountain/reassembler';
import { bytesToHex, type FountainSessionHeader } from '../fountain/session';
import { LARGE_BLOCK_COUNT, formatLimit, MAX_RECEIVE_BYTES } from '../limits';
import { FLAG_ENCRYPTED, decodeFrame, type PrismFrame } from './frame';
import { decodeManifest, describeManifest, sessionIdOf, type PrismManifest, type PrismManifestInfo } from './manifest';
import { openPrismSession } from './session';

/** Frames of another session before the receiver switches to it. */
const SESSION_SWITCH_THRESHOLD = 8;
/** Manifests of other sessions the receiver remembers while it decodes one. */
const MAX_CANDIDATES = 4;

interface Session {
  id: string;
  manifest: PrismManifest;
  info: PrismManifestInfo;
}

/**
 * Receives a Prism stream: reads the manifest, enforces the receive limits from it before any
 * decoder memory exists, feeds symbols to the fountain decoder and opens the verified file.
 * Frames of the stream may arrive in any order, from any point, with any frame lost.
 */
export class PrismReceiver {
  private decoder = new FountainDecoder();
  private session: Session | null = null;
  private readonly candidates = new Map<string, Session>();
  private foreignStreak = 0;
  private finished: string | null = null;
  private announcement: PrismManifestInfo | null = null;
  private rejection: string | null = null;
  private reportedVersion = false;
  private largeCandidate: { id: string; count: number } | null = null;

  /** True once every source block is resolved and {@link finalize} can run. */
  public get isComplete(): boolean {
    return this.decoder.isComplete;
  }

  /** The accepted manifest, or null before one arrived. */
  public get manifest(): PrismManifestInfo | null {
    return this.session?.info ?? null;
  }

  /** Key of the last finished session, or null. */
  public get finishedSessionId(): string | null {
    return this.finished;
  }

  /** Progress of the current session, or null before its first symbol. */
  public snapshot(): FountainProgress | null {
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

  /** The manifest accepted since the last call, once. The page shows it as soon as it arrives. */
  public takeAnnouncement(): PrismManifestInfo | null {
    const announced = this.announcement;
    this.announcement = null;
    return announced;
  }

  /** A message worth telling the person (a newer format, a size over the limit), once. */
  public takeRejection(): string | null {
    const message = this.rejection;
    this.rejection = null;
    return message;
  }

  /**
   * Ingests one decoded QR text.
   * @param text - Text read from a QR code.
   * @returns Progress when a symbol was accepted, otherwise null.
   */
  public ingest(text: string): FountainProgress | null {
    const decoded = decodeFrame(text);
    if (!decoded.ok) {
      if (decoded.reason === 'unsupported-version' && !this.reportedVersion) {
        this.reportedVersion = true;
        this.rejection = 'This transfer uses a newer version of the QRCraftly format. Update QRCraftly on this device to receive it.';
      }
      return null;
    }
    return decoded.frame.type === 'manifest' ? this.ingestManifest(decoded.frame) : this.ingestData(decoded.frame);
  }

  private ingestManifest(frame: Extract<PrismFrame, { type: 'manifest' }>): null {
    if (frame.sessionId === this.finished || frame.sessionId === this.session?.id) return null;
    // The session ID is the manifest's own hash, so a manifest that does not match is a corrupt or forged one.
    if (bytesToHex(sessionIdOf(frame.manifest)) !== frame.sessionId) return null;
    const result = decodeManifest(frame.manifest);
    if (!result.ok) {
      if (result.reason === 'too-large') {
        this.rejection = `File transfer rejected: the sender claims a size beyond the ${formatLimit(MAX_RECEIVE_BYTES)} limit.`;
      }
      return null;
    }
    const info = describeManifest(result.manifest, frame.sessionId);
    // A huge block count must repeat before decoder tables are built for it.
    if (info.k > LARGE_BLOCK_COUNT && !this.confirmLarge(frame.sessionId)) return null;

    const session: Session = { id: frame.sessionId, manifest: result.manifest, info };
    if (!this.session || this.decoder.dropletsReceived === 0) {
      this.adopt(session);
    } else {
      if (this.candidates.size >= MAX_CANDIDATES) this.candidates.delete(this.candidates.keys().next().value as string);
      this.candidates.set(session.id, session);
    }
    return null;
  }

  private confirmLarge(id: string): boolean {
    this.largeCandidate = this.largeCandidate?.id === id ? { id, count: this.largeCandidate.count + 1 } : { id, count: 1 };
    return this.largeCandidate.count >= SESSION_SWITCH_THRESHOLD;
  }

  private adopt(session: Session): void {
    this.decoder.reset();
    this.foreignStreak = 0;
    this.session = session;
    this.candidates.delete(session.id);
    this.announcement = session.info;
  }

  private ingestData(frame: Extract<PrismFrame, { type: 'data' }>): FountainProgress | null {
    if (frame.sessionId === this.finished) return null;
    // Private transfers and multi-block sessions arrive with later work; their frames are not mistaken for plain ones.
    if (frame.blockNumber !== 0 || frame.flags & FLAG_ENCRYPTED || frame.firstSymbol < 1) return null;

    const current = this.session;
    if (!current || frame.sessionId !== current.id) {
      this.foreignStreak += 1;
      const next = this.candidates.get(frame.sessionId);
      if (next && this.foreignStreak >= SESSION_SWITCH_THRESHOLD) this.adopt(next);
      return null;
    }
    this.foreignStreak = 0;

    const { manifest } = current;
    const size = manifest.symbolSize;
    if (frame.symbols.length !== size * frame.count) return null;
    const before = this.decoder.dropletsReceived;
    for (let i = 0; i < frame.count; i++) {
      this.decoder.ingest(
        { seq: frame.firstSymbol + i, k: current.info.k, messageLength: manifest.transferLength, checksum: manifest.transferCrc32 },
        frame.symbols.subarray(i * size, (i + 1) * size)
      );
    }
    return this.decoder.dropletsReceived === before ? null : this.snapshot();
  }

  /**
   * Rebuilds, decompresses and verifies the file.
   * @returns The verified file bytes and header.
   * @throws Error when decoding is incomplete or any integrity check fails.
   */
  public async finalize(): Promise<{ data: Uint8Array; header: FountainSessionHeader }> {
    const message = this.decoder.finalize();
    if (!message || !this.session) throw new Error('Decoding is not complete.');
    const opened = await openPrismSession(message, this.session.manifest);
    this.finished = this.session.id;
    return opened;
  }

  /** Ignores a session that already finished until another session's frames arrive. */
  public ignoreSession(id: string): void {
    this.finished = id;
  }

  /** Clears the stream's state. The finished session stays ignored. */
  public reset(): void {
    this.decoder.reset();
    this.session = null;
    this.candidates.clear();
    this.foreignStreak = 0;
    this.announcement = null;
    this.rejection = null;
    this.largeCandidate = null;
  }
}
