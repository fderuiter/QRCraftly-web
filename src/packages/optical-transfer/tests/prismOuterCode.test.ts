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

// Prism sent with the outer code (#1141, ADR 0037): manifest version 2, the outer-code frame flag,
// round-robin symbols over several blocks, and the receiver's handling of a missing module.

import { beforeAll, describe, expect, it } from 'vitest';
import {
  FLAG_OUTER_CODE,
  FountainReassembler,
  MANIFEST_INTERVAL,
  MANIFEST_VERSION_FEC,
  MAX_FEC_BLOCKS,
  OUTER_CODE_UNAVAILABLE,
  PrismReceiver,
  TRANSFER_DENSITY_PROFILES,
  createPrismBundleSession,
  createPrismSession,
  createPrng,
  decodeFrame,
  decodeManifest,
  encodeDataFrame,
  encodeManifest,
  estimateTransferFrames,
  loadFecModule,
  neededSymbols,
  parseKeyCode,
  planBlocks,
  sha256Hex,
  type PrismManifest,
  type PrismStream,
} from '../index';

let module: WebAssembly.Module;
beforeAll(async () => {
  module = await loadFecModule();
});

function randomBytes(length: number, seed = 1): Uint8Array {
  const prng = createPrng(seed);
  return Uint8Array.from({ length }, () => Math.floor(prng() * 256));
}

const profile = TRANSFER_DENSITY_PROFILES.balanced;
const options = { errorCorrectionLevel: profile.errorCorrectionLevel, maxVersion: profile.maxVersion, mimeType: 'application/octet-stream' };

/** Feeds frames from `join`, skipping dropped ones, until the receiver completes. */
function receive(stream: PrismStream, receiver: { ingest(text: string): unknown; isComplete: boolean }, join: number, drop: (index: number) => boolean) {
  // Data frames received after the first manifest, the ones the decoder could use.
  let dataFrames = 0;
  let announced = false;
  for (let index = join; index < join + stream.k * 4 + 64; index++) {
    if (drop(index)) continue;
    receiver.ingest(stream.frameText(index));
    if (index % MANIFEST_INTERVAL === 0) announced = true;
    else if (announced) dataFrames += 1;
    if (receiver.isComplete) return { completedAt: index, dataFrames };
  }
  return { completedAt: -1, dataFrames };
}

function fecReceiver(): FountainReassembler {
  const reassembler = new FountainReassembler();
  reassembler.provideFecModule(module);
  return reassembler;
}

