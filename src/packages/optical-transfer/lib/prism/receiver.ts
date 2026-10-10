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

import { FecDecoder } from '../fec/codec';
import { FountainDecoder } from '../fountain/decoder';
import type { FountainProgress } from '../fountain/reassembler';
import { bytesToHex } from '../fountain/session';
import { LARGE_BLOCK_COUNT, formatLimit, MAX_RECEIVE_BYTES } from '../limits';
import { ENCRYPTION_AES_GCM, deriveKeys, privateSessionId, type PrivateKeys } from './crypto';
import { FLAG_ENCRYPTED, FLAG_OUTER_CODE, decodeFrame, type PrismFrame } from './frame';
import {
  decodeManifest,
  describeManifest,
  fecLayoutOf,
  sessionIdOf,
  usesOuterCode,
  type PrismManifest,
  type PrismManifestInfo,
} from './manifest';
import { openPrismSession, type OpenedTransfer } from './session';

/** Frames of another session before the receiver offers to switch to it. */
const SESSION_SWITCH_THRESHOLD = 8;
/** Manifests of other sessions the receiver remembers while it decodes one. */
const MAX_CANDIDATES = 4;

interface Session {
  id: string;
  manifest: PrismManifest;
  manifestBytes: Uint8Array;
  info: PrismManifestInfo;
  /** Keys of a private session once the key code matched; null while it is waiting for one. */
  keys: PrivateKeys | null;
}

const isPrivate = (manifest: PrismManifest): boolean => manifest.encryption !== 0;

/** Shown when a stream needs the outer code and this browser could not load it. */
export const OUTER_CODE_UNAVAILABLE = 'This transfer needs a newer browser. Try the latest Chrome, Edge, Firefox or Safari.';

/**
 * Receives a Prism stream: reads the manifest, enforces the receive limits from it before any
 * decoder memory exists, feeds symbols to the decoder its version names (the LT fountain decoder,
 * or the outer code's) and opens the verified file. Frames of the stream may arrive in any order,
 * from any point, with any frame lost.
 *
 * The outer code runs in WebAssembly, handed in with {@link provideFecModule}. Until then a
 * version-2 manifest is passed over (it repeats every 16 frames); once the module is known to be
 * missing, the person is told their browser cannot receive the transfer.
 *
 * A private transfer needs its key code. Once a key code is set, only a private transfer made with
 * that key is accepted, and no other stream can replace it. An unencrypted transfer in progress is
 * never replaced silently: another stream is offered, and the person decides.
 */
export class PrismReceiver {
  private decoder = new FountainDecoder();
  /** The outer code's decoder while the current session is version 2. */
  private fec: FecDecoder | null = null;
  /** The compiled outer-code module; undefined while it loads, null when it cannot be loaded. */
  private fecModule: WebAssembly.Module | null | undefined = undefined;
  private reportedNoFec = false;
  private session: Session | null = null;
  private readonly candidates = new Map<string, Session>();
  private secret: Uint8Array | null = null;
  private foreignStreak = 0;
  private finished: string | null = null;
  private announcement: PrismManifestInfo | null = null;
  private offer: PrismManifestInfo | null = null;
  private readonly declined = new Set<string>();
  private rejection: string | null = null;
  private reportedVersion = false;
  private reportedWrongKey: string | null = null;
  private reportedPlain = false;
  private largeCandidate: { id: string; count: number } | null = null;

  /** True once every source block is resolved and {@link finalize} can run. */
  public get isComplete(): boolean {
    return (this.fec ? this.fec.isComplete : this.decoder.isComplete) && !this.needsKey;
  }

  /**
   * Hands in the outer code's module, or null when it could not be loaded.
   * @param module - The module from `loadFecModule`, or null.
   */
  public provideFecModule(module: WebAssembly.Module | null): void {
    this.fecModule = module;
  }

  /** Symbols accepted for the current session. */
  private get symbolsReceived(): number {
    return this.fec ? this.fec.symbolsReceived : this.decoder.dropletsReceived;
  }

