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

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { QrSymbolEncoder } from '@/packages/qr-matrix/encoder';
import {
  PrismStream,
  createPrng,
  crc32,
  decodeFrame,
  sha256Hex,
  encodeSessionMessage,
  FountainEncoder,
  MAX_RECEIVE_BYTES,
  FLAG_BEACON,
  TILE_LAYOUTS,
  loadFecModule,
  TRANSFER_DENSITY_PROFILES,
  type PrismManifest,
  type TransferDensity,
} from '../index';

type Handler = (event: { data: unknown }) => Promise<void> | void;
type Posted = { type: string; [key: string]: unknown };

const globalScope = globalThis as unknown as {
  self: unknown;
  onmessage: Handler | null;
  postMessage: (message: Posted) => void;
};

let sliceHandler: Handler;
let reassemblyHandler: Handler;
/** The encoder instance the slice worker loaded, so its frames can be observed. */
let QRCode: QrSymbolEncoder;
let posted: Posted[] = [];
let qrCalls: Array<{ text: string; ecc: string | undefined; version: number }> = [];

function randomBytes(length: number, seed: number): Uint8Array {
  const prng = createPrng(seed);
  return Uint8Array.from({ length }, () => Math.floor(prng() * 256));
}

async function startFountain(file: Blob, options: { density?: string; outerCode?: string; tiles?: string; beacon?: { version: number; every: number }; steer?: boolean } = {}) {
  const { density, outerCode, tiles, beacon, steer } = options;
  await sliceHandler({ data: { type: 'START', payload: { file, fps: 15, density, outerCode, tiles, beacon, steer } } });
  return posted.find(m => m.type === 'INITIALIZED') as
    | {
        totalFrames: number;
        sha256: string;
        fountain: {
          k: number;
          symbolSize: number;
          compression: string;
          density: TransferDensity;
          fingerprint: string;
          outerCode: string;
          tiles: string | null;
          beacon: { version: number; every: number } | null;
          sessionId: string;
          steerable: boolean;
        };
      }
    | undefined;
}

/** Builds a Prism stream by hand, for a manifest that differs from what the sender would write. */
function handmadeStream(message: Uint8Array, overrides: Partial<PrismManifest> & { size: number; sha256: string }): PrismStream {
  const { size, sha256, ...rest } = overrides;
  return new PrismStream(message, {
    version: 1,
    files: [{ name: 'f.bin', size, mimeType: 'application/octet-stream', sha256 }],
    compression: 'none',
    transferLength: message.length,
    symbolSize: 16,
    transferCrc32: crc32(message),
    salt: new Uint8Array(0),
    encryption: 0,
    layout: 0,
    unpackedLength: 0,
    unpackedSha256: new Uint8Array(0),
    entryCount: 0,
    ...rest,
  });
}

/** Feeds frames to the reassembly worker until it answers with COMPLETE or ERROR. */
async function feedUntilDone(stream: PrismStream, count = stream.k * 3 + 40) {
  for (let i = 0; i < count; i++) {
    await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: stream.frameText(i) } });
    if (posted.some(m => m.type === 'ERROR' || m.type === 'COMPLETE')) break;
  }
}

/** ACKs frames one by one so the lookahead pipeline keeps generating. */
async function pump(count: number) {
  for (let i = 0; i < count; i++) {
    await sliceHandler({ data: { type: 'ACK', payload: { index: i } } });
  }
}