describe('Prism with the outer code', () => {
  it('announces manifest version 2 and flags every frame', async () => {
    const { stream, manifest, outerCode, symbolSize } = await createPrismSession(randomBytes(2000, 1), { fileName: 'a.bin', ...options, fecModule: module });
    expect(outerCode).toBe('fec');
    expect(stream.outerCode).toBe('fec');
    expect(manifest.version).toBe(MANIFEST_VERSION_FEC);
    expect(manifest.blockSymbols).toBe(8192);
    expect(symbolSize % 8).toBe(0);
    for (let i = 0; i < 20; i++) {
      const decoded = decodeFrame(stream.frameText(i));
      expect(decoded.ok && decoded.frame.flags & FLAG_OUTER_CODE).toBeTruthy();
    }
    const first = decodeFrame(stream.frameText(1));
    expect(first.ok && first.frame.type === 'data' && first.frame.firstSymbol).toBe(1);
  });

  it('rebuilds a file joined mid-stream with a third of the frames lost', async () => {
    const file = randomBytes(6000, 2);
    const { stream } = await createPrismSession(file, { fileName: 'photo.bin', ...options, fecModule: module });
    const receiver = fecReceiver();
    const { completedAt, dataFrames } = receive(stream, receiver, 37, (i) => i % 3 === 0);
    expect(completedAt).toBeGreaterThan(0);
    // K plus a few symbols, against the 15% the LT code needs.
    expect(dataFrames).toBeLessThanOrEqual(stream.k + 12);
    const snapshot = receiver.snapshot();
    expect(snapshot).toMatchObject({ k: stream.k, rank: stream.k, resolved: stream.k, progress: 100 });
    const {
      files: [{ data, header }],
    } = await receiver.finalize();
    expect(data).toEqual(file);
    expect(header).toMatchObject({ fileName: 'photo.bin', fileSize: 6000, sha256: await sha256Hex(file) });
  });

  it('decodes a transfer cut into three blocks, symbols round-robin across them', async () => {
    const file = randomBytes(7000, 3);
    const session = await createPrismSession(file, { fileName: 'blocks.bin', ...options, requestedSymbolSize: 64, fecModule: module, fecBlockSymbols: 40 });
    const blocks = planBlocks(Math.ceil(session.manifest.transferLength / session.symbolSize), session.manifest.blockSymbols);
    expect(session.outerCode).toBe('fec');
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    expect(blocks.length).toBeLessThanOrEqual(MAX_FEC_BLOCKS);

    const receiver = new PrismReceiver();
    receiver.provideFecModule(module);
    const progress: number[] = [];
    let index = 5;
    for (; index < 5 + session.stream.k * 3 && !receiver.isComplete; index++) {
      if (index % 4 === 1) continue;
      const step = receiver.ingest(session.stream.frameText(index));
      if (step) {
        expect(step.rank).toBeLessThanOrEqual(step.k);
        progress.push(step.progress);
      }
    }
    expect(receiver.isComplete).toBe(true);
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, i) => i === 0 || value >= progress[i - 1])).toBe(true);
    const { files } = await receiver.finalize();
    expect(files[0].data).toEqual(file);
  });

  it('sends a file too large for its blocks with the LT code', async () => {
    const session = await createPrismSession(randomBytes(3000, 4), { fileName: 'big.bin', ...options, requestedSymbolSize: 64, fecModule: module, fecBlockSymbols: 8 });
    expect(session.outerCode).toBe('lt');
    expect(session.manifest.version).toBe(1);
    const decoded = decodeFrame(session.stream.frameText(0));
    expect(decoded.ok && decoded.frame.flags & FLAG_OUTER_CODE).toBe(0);
  });

  it('carries private bundles', async () => {
    const sources = [
      { path: 'docs/a.txt', mimeType: 'text/plain', data: randomBytes(1500, 5) },
      { path: 'docs/b.bin', mimeType: 'application/octet-stream', data: randomBytes(2500, 6) },
    ];
    const session = await createPrismBundleSession(sources, { fileName: '', ...options, private: true, fecModule: module });
    expect(session.outerCode).toBe('fec');
    const receiver = fecReceiver();
    const secret = parseKeyCode(session.keyCode ?? '');
    expect(secret).not.toBeNull();
    if (secret) receiver.setKey(secret);
    expect(receive(session.stream, receiver, 0, () => false).completedAt).toBeGreaterThan(0);
    const { files } = await receiver.finalize();
    expect(files.map((file) => file.data)).toEqual(sources.map((source) => source.data));
  });

  it('waits for the module, then picks the stream up at its next manifest', async () => {
    const { stream } = await createPrismSession(randomBytes(1500, 7), { fileName: 'late.bin', ...options, fecModule: module });
    const receiver = new PrismReceiver();
    for (let i = 0; i < 4; i++) receiver.ingest(stream.frameText(i));
    expect(receiver.manifest).toBeNull();
    expect(receiver.takeRejection()).toBeNull();
    receiver.provideFecModule(module);
    expect(receive(stream, receiver, 4, () => false).completedAt).toBeGreaterThanOrEqual(MANIFEST_INTERVAL);
    expect((await receiver.finalize()).files[0].header.fileName).toBe('late.bin');
  });

  it('tells the person when this browser cannot run the outer code', async () => {
    const { stream } = await createPrismSession(randomBytes(1500, 8), { fileName: 'x.bin', ...options, fecModule: module });
    const receiver = new PrismReceiver();
    receiver.provideFecModule(null);
    for (let i = 0; i < MANIFEST_INTERVAL * 2 + 1; i++) receiver.ingest(stream.frameText(i));
    expect(receiver.takeRejection()).toBe(OUTER_CODE_UNAVAILABLE);
    expect(receiver.takeRejection()).toBeNull();
    expect(receiver.manifest).toBeNull();
  });

  it('ignores frames whose outer-code flag disagrees with the manifest', async () => {
    const { stream, manifest } = await createPrismSession(randomBytes(1500, 9), { fileName: 'y.bin', ...options, fecModule: module });
    const receiver = new PrismReceiver();
    receiver.provideFecModule(module);
    receiver.ingest(stream.frameText(0));
    expect(receiver.manifest).not.toBeNull();
    const decoded = decodeFrame(stream.frameText(1));
    if (!decoded.ok || decoded.frame.type !== 'data') throw new Error('expected a data frame');
    const stripped = encodeDataFrame({
      sessionId: Uint8Array.from(decoded.frame.sessionId.match(/../g) ?? [], (pair) => parseInt(pair, 16)),
      firstSymbol: decoded.frame.firstSymbol,
      symbols: [decoded.frame.symbols],
      flags: decoded.frame.flags & ~FLAG_OUTER_CODE,
    });
    expect(receiver.ingest(stripped)).toBeNull();
    expect(receiver.ingest(stream.frameText(1))).not.toBeNull();
    expect(manifest.symbolSize).toBe(decoded.frame.symbols.length);
  });
});

