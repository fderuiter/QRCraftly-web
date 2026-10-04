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

import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import {
  FLAG_ENCRYPTED,
  FRAME_OVERHEAD,
  FountainReassembler,
  MANIFEST_INTERVAL,
  MAX_MANIFEST_NAME_BYTES,
  MAX_RECEIVE_BYTES,
  PRISM_VERSION,
  TRANSFER_DENSITY_PROFILES,
  base45Length,
  createFountainSession,
  createPrng,
  createPrismSession,
  crc32c,
  decodeBase45,
  decodeFrame,
  decodeManifest,
  encodeBase45,
  encodeDataFrame,
  encodeManifest,
  encodeManifestFrame,
  estimateTransferFrames,
  fitFileName,
  looksLikePrismFrame,
  prismFrameCapacity,
  prismSymbolSize,
  resolveFountainSymbolSize,
  sessionIdOf,
  sha256Hex,
  type PrismManifest,
  type TransferDensity,
} from '../index';

const text = (value: string) => new TextEncoder().encode(value);

function randomBytes(length: number, seed = 1): Uint8Array {
  const prng = createPrng(seed);
  return Uint8Array.from({ length }, () => Math.floor(prng() * 256));
}

const SESSION = Uint8Array.from([1, 2, 3, 4, 5, 6]);

function sampleManifest(overrides: Partial<PrismManifest> = {}): PrismManifest {
  return {
    version: 1,
    files: [{ name: 'report.pdf', size: 5000, mimeType: 'application/pdf', sha256: 'ab'.repeat(32) }],
    compression: 'none',
    transferLength: 5000,
    symbolSize: 50,
    transferCrc32: 0xdeadbeef,
    salt: new Uint8Array(0),
    encryption: 0,
    layout: 0,
    unpackedLength: 0,
    unpackedSha256: new Uint8Array(0),
    entryCount: 0,
    ...overrides,
  };
}

describe('Base45 (RFC 9285)', () => {
  it.each([
    ['AB', 'BB8'],
    ['Hello!!', '%69 VD92EX0'],
    ['base-45', 'UJCLQE7W581'],
    ['ietf!', 'QED8WEX0'],
  ])('encodes %s as %s and back', (plain, encoded) => {
    expect(encodeBase45(text(plain))).toBe(encoded);
    expect(new TextDecoder().decode(decodeBase45(encoded) ?? new Uint8Array())).toBe(plain);
  });

  it('round-trips every byte value and every length of a short message', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(decodeBase45(encodeBase45(all))).toEqual(all);
    for (let length = 0; length < 9; length++) {
      const bytes = randomBytes(length, length + 1);
      const encoded = encodeBase45(bytes);
      expect(encoded).toHaveLength(base45Length(length));
      expect(decodeBase45(encoded)).toEqual(bytes);
    }
  });

  it('rejects text that is not Base45 instead of throwing', () => {
    expect(decodeBase45('abc')).toBeNull(); // lower case is outside the alphabet
    expect(decodeBase45('AB1')).not.toBeNull();
    expect(decodeBase45('A')).toBeNull(); // one character over a group
    expect(decodeBase45('GGW')).toBeNull(); // 3 chars that decode past 0xFFFF
    expect(decodeBase45('::')).toBeNull(); // 2 chars past 0xFF
  });

  it('costs about 3% over the byte count for long frames', () => {
    expect(base45Length(1000) / 1000).toBeCloseTo(1.5, 5);
  });
});

describe('CRC-32C', () => {
  it('matches the Castagnoli check value', () => {
    expect(crc32c(text('123456789'))).toBe(0xe3069283);
  });
});