  /** True while the current session is private and no key code has opened it yet. */
  public get needsKey(): boolean {
    return this.session !== null && isPrivate(this.session.manifest) && this.session.keys === null;
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
    const { fec } = this;
    if (fec) {
      if (fec.symbolsReceived === 0) return null;
      return {
        k: fec.k,
        rank: fec.symbolRank,
        resolved: fec.resolved,
        dropletsReceived: fec.symbolsReceived,
        progress: fec.progress * 100,
      };
    }
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

  /** Another stream the person may switch to, once it has been in view for a while. */
  public takeSwitchOffer(): PrismManifestInfo | null {
    const offered = this.offer;
    this.offer = null;
    return offered;
  }

  /** A message worth telling the person (a newer format, a size over the limit, a wrong key), once. */
  public takeRejection(): string | null {
    const message = this.rejection;
    this.rejection = null;
    return message;
  }

  /**
   * Sets the key code secret. From now on only a private transfer made with it is accepted; a plain
   * transfer in progress is dropped, because the person asked for a private one. A session the
   * current key already opened keeps that key: a key code for another transfer is reported and
   * ignored (#1303).
   * @param secret - The bytes the key code stands for.
   * @returns False when the key was ignored because it does not open the opened session.
   */
  public setKey(secret: Uint8Array): boolean {
    const opened = this.session?.keys ? this.session : null;
    if (opened && !this.opens(secret, opened)) {
      this.rejection = 'That key code is for another transfer, so it was ignored. This transfer goes on.';
      return false;
    }
    this.secret = secret;
    this.reportedWrongKey = null;
    this.reportedPlain = false;
    this.offer = null;
    const current = this.session;
    if (current && !isPrivate(current.manifest)) {
      this.dropSession();
    } else if (current) {
      this.verifyKey(current);
    }
    // A private manifest seen before the key was known may match now.
    for (const [id, candidate] of [...this.candidates]) {
      if (!isPrivate(candidate.manifest) || !this.verifyKey(candidate)) this.candidates.delete(id);
    }
    return true;
  }

  /** Whether a key code secret opens a private session. */
  private opens(secret: Uint8Array, session: Session): boolean {
    const keys = deriveKeys(secret, session.manifest.salt);
    return bytesToHex(privateSessionId(keys, session.manifestBytes)) === session.id;
  }

  /** Forgets the key code. */
  public clearKey(): void {
    this.secret = null;
    this.reportedWrongKey = null;
  }

  /**
   * Checks a private session against the key code. A match gives the session its keys; a mismatch
   * drops it, because the manifest does not belong to the key's owner.
   * @returns True when the key code opens the session.
   */
  private verifyKey(session: Session): boolean {
    if (!this.secret) return false;
    if (!this.opens(this.secret, session)) {
      if (this.session === session) this.dropSession();
      if (this.reportedWrongKey !== session.id) {
        this.reportedWrongKey = session.id;
        this.rejection = 'The key code does not match this transfer. Check it with the sender.';
      }
      return false;
    }
    session.keys = deriveKeys(this.secret, session.manifest.salt);
    session.info = { ...session.info };
    if (this.session === session) this.announcement = session.info;
    return true;
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
    // A feedback frame is the receiver-to-sender channel; a stream never carries file data in it.
    if (decoded.frame.type === 'feedback') return null;
    return decoded.frame.type === 'manifest' ? this.ingestManifest(decoded.frame) : this.ingestData(decoded.frame);
  }

  private ingestManifest(frame: Extract<PrismFrame, { type: 'manifest' }>): null {
    if (frame.sessionId === this.finished || frame.sessionId === this.session?.id) return null;
    // A private session that the key opened is not replaced by anything.
    if (this.session?.keys) return null;

    const result = decodeManifest(frame.manifest);
    if (!result.ok) {
      if (result.reason === 'too-large') {
        this.rejection = `File transfer rejected: the sender claims a size beyond the ${formatLimit(MAX_RECEIVE_BYTES)} limit.`;
      }
      return null;
    }
    const { manifest } = result;
    const session: Session = {
      id: frame.sessionId,
      manifest,
      manifestBytes: frame.manifest,
      info: describeManifest(manifest, frame.sessionId),
      keys: null,
    };

    if (!isPrivate(manifest)) {
      // The session ID is the manifest's own hash, so a manifest that does not match is a corrupt or forged one.
      if (bytesToHex(sessionIdOf(frame.manifest)) !== frame.sessionId) return null;
      if (this.secret) {
        if (!this.reportedPlain) {
          this.reportedPlain = true;
          this.rejection = 'A transfer that is not private is in view, so it was ignored. A key code is set.';
        }
        return null;
      }
    } else if (manifest.encryption !== ENCRYPTION_AES_GCM) {
      return null;
    } else if (this.secret && !this.verifyKey(session)) {
      return null;
    }

    // The frame's outer-code flag must agree with the manifest's version.
    if (Boolean(frame.flags & FLAG_OUTER_CODE) !== usesOuterCode(manifest)) return null;
    if (usesOuterCode(manifest) && !this.fecModule) {
      if (this.fecModule === null && !this.reportedNoFec) {
        this.reportedNoFec = true;
        this.rejection = OUTER_CODE_UNAVAILABLE;
      }
      return null;
    }

    // A huge block count must repeat before decoder tables are built for it.
    if (session.info.k > LARGE_BLOCK_COUNT && !this.confirmLarge(frame.sessionId)) return null;

    if (!this.session || this.symbolsReceived === 0) {
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
    // The module is known to be loaded: ingestManifest passes over a version-2 manifest until it is.
    this.fec = usesOuterCode(session.manifest) && this.fecModule ? new FecDecoder(this.fecModule, fecLayoutOf(session.manifest)) : null;
    this.foreignStreak = 0;
    this.session = session;
    this.candidates.delete(session.id);
    this.offer = null;
    this.announcement = session.info;
  }

  private dropSession(): void {
    this.decoder.reset();
    this.fec = null;
    this.session = null;
    this.foreignStreak = 0;
    this.announcement = null;
  }

  /**
   * Switches to the stream that was offered, after the person agreed.
   * @param id - The session ID from the offer.
   */
  public acceptSwitch(id: string): void {
    const next = this.candidates.get(id);
    if (next) this.adopt(next);
  }

  /**
   * Keeps the current stream; the offered one is not offered again.
   * @param id - The session ID from the offer.
   */
  public declineSwitch(id: string): void {
    this.declined.add(id);
    this.candidates.delete(id);
  }

  private ingestData(frame: Extract<PrismFrame, { type: 'data' }>): FountainProgress | null {
    if (frame.sessionId === this.finished) return null;
    // Multi-block sessions arrive with later work; their frames are not mistaken for plain ones.
    if (frame.blockNumber !== 0 || frame.firstSymbol < 1) return null;

    const current = this.session;
    if (!current || frame.sessionId !== current.id) {
      this.noteForeign(frame.sessionId);
      return null;
    }
    this.foreignStreak = 0;
    // The frame's encryption and outer-code flags must agree with the manifest it belongs to.
    if (Boolean(frame.flags & FLAG_ENCRYPTED) !== isPrivate(current.manifest)) return null;
    if (Boolean(frame.flags & FLAG_OUTER_CODE) !== usesOuterCode(current.manifest)) return null;

    const { manifest } = current;
    const size = manifest.symbolSize;
    if (frame.symbols.length !== size * frame.count) return null;
    const before = this.symbolsReceived;
    const { fec } = this;
    if (fec) {
      // Symbol ID i + 1 is stream symbol i, round-robin over the blocks.
      try {
        for (let i = 0; i < frame.count && !fec.isComplete; i++) fec.addAt(frame.firstSymbol - 1 + i, frame.symbols.subarray(i * size, (i + 1) * size));
      } catch {
        // A block's decoder could not reserve its memory.
        this.dropSession();
        this.rejection = 'This device ran out of memory for this transfer. Close other tabs and try again.';
        return null;
      }
      return this.symbolsReceived === before ? null : this.snapshot();
    }
    for (let i = 0; i < frame.count; i++) {
      this.decoder.ingest(
        { seq: frame.firstSymbol + i, k: current.info.k, messageLength: manifest.transferLength, checksum: manifest.transferCrc32 },
        frame.symbols.subarray(i * size, (i + 1) * size)
      );
    }
    return this.decoder.dropletsReceived === before ? null : this.snapshot();
  }

  /** Counts frames of a stream that is not the current one and, after a while, offers it to the person. */
  private noteForeign(id: string): void {
    // A private session the key opened is never replaced, and not even offered a replacement.
    if (this.session?.keys) return;
    this.foreignStreak += 1;
    const next = this.candidates.get(id);
    if (next && !this.declined.has(id) && this.foreignStreak >= SESSION_SWITCH_THRESHOLD && !this.offer) this.offer = next.info;
  }

  /**
   * Rebuilds, decrypts, decompresses and verifies the files.
   * @returns The verified files.
   * @throws Error when decoding is incomplete, a key is missing or wrong, or any integrity check fails.
   */
  public async finalize(): Promise<OpenedTransfer> {
    const message = this.fec ? this.fec.finalize() : this.decoder.finalize();
    if (!message || !this.session) throw new Error('Decoding is not complete.');
    const opened = await openPrismSession(message, this.session.manifest, this.session.keys ?? undefined);
    this.finished = this.session.id;
    return opened;
  }

  /** Ignores a session that already finished until another session's frames arrive. */
  public ignoreSession(id: string): void {
    this.finished = id;
  }

  /**
   * Clears the stream's state. The finished session stays ignored.
   * @param keepKey - Keep the key code, e.g. after a failed finalize, so the same transfer can
   *   still open once it is read again (#1303). Otherwise the key code is forgotten.
   */
  public reset(keepKey = false): void {
    this.decoder.reset();
    this.fec = null;
    this.reportedNoFec = false;
    this.session = null;
    this.candidates.clear();
    this.declined.clear();
    this.foreignStreak = 0;
    this.announcement = null;
    this.offer = null;
    this.rejection = null;
    this.largeCandidate = null;
    if (!keepKey) this.secret = null;
    this.reportedWrongKey = null;
    this.reportedPlain = false;
  }
}