describe('Manifest version 2', () => {
  const base: PrismManifest = {
    version: MANIFEST_VERSION_FEC,
    files: [{ name: 'a.bin', size: 5000, mimeType: 'application/octet-stream', sha256: 'ab'.repeat(32) }],
    compression: 'none',
    transferLength: 5000,
    symbolSize: 64,
    transferCrc32: 7,
    salt: new Uint8Array(0),
    encryption: 0,
    layout: 0,
    unpackedLength: 0,
    unpackedSha256: new Uint8Array(0),
    entryCount: 0,
    blockSymbols: 8192,
  };

  it('round-trips with its block size', () => {
    const result = decodeManifest(encodeManifest(base));
    expect(result).toEqual({ ok: true, manifest: base });
  });

  it('refuses symbol sizes the outer code cannot take and too many blocks', () => {
    expect(decodeManifest(encodeManifest({ ...base, symbolSize: 60 })).ok).toBe(false);
    expect(decodeManifest(encodeManifest({ ...base, blockSymbols: 0 })).ok).toBe(false);
    expect(decodeManifest(encodeManifest({ ...base, blockSymbols: 8193 })).ok).toBe(false);
    // 5000 bytes at 64 bytes per symbol is 79 symbols: 15 per block makes 6 blocks.
    expect(decodeManifest(encodeManifest({ ...base, blockSymbols: 15 })).ok).toBe(false);
    expect(decodeManifest(encodeManifest({ ...base, blockSymbols: 20 })).ok).toBe(true);
  });

  it('refuses a forged length before building anything for it', () => {
    expect(decodeManifest(encodeManifest({ ...base, transferLength: 2 ** 50 }))).toEqual({ ok: false, reason: 'too-large' });
  });

  it('keeps version 1 as the LT code', () => {
    const v1 = { ...base, version: 1 };
    delete v1.blockSymbols;
    const result = decodeManifest(encodeManifest(v1));
    expect(result.ok && result.manifest.version).toBe(1);
    expect(result.ok && result.manifest.blockSymbols).toBeUndefined();
  });
});

describe('Frame estimates', () => {
  it('plans K plus a few symbols for the outer code and 15% more for LT', () => {
    expect(neededSymbols(1000, 'lt')).toBe(1150);
    expect(neededSymbols(1000, 'fec')).toBe(1008);
    expect(neededSymbols(9000, 'fec')).toBe(9016);
    const lt = estimateTransferFrames(200_000, 'balanced');
    const fec = estimateTransferFrames(200_000, 'balanced', 'fec');
    expect(fec.symbolSize % 8).toBe(0);
    expect(fec.frames).toBeLessThan(lt.frames);
  });
});