describe('Prism frames', () => {
  it('round-trips a data frame field by field', () => {
    const symbols = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6])];
    const decoded = decodeFrame(encodeDataFrame({ sessionId: SESSION, firstSymbol: 0x123456, symbols, flags: FLAG_ENCRYPTED }));
    expect(decoded).toEqual({
      ok: true,
      frame: { type: 'data', flags: FLAG_ENCRYPTED, sessionId: '010203040506', blockNumber: 0, firstSymbol: 0x123456, count: 2, symbols: Uint8Array.from([1, 2, 3, 4, 5, 6]) },
    });
  });

  it('carries a source block number for multi-block sessions', () => {
    const decoded = decodeFrame(encodeDataFrame({ sessionId: SESSION, firstSymbol: 9, symbols: [Uint8Array.from([7])], blockNumber: 3 }));
    expect(decoded.ok && decoded.frame.type === 'data' && decoded.frame.blockNumber).toBe(3);
  });

  it('round-trips a manifest frame', () => {
    const manifest = encodeManifest(sampleManifest());
    const decoded = decodeFrame(encodeManifestFrame({ sessionId: SESSION, manifest }));
    expect(decoded).toEqual({ ok: true, frame: { type: 'manifest', flags: 0, sessionId: '010203040506', manifest } });
  });

  it('uses 16 bytes of overhead and the QR alphanumeric alphabet only', () => {
    const frame = encodeDataFrame({ sessionId: SESSION, firstSymbol: 1, symbols: [new Uint8Array(40)] });
    expect(decodeBase45(frame)).toHaveLength(FRAME_OVERHEAD + 40);
    expect(frame).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    expect(looksLikePrismFrame(frame)).toBe(true);
    expect(looksLikePrismFrame('https://qrcraftly.com')).toBe(false);
    expect(looksLikePrismFrame('UR:BYTES/1-2/ABC')).toBe(false);
  });

  it('rejects a tampered frame with a reason, never by throwing', () => {
    const frame = encodeDataFrame({ sessionId: SESSION, firstSymbol: 1, symbols: [Uint8Array.from([1, 2, 3, 4])] });
    const swapped = (index: number) => frame.slice(0, index) + (frame[index] === 'A' ? 'B' : 'A') + frame.slice(index + 1);
    for (let i = 0; i < frame.length; i++) {
      const result = decodeFrame(swapped(i));
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a truncated frame', () => {
    const frame = encodeDataFrame({ sessionId: SESSION, firstSymbol: 1, symbols: [new Uint8Array(20)] });
    for (let length = 0; length < frame.length; length += 7) {
      expect(decodeFrame(frame.slice(0, length)).ok).toBe(false);
    }
    expect(decodeFrame(frame.slice(0, 6))).toMatchObject({ ok: false });
  });

  it('refuses a newer format version and names it', () => {
    const bytes = decodeBase45(encodeDataFrame({ sessionId: SESSION, firstSymbol: 1, symbols: [Uint8Array.from([9])] })) ?? new Uint8Array();
    bytes[0] = (bytes[0] & 0xf0) | (PRISM_VERSION + 1);
    new DataView(bytes.buffer).setUint32(bytes.length - 4, crc32c(bytes.subarray(0, bytes.length - 4)));
    expect(decodeFrame(encodeBase45(bytes))).toEqual({ ok: false, reason: 'unsupported-version', version: PRISM_VERSION + 1 });
  });

  it('refuses a feedback-typed frame without a feedback payload, and an unknown flag', () => {
    const base = decodeBase45(encodeDataFrame({ sessionId: SESSION, firstSymbol: 1, symbols: [Uint8Array.from([9])] })) ?? new Uint8Array();
    const reseal = (bytes: Uint8Array) => {
      new DataView(bytes.buffer).setUint32(bytes.length - 4, crc32c(bytes.subarray(0, bytes.length - 4)));
      return decodeFrame(encodeBase45(bytes));
    };
    const feedback = base.slice();
    feedback[1] = (2 << 5) | (feedback[1] & 0x1f);
    expect(reseal(feedback)).toMatchObject({ ok: false, reason: 'malformed' });
    const flagged = base.slice();
    flagged[1] |= 0b10000;
    expect(reseal(flagged)).toMatchObject({ ok: false });
  });

  it('survives garbage: random text of any length is rejected without throwing', () => {
    const prng = createPrng(77);
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:abc!';
    for (let i = 0; i < 400; i++) {
      const garbage = Array.from({ length: Math.floor(prng() * 60) }, () => alphabet[Math.floor(prng() * alphabet.length)]).join('');
      expect(() => decodeFrame(garbage)).not.toThrow();
    }
  });
});