describe('Fountain sender and receiver workers', () => {
  beforeAll(async () => {
    globalScope.self = globalThis;
    vi.resetModules();
    await import('../worker-slice');
    sliceHandler = globalScope.onmessage as Handler;
    QRCode = await (await import('@/packages/qr-matrix/encoder')).loadQrEncoder();
    vi.resetModules();
    await import('../worker-reassembly');
    reassemblyHandler = globalScope.onmessage as Handler;
  });

  beforeEach(() => {
    posted = [];
    qrCalls = [];
    globalScope.postMessage = (message: Posted) => {
      posted.push(message);
    };
    const original = QRCode.create.bind(QRCode);
    vi.spyOn(QRCode, 'create').mockImplementation((text, options) => {
      const qr = original(text, options);
      qrCalls.push({ text: String(text), ecc: options?.errorCorrectionLevel, version: qr.version });
      return qr;
    });
  });

  afterEach(async () => {
    await sliceHandler({ data: { type: 'STOP' } });
    await reassemblyHandler({ data: { type: 'CLEAR' } });
    vi.restoreAllMocks();
  });

  it('emits self-describing Prism frames, data within QR version 7 when reliable', async () => {
    const text = 'Air-gapped optical transfer, rateless edition. '.repeat(60);
    const file = new File([text], 'notes.txt', { type: 'text/plain' });
    const init = await startFountain(file, { density: 'reliable' });

    expect(init?.fountain.compression).toBe('deflate-raw');
    expect(init?.fountain.symbolSize).toBeGreaterThan(32);
    expect(init?.fountain.fingerprint).toMatch(/^[a-z]{4}( [a-z]{4}){3}$/);
    expect(init?.totalFrames).toBe(init?.fountain.k);
    expect(init?.sha256).toBe(await sha256Hex(new TextEncoder().encode(text)));

    await pump(20);
    expect(qrCalls.length).toBeGreaterThan(20);
    for (const call of qrCalls) {
      const decoded = decodeFrame(call.text);
      expect(decoded.ok).toBe(true);
      expect(call.ecc).toBe('Q');
      // Only the occasional manifest frame may be a larger code than the data frames.
      if (decoded.ok && decoded.frame.type === 'data') expect(call.version).toBeLessThanOrEqual(7);
    }
    expect(decodeFrame(qrCalls[0].text)).toMatchObject({ ok: true, frame: { type: 'manifest' } });
  });

  it('keeps broadcasting past K until STOP and never reports COMPLETE', async () => {
    const init = await startFountain(new File([randomBytes(300, 4)], 'small.bin'));
    const k = init?.fountain.k ?? 0;
    expect(k).toBeGreaterThan(0);

    await pump(k * 3);
    const frames = posted.filter(m => m.type === 'FRAME');
    expect(frames.length).toBeGreaterThan(k * 3);
    expect(posted.some(m => m.type === 'COMPLETE')).toBe(false);

    await sliceHandler({ data: { type: 'STOP' } });
    const before = posted.length;
    await sliceHandler({ data: { type: 'ACK', payload: { index: k * 3 } } });
    await sliceHandler({ data: { type: 'HEAL', payload: { lastAckedIndex: k * 3 } } });
    expect(posted.length).toBe(before);
  });

  it.each(['reliable', 'balanced', 'fast'] as const)(
    'keeps %s data frames within the density QR version and ECC',
    async density => {
      const { maxVersion, errorCorrectionLevel } = TRANSFER_DENSITY_PROFILES[density];
      const init = await startFountain(new File([randomBytes(6000, 5)], 'd.bin'), { density });
      expect(init?.fountain.density).toBe(density);
      await pump(10);
      expect(qrCalls.length).toBeGreaterThan(10);
      for (const call of qrCalls) {
        expect(call.ecc).toBe(errorCorrectionLevel);
        const decoded = decodeFrame(call.text);
        if (decoded.ok && decoded.frame.type === 'data') expect(call.version).toBeLessThanOrEqual(maxVersion);
      }
    }
  );

  it('carries more bytes per droplet as density rises', async () => {
    const sizes: number[] = [];
    for (const density of ['reliable', 'balanced', 'fast'] as const) {
      posted = [];
      const init = await startFountain(new File([randomBytes(6000, 6)], 'd.bin'), { density });
      sizes.push(init?.fountain.symbolSize ?? 0);
      await sliceHandler({ data: { type: 'STOP' } });
    }
    expect(sizes[0]).toBeLessThan(sizes[1]);
    expect(sizes[1]).toBeLessThan(sizes[2]);
  });

  it('defaults unknown densities to balanced', async () => {
    const init = await startFountain(new File([randomBytes(400, 9)], 'h.bin'), { density: 'turbo' });
    expect(init?.fountain.density).toBe('balanced');
  });

  it.each([
    ['image/jpeg', 'photo.jpg'],
    ['application/zip', 'archive.zip'],
    ['video/mp4', 'clip.mp4'],
  ])('bypasses compression for %s and flags the payload as uncompressed', async (mime, name) => {
    const init = await startFountain(new File(['aaaa'.repeat(400)], name, { type: mime }));
    expect(init?.fountain.compression).toBe('none');
  });

  it('bypasses compression when deflate saves less than 5%', async () => {
    const init = await startFountain(new File([randomBytes(2000, 3)], 'noise.bin', { type: 'application/octet-stream' }));
    expect(init?.fountain.compression).toBe('none');
  });

  it.each([
    ['compressible text', () => new TextEncoder().encode('Bit-for-bit reconstruction over a lossy channel. '.repeat(80)), 'text/plain'],
    ['incompressible binary', () => randomBytes(3000, 77), 'application/octet-stream'],
  ])('reconstructs %s bit-for-bit after mid-stream entry, drops and reordering', async (_label, makeBytes, mime) => {
    const bytes = makeBytes();
    const init = await startFountain(new File([bytes], 'payload.dat', { type: mime }));
    const k = init?.fountain.k ?? 0;
    await pump(k * 4 + 30);
    const droplets = qrCalls.map(c => c.text);

    // Join at frame 9, drop ~35% of frames, and deliver in shuffled order.
    const prng = createPrng(1234);
    const received = droplets.slice(9).filter(() => prng() >= 0.35);
    for (let i = received.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      [received[i], received[j]] = [received[j], received[i]];
    }

    posted = [];
    for (const droplet of received) {
      await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet } });
      if (posted.some(m => m.type === 'COMPLETE' || m.type === 'ERROR')) break;
    }

    const progress = posted.filter(m => m.type === 'PROGRESS');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toMatchObject({ isFountain: true, total: k, dropletsReceived: 1 });
    expect(typeof progress[0].rank).toBe('number');

    const complete = posted.find(m => m.type === 'COMPLETE') as
      | { buffer: ArrayBuffer; handshake: { fileName: string; sha256: string; fileSize: number; mimeType: string } }
      | undefined;
    expect(complete).toBeDefined();
    const output = new Uint8Array(complete!.buffer);
    expect(output).toEqual(bytes);
    expect(complete!.handshake).toMatchObject({ fileName: 'payload.dat', fileSize: bytes.length, mimeType: mime });
    expect(complete!.handshake.sha256).toBe(await sha256Hex(output));
  });

  it('sends with the outer code when asked, and the receiver rebuilds it from shuffled, lossy frames', async () => {
    // The reassembly worker loads the module when it starts; wait for the same file here.
    await loadFecModule();
    const bytes = randomBytes(5000, 78);
    const init = await startFountain(new File([bytes], 'outer.bin', { type: 'application/octet-stream' }), { outerCode: 'fec' });
    expect(init?.fountain.outerCode).toBe('fec');
    const k = init?.fountain.k ?? 0;
    await pump(k * 3 + 40);
    const prng = createPrng(99);
    const received = qrCalls.map(c => c.text).slice(5).filter(() => prng() >= 0.3);
    for (let i = received.length - 1; i > 0; i--) {
      const j = Math.floor(prng() * (i + 1));
      [received[i], received[j]] = [received[j], received[i]];
    }
    posted = [];
    for (const droplet of received) {
      await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet } });
      if (posted.some(m => m.type === 'COMPLETE' || m.type === 'ERROR')) break;
    }
    const progress = posted.filter(m => m.type === 'PROGRESS');
    expect(progress.at(-1)).toMatchObject({ isFountain: true, total: k, rank: k, progress: 100 });
    const complete = posted.find(m => m.type === 'COMPLETE') as { buffer: ArrayBuffer } | undefined;
    expect(complete).toBeDefined();
    expect(new Uint8Array(complete!.buffer)).toEqual(bytes);
  });

  it('sizes every frame as a tile of the multi-code layout, and the receiver rebuilds the file (#1142)', async () => {
    const layout = TILE_LAYOUTS['2x2-v20'];
    const bytes = randomBytes(9000, 31);
    const init = await startFountain(new File([bytes], 'tiles.bin', { type: 'application/octet-stream' }), { tiles: layout.id });
    expect(init?.fountain).toMatchObject({ tiles: '2x2-v20', symbolSize: layout.symbolSize });
    await pump(2 * layout.tiles);
    // Manifest and data frames alike are tiles of one version at ECC L, so the tiles line up.
    expect(qrCalls.length).toBeGreaterThan(layout.tiles);
    expect(new Set(qrCalls.map(c => c.version))).toEqual(new Set([layout.version]));
    expect(new Set(qrCalls.map(c => c.ecc))).toEqual(new Set(['L']));
    const first = decodeFrame(qrCalls[1].text);
    expect(first.ok && first.frame.type === 'data' && first.frame.count).toBe(layout.symbolsPerFrame);

    await pump(Math.ceil(((init?.fountain.k ?? 0) / layout.symbolsPerFrame) * 2) + 20);
    posted = [];
    for (const { text } of qrCalls) {
      await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: text } });
      if (posted.some(m => m.type === 'COMPLETE' || m.type === 'ERROR')) break;
    }
    const complete = posted.find(m => m.type === 'COMPLETE') as { buffer: ArrayBuffer } | undefined;
    expect(new Uint8Array(complete?.buffer ?? new ArrayBuffer(0))).toEqual(bytes);
  });

  it('slots a flagged beacon in after every 7 dense frames, and beacons alone rebuild the file (#1143)', async () => {
    const layout = TILE_LAYOUTS['2x2-v20'];
    const bytes = randomBytes(7000, 32);
    const init = await startFountain(new File([bytes], 'beacons.bin', { type: 'application/octet-stream' }), { tiles: layout.id, beacon: { version: 30, every: 8 } });
    expect(init?.fountain.beacon).toEqual({ version: 30, every: 8 });
    await pump(7 * layout.tiles);
    const beacons = posted.filter(m => m.type === 'BEACON');
    expect(beacons[0]).toMatchObject({ index: 0, size: 137 });

    // Run until enough beacons went out to rebuild the file from them alone.
    await pump(400 * layout.tiles);
    const beaconTexts = qrCalls.filter(c => c.version === 30).map(c => c.text);
    expect(beaconTexts.length).toBeGreaterThan(10);
    const first = decodeFrame(beaconTexts[1]);
    expect(first.ok && (first.frame.flags & FLAG_BEACON) !== 0).toBe(true);
    posted = [];
    for (const droplet of beaconTexts) {
      await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet } });
      if (posted.some(m => m.type === 'COMPLETE' || m.type === 'ERROR')) break;
    }
    const complete = posted.find(m => m.type === 'COMPLETE') as { buffer: ArrayBuffer } | undefined;
    expect(new Uint8Array(complete?.buffer ?? new ArrayBuffer(0))).toEqual(bytes);
  });

  it('switches a steered transfer to another layout in the same session, without resending a symbol (#1146)', async () => {
    const bytes = randomBytes(9000, 33);
    const init = await startFountain(new File([bytes], 'steer.bin', { type: 'application/octet-stream' }), { tiles: '2x2-v20', beacon: { version: 30, every: 8 }, steer: true });
    expect(init?.fountain).toMatchObject({ steerable: true, symbolSize: 350, tiles: '2x2-v20' });
    expect(init?.fountain.sessionId).toMatch(/^[0-9a-f]{12}$/);
    await pump(8);
    const before = qrCalls.filter(c => c.version === 20).slice(0, 8).map(c => c.text);

    qrCalls = [];
    await sliceHandler({ data: { type: 'SWITCH', payload: { tiles: '2x2-v25', beacon: { version: 40, every: 12 } } } });
    expect(posted.find(m => m.type === 'SWITCHED')).toEqual({ type: 'SWITCHED', tiles: '2x2-v25', beacon: { version: 40, every: 12 } });
    await pump(4 * 12);
    const after = qrCalls.filter(c => c.version === 25).map(c => c.text);
    expect(after.length).toBeGreaterThan(8);
    expect(qrCalls.some(c => c.version === 40)).toBe(true);

    const ids = (texts: string[]) => {
      const found = new Set<number>();
      for (const text of texts) {
        const decoded = decodeFrame(text);
        expect(decoded.ok && decoded.frame.sessionId).toBe(init?.fountain.sessionId);
        if (decoded.ok && decoded.frame.type === 'data') for (let offset = 0; offset < decoded.frame.count; offset++) found.add(decoded.frame.firstSymbol + offset);
      }
      return found;
    };
    const shown = ids(before);
    const next = ids(after);
    expect([...next].filter(id => shown.has(id))).toEqual([]);
    expect(Math.min(...next)).toBeGreaterThan(Math.max(...shown));

    // The frames shown before and after the switch rebuild the file together.
    await pump(200);
    posted = [];
    for (const { text } of [...before.map(text => ({ text })), ...qrCalls]) {
      await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: text } });
      if (posted.some(m => m.type === 'COMPLETE' || m.type === 'ERROR')) break;
    }
    const complete = posted.find(m => m.type === 'COMPLETE') as { buffer: ArrayBuffer } | undefined;
    expect(new Uint8Array(complete?.buffer ?? new ArrayBuffer(0))).toEqual(bytes);
  });

  it('ignores a switch when the transfer was not started for steering', async () => {
    const init = await startFountain(new File([randomBytes(900, 7)], 's.bin', { type: 'application/octet-stream' }), { tiles: '2x2-v20' });
    expect(init?.fountain.steerable).toBe(false);
    await sliceHandler({ data: { type: 'SWITCH', payload: { tiles: '2x2-v25' } } });
    expect(posted.some(m => m.type === 'SWITCHED')).toBe(false);
  });

  it('drops a beacon that is no larger than the tiles', async () => {
    const init = await startFountain(new File([randomBytes(900, 6)], 'b.bin', { type: 'application/octet-stream' }), { tiles: '2x2-v25', beacon: { version: 20, every: 8 } });
    expect(init?.fountain.beacon).toBeNull();
  });

  it('ignores an unknown tile layout and sends one code per frame', async () => {
    const init = await startFountain(new File([randomBytes(800, 4)], 'one.bin', { type: 'application/octet-stream' }), { tiles: 'toString' });
    expect(init?.fountain.tiles).toBeNull();
    expect(qrCalls[0].version).toBeLessThan(20);
  });

  it('posts an ERROR (never COMPLETE) when the file SHA-256 does not match the manifest', async () => {
    const stream = handmadeStream(new TextEncoder().encode('forged'), { size: 6, sha256: 'ff'.repeat(32) });
    await feedUntilDone(stream);
    expect(posted.some(m => m.type === 'COMPLETE')).toBe(false);
    expect(posted.find(m => m.type === 'ERROR')).toMatchObject({ isFountain: true, error: expect.stringMatching(/SHA-256/) });
  });

  it('announces the manifest to the page before any data is decoded', async () => {
    const stream = handmadeStream(randomBytes(400, 5), { size: 400, sha256: 'ab'.repeat(32) });
    await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: stream.frameText(0) } });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'MANIFEST', manifest: { totalSize: 400, files: [{ name: 'f.bin', size: 400 }] } });
  });

  it('still posts an ERROR for a forged legacy ur:bytes session', async () => {
    const bytes = new TextEncoder().encode('forged');
    const message = encodeSessionMessage(
      { fileName: 'f.txt', mimeType: 'text/plain', fileSize: bytes.length, sha256: 'ff'.repeat(32), compression: 'none' },
      bytes
    );
    const encoder = new FountainEncoder(message, { blockSize: 16 });
    for (let i = 0; i < encoder.k; i++) {
      await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: encoder.dropletStringForIndex(i) } });
    }
    expect(posted.some(m => m.type === 'COMPLETE')).toBe(false);
    expect(posted.find(m => m.type === 'ERROR')).toMatchObject({ isFountain: true, error: expect.stringMatching(/SHA-256/) });
  });

  it('ignores junk and duplicate droplets without stalling', async () => {
    await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: 'UR:BYTES/1-1/NOTBYTEWORDS' } });
    await reassemblyHandler({ data: { type: 'DROPLET', droplet: 'hello' } });
    expect(posted).toHaveLength(0);
  });

  describe('receive limits (#1154)', () => {
    it('rejects a manifest claiming 2 GB without allocating', async () => {
      const stream = handmadeStream(new Uint8Array(64), { size: 2_000_000_000, sha256: 'a'.repeat(64) });
      const frame = stream.frameText(0);
      const before = process.memoryUsage().arrayBuffers;
      await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: frame } });
      // Nothing close to the claimed 2 GB (or even the 100 MB limit) was allocated for it.
      expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(MAX_RECEIVE_BYTES / 2);
      expect(posted.some(m => m.type === 'MANIFEST')).toBe(false);
      expect(String(posted.find(m => m.type === 'ERROR')?.error)).toMatch(/beyond the 100 MB limit/);
    });

    it('rejects a manifest whose transfer length passes the limit', async () => {
      const stream = handmadeStream(new Uint8Array(64), { size: 64, sha256: 'a'.repeat(64), transferLength: MAX_RECEIVE_BYTES * 2 });
      await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: stream.frameText(0) } });
      expect(posted.some(m => m.type === 'ERROR')).toBe(true);
      expect(posted.some(m => m.type === 'PROGRESS')).toBe(false);
    });

    it('stops a deflate bomb at the size the manifest declares', async () => {
      const bomb = new Uint8Array(8 * 1024 * 1024);
      const compressed = new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
      const stream = handmadeStream(compressed, { size: 1024, sha256: '0'.repeat(64), compression: 'deflate-raw', symbolSize: 64 });
      await feedUntilDone(stream);
      expect(posted.some(m => m.type === 'COMPLETE')).toBe(false);
      expect(String(posted.find(m => m.type === 'ERROR')?.error)).toMatch(/expands to more than the 1024 bytes/);
    });

    it('stops a legacy deflate bomb at the size the header declares', async () => {
      // 8 MB of zeros deflate to a few KB; the header lies and declares 1 KB.
      const bomb = new Uint8Array(8 * 1024 * 1024);
      const stream = new Blob([bomb]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
      expect(compressed.length).toBeLessThan(64 * 1024);

      const message = encodeSessionMessage(
        { fileName: 'bomb.bin', mimeType: 'application/octet-stream', fileSize: 1024, sha256: '0'.repeat(64), compression: 'deflate-raw' },
        compressed
      );
      const encoder = new FountainEncoder(message, { blockSize: 64, maxSeq: 100_000 });
      for (let i = 0; i < encoder.k * 3; i++) {
        await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: encoder.nextDropletString() } });
        if (posted.some(m => m.type === 'ERROR' || m.type === 'COMPLETE')) break;
      }
      const error = posted.find(m => m.type === 'ERROR');
      expect(posted.some(m => m.type === 'COMPLETE')).toBe(false);
      expect(String(error?.error)).toMatch(/expands to more than the 1024 bytes/);
    });

    it('rejects a header that claims more than the receive limit', async () => {
      const message = encodeSessionMessage(
        { fileName: 'huge.bin', mimeType: 'application/octet-stream', fileSize: 2_000_000_000, sha256: '0'.repeat(64), compression: 'none' },
        new Uint8Array(64)
      );
      const encoder = new FountainEncoder(message, { blockSize: 64, maxSeq: 10_000 });
      for (let i = 0; i < encoder.k * 3; i++) {
        await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: encoder.nextDropletString() } });
        if (posted.some(m => m.type === 'ERROR' || m.type === 'COMPLETE')) break;
      }
      expect(String(posted.find(m => m.type === 'ERROR')?.error)).toMatch(/more than the 100 MB limit/);
    });
  });
});