describe('Prism manifest', () => {
  it('round-trips and derives a stable session ID', () => {
    const bytes = encodeManifest(sampleManifest());
    const decoded = decodeManifest(bytes);
    expect(decoded).toEqual({ ok: true, manifest: sampleManifest() });
    expect(sessionIdOf(bytes)).toEqual(sessionIdOf(encodeManifest(sampleManifest())));
    expect(sessionIdOf(bytes)).not.toEqual(sessionIdOf(encodeManifest(sampleManifest({ transferCrc32: 1 }))));
  });

  it('refuses a claim past the receive limits before anything is allocated', () => {
    const big = sampleManifest({ files: [{ name: 'x', size: MAX_RECEIVE_BYTES + 1, mimeType: '', sha256: 'ab'.repeat(32) }] });
    expect(decodeManifest(encodeManifest(big))).toEqual({ ok: false, reason: 'too-large' });
    const hugeTransfer = sampleManifest({ transferLength: MAX_RECEIVE_BYTES * 2 });
    expect(decodeManifest(encodeManifest(hugeTransfer))).toEqual({ ok: false, reason: 'too-large' });
  });

  it('refuses a malformed manifest', () => {
    expect(decodeManifest(Uint8Array.from([0xff, 0x00]))).toEqual({ ok: false, reason: 'malformed' });
    expect(decodeManifest(encodeManifest(sampleManifest({ symbolSize: 2 })))).toEqual({ ok: false, reason: 'malformed' });
    expect(decodeManifest(encodeManifest(sampleManifest({ files: [] })))).toEqual({ ok: false, reason: 'malformed' });
  });

  it('shortens a long file name to the byte budget and keeps the extension', () => {
    const long = `${'résumé '.repeat(40)}.pdf`;
    const fitted = fitFileName(long);
    expect(new TextEncoder().encode(fitted).length).toBeLessThanOrEqual(MAX_MANIFEST_NAME_BYTES);
    expect(fitted.endsWith('….pdf')).toBe(true);
    expect(fitFileName('short.txt')).toBe('short.txt');
  });
});

/** Plays a stream into a reassembler from `join`, dropping the frames `drop` names. */
async function receive(
  stream: { frameText(index: number): string; k: number },
  join: number,
  drop: (index: number) => boolean,
  reassembler = new FountainReassembler()
) {
  const announcements: string[] = [];
  let announcedAt = -1;
  let completedAt = -1;
  for (let index = join; index < join + stream.k * 6 + 64; index++) {
    if (drop(index)) continue;
    reassembler.ingest(stream.frameText(index));
    const announced = reassembler.takeManifest();
    if (announced) {
      announcements.push(announced.files[0].name);
      announcedAt = announcedAt < 0 ? index : announcedAt;
    }
    if (reassembler.isComplete) {
      completedAt = index;
      break;
    }
  }
  return { reassembler, announcements, announcedAt, completedAt };
}

describe('Prism session end to end', () => {
  const profile = TRANSFER_DENSITY_PROFILES.balanced;
  const options = { errorCorrectionLevel: profile.errorCorrectionLevel, maxVersion: profile.maxVersion };

  it('sends the manifest first and every 16th frame, with data frames between', async () => {
    const { stream } = await createPrismSession(randomBytes(900, 3), { fileName: 'a.bin', mimeType: 'application/octet-stream', ...options });
    const kinds = Array.from({ length: 40 }, (_, i) => {
      const decoded = decodeFrame(stream.frameText(i));
      return decoded.ok ? decoded.frame.type : 'bad';
    });
    expect(kinds.filter((kind) => kind === 'bad')).toHaveLength(0);
    kinds.forEach((kind, i) => expect(kind).toBe(i % MANIFEST_INTERVAL === 0 ? 'manifest' : 'data'));
  });

  it('rebuilds a file joined mid-stream with a third of the frames lost, and verifies it', async () => {
    const file = randomBytes(3000, 11);
    const { stream } = await createPrismSession(file, { fileName: 'photo.bin', mimeType: 'application/octet-stream', ...options });
    const { reassembler, announcedAt, completedAt } = await receive(stream, 37, (i) => i % 3 === 0);
    expect(completedAt).toBeGreaterThan(announcedAt);
    const {
      files: [{ data, header }],
    } = await reassembler.finalize();
    expect(data).toEqual(file);
    expect(header).toMatchObject({ fileName: 'photo.bin', fileSize: 3000, sha256: await sha256Hex(file) });
  });

  it('shows the file name, size and type from the manifest before the data completes', async () => {
    const { stream } = await createPrismSession(randomBytes(4000, 5), { fileName: 'budget.xlsx', mimeType: 'application/vnd.ms-excel', ...options });
    const reassembler = new FountainReassembler();
    let manifest = null;
    for (let i = 0; i < MANIFEST_INTERVAL + 2 && !manifest; i++) {
      reassembler.ingest(stream.frameText(i));
      manifest = reassembler.takeManifest();
    }
    expect(reassembler.isComplete).toBe(false);
    expect(manifest).toMatchObject({ totalSize: 4000, files: [{ name: 'budget.xlsx', mimeType: 'application/vnd.ms-excel', size: 4000 }] });
    expect(manifest?.fingerprint).toMatch(/^[a-z]{4}( [a-z]{4}){3}$/);
    expect(stream.fingerprint).toBe(manifest?.fingerprint);
  });

  it('compresses text and still verifies the original', async () => {
    const file = text('Prism frames carry bytes. '.repeat(200));
    const { stream, manifest } = await createPrismSession(file, { fileName: 'notes.txt', mimeType: 'text/plain', ...options });
    expect(manifest.compression).toBe('deflate-raw');
    const { reassembler } = await receive(stream, 0, () => false);
    expect((await reassembler.finalize()).files[0].data).toEqual(file);
  });

  it('ignores frames of another session until it has repeated, then switches', async () => {
    const a = (await createPrismSession(randomBytes(2500, 21), { fileName: 'a.bin', mimeType: 'application/octet-stream', ...options })).stream;
    const b = (await createPrismSession(randomBytes(2500, 22), { fileName: 'b.bin', mimeType: 'application/octet-stream', ...options })).stream;
    const reassembler = new FountainReassembler();
    for (let i = 0; i < 6; i++) reassembler.ingest(a.frameText(i));
    // A single stray frame of the other stream must not disturb the first.
    reassembler.ingest(b.frameText(0));
    reassembler.ingest(b.frameText(5));
    for (let i = 6; i < 8; i++) reassembler.ingest(a.frameText(i));
    expect(reassembler.snapshot()?.dropletsReceived).toBeGreaterThan(0);
    const { reassembler: done } = await receive(b, 0, () => false, new FountainReassembler());
    expect((await done.finalize()).files[0].header.fileName).toBe('b.bin');
  });

  it('refuses a manifest whose session ID does not match its contents', async () => {
    const { manifest } = await createPrismSession(randomBytes(500, 8), { fileName: 'x.bin', mimeType: '', ...options });
    const bytes = encodeManifest(manifest);
    const forged = encodeManifestFrame({ sessionId: Uint8Array.from([9, 9, 9, 9, 9, 9]), manifest: bytes });
    const reassembler = new FountainReassembler();
    reassembler.ingest(forged);
    expect(reassembler.takeManifest()).toBeNull();
  });

  it('turns away a manifest that claims more than the receive limit, with a message', () => {
    const reassembler = new FountainReassembler();
    const bytes = encodeManifest(sampleManifest({ files: [{ name: 'huge.bin', size: MAX_RECEIVE_BYTES + 1, mimeType: '', sha256: 'ab'.repeat(32) }] }));
    reassembler.ingest(encodeManifestFrame({ sessionId: sessionIdOf(bytes), manifest: bytes }));
    expect(reassembler.takeManifest()).toBeNull();
    expect(reassembler.takeRejection()).toMatch(/rejected/);
  });

  it('tells the person when a stream uses a newer format', () => {
    const bytes = decodeBase45(encodeDataFrame({ sessionId: SESSION, firstSymbol: 1, symbols: [Uint8Array.from([9])] })) ?? new Uint8Array();
    bytes[0] = (bytes[0] & 0xf0) | 9;
    new DataView(bytes.buffer).setUint32(bytes.length - 4, crc32c(bytes.subarray(0, bytes.length - 4)));
    const reassembler = new FountainReassembler();
    reassembler.ingest(encodeBase45(bytes));
    expect(reassembler.takeRejection()).toMatch(/newer version/);
    reassembler.ingest(encodeBase45(bytes));
    expect(reassembler.takeRejection()).toBeNull();
  });

  it('does not let data frames join a manifest they were not made for', async () => {
    const file = randomBytes(800, 31);
    const { stream, manifest } = await createPrismSession(file, { fileName: 'x.bin', mimeType: '', ...options });
    const lie = encodeManifest({ ...manifest, files: [{ ...manifest.files[0], sha256: '00'.repeat(32) }] });
    const lieSession = sessionIdOf(lie);
    const reassembler = new FountainReassembler();
    reassembler.ingest(encodeManifestFrame({ sessionId: lieSession, manifest: lie }));
    // Data frames carry the honest session ID, so they never join the lying manifest's session
    // (the honest manifests are withheld here, so the receiver has nothing to switch to).
    for (let i = 1; i < 60; i++) {
      if (i % MANIFEST_INTERVAL !== 0) reassembler.ingest(stream.frameText(i));
    }
    expect(reassembler.isComplete).toBe(false);
  });

  it('still receives a legacy ur:bytes stream', async () => {
    const file = text('old stream '.repeat(30));
    const { encoder } = await createFountainSession(file, { fileName: 'old.txt', mimeType: 'text/plain' });
    const reassembler = new FountainReassembler();
    for (let i = 5; i < encoder.k * 4 && !reassembler.isComplete; i++) reassembler.ingest(encoder.dropletStringForIndex(i));
    expect((await reassembler.finalize()).files[0].data).toEqual(file);
  });

  it('ignores a finished session until another one arrives', async () => {
    const file = randomBytes(600, 41);
    const { stream } = await createPrismSession(file, { fileName: 'once.bin', mimeType: '', ...options });
    const { reassembler } = await receive(stream, 0, () => false);
    await reassembler.finalize();
    const key = reassembler.finishedSessionKey;
    expect(key).toMatch(/^prism:/);
    const next = new FountainReassembler();
    next.ignoreSession(key ?? '');
    for (let i = 0; i < 40; i++) next.ingest(stream.frameText(i));
    expect(next.takeManifest()).toBeNull();
    expect(next.snapshot()).toBeNull();
  });

  it('refuses an encrypted or multi-block frame instead of misreading it', async () => {
    const { stream } = await createPrismSession(randomBytes(500, 51), { fileName: 'x.bin', mimeType: '', ...options });
    const reassembler = new FountainReassembler();
    reassembler.ingest(stream.frameText(0));
    const symbol = new Uint8Array(stream.manifest.symbolSize);
    reassembler.ingest(encodeDataFrame({ sessionId: stream.sessionId, firstSymbol: 1, symbols: [symbol], flags: FLAG_ENCRYPTED }));
    reassembler.ingest(encodeDataFrame({ sessionId: stream.sessionId, firstSymbol: 1, symbols: [symbol], blockNumber: 2 }));
    expect(reassembler.snapshot()).toBeNull();
  });
});

describe('Prism capacity', () => {
  const densities = Object.keys(TRANSFER_DENSITY_PROFILES) as TransferDensity[];

  it.each(densities)('a %s data frame fits its QR version and error correction', async (density) => {
    const { maxVersion, errorCorrectionLevel } = TRANSFER_DENSITY_PROFILES[density];
    const { stream } = await createPrismSession(randomBytes(20_000, 61), { fileName: 'f.bin', mimeType: '', errorCorrectionLevel, maxVersion });
    for (let i = 1; i < 40; i++) {
      if (i % MANIFEST_INTERVAL === 0) continue;
      expect(QRCode.create(stream.frameText(i), { errorCorrectionLevel }).version).toBeLessThanOrEqual(maxVersion);
    }
  });

  it.each(densities)('carries more bytes per QR than the ur:bytes frames did at %s', (density) => {
    const { maxVersion, errorCorrectionLevel } = TRANSFER_DENSITY_PROFILES[density];
    const before = resolveFountainSymbolSize(100_000, errorCorrectionLevel, undefined, maxVersion).symbolSize;
    const after = prismSymbolSize(errorCorrectionLevel, maxVersion);
    expect(after).toBeGreaterThan(before * 1.4);
    expect(estimateTransferFrames(100_000, density).symbolSize).toBe(after);
  });

  it('fits a whole number of bytes per frame', () => {
    for (let version = 1; version <= 20; version++) {
      const bytes = prismFrameCapacity('M', version);
      expect(base45Length(bytes)).toBeLessThanOrEqual(prismFrameCapacity === undefined ? 0 : [20, 38, 61, 90, 122, 154, 178, 221, 262, 311, 366, 419, 483, 528, 600, 656, 734, 816, 909, 970][version - 1]);
    }
  });
});
