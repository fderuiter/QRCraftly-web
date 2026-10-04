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


import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import type { QrSymbolEncoder } from '@/packages/qr-matrix/encoder';
import { createPrng, parseKeyCode, sha256Hex } from '../index';

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
let sliceEncoder: QrSymbolEncoder;
let posted: Posted[] = [];

function randomBytes(length: number, seed: number): Uint8Array {
  const prng = createPrng(seed);
  return Uint8Array.from({ length }, () => Math.floor(prng() * 256));
}

interface Initialized {
  type: 'INITIALIZED';
  fountain: { k: number; fileCount: number; keyCode?: string; fingerprint: string };
}

async function start(payload: Record<string, unknown>): Promise<Initialized> {
  await sliceHandler({ data: { type: 'START', payload: { fps: 15, density: 'balanced', ...payload } } });
  return posted.find((m) => m.type === 'INITIALIZED') as unknown as Initialized;
}

let frameTexts: string[] = [];

/** Lets the sender's lookahead fill by ACKing frames one by one, then returns the frame texts it made. */
async function collectFrames(count: number): Promise<string[]> {
  for (let i = 0; i < count; i++) {
    await sliceHandler({ data: { type: 'ACK', payload: { index: i } } });
  }
  return frameTexts.slice(0, count);
}

/** Feeds frames to the receiving worker until it answers with COMPLETE or ERROR. */
async function feed(texts: readonly string[]) {
  for (const droplet of texts) {
    await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet } });
    if (posted.some((m) => m.type === 'ERROR' || m.type === 'COMPLETE')) break;
  }
}

describe('private and multi-file transfer workers', () => {
  beforeAll(async () => {
    globalScope.self = globalThis;
    vi.resetModules();
    await import('../worker-slice');
    sliceHandler = globalScope.onmessage as Handler;
    sliceEncoder = await (await import('@/packages/qr-matrix/encoder')).loadQrEncoder();
    vi.resetModules();
    await import('../worker-reassembly');
    reassemblyHandler = globalScope.onmessage as Handler;
  });

  beforeEach(() => {
    posted = [];
    frameTexts = [];
    globalScope.postMessage = (message: Posted) => {
      posted.push(message);
    };
    const original = sliceEncoder.create.bind(sliceEncoder);
    vi.spyOn(sliceEncoder, 'create').mockImplementation((text, options) => {
      frameTexts.push(String(text));
      return original(text, options);
    });
  });

  afterEach(async () => {
    await sliceHandler({ data: { type: 'STOP' } });
    await reassemblyHandler({ data: { type: 'CLEAR' } });
    vi.restoreAllMocks();
  });

  it('starts a transfer of several files and reports how many', async () => {
    const files = [
      new File(['one'.repeat(50)], 'one.txt', { type: 'text/plain' }),
      new File(['two'.repeat(50)], 'two.txt', { type: 'text/plain' }),
    ];
    const init = await start({ files });
    expect(init.fountain.fileCount).toBe(2);
    expect(init.fountain.keyCode).toBeUndefined();
    expect(posted.find((m) => m.type === 'PROGRESS')).toMatchObject({ fileName: '2 files', fileSize: 300 });
  });

  it('uses the folder path a browser reports for a picked folder', async () => {
    const inner = new File(['inside'], 'inner.txt', { type: 'text/plain' });
    Object.defineProperty(inner, 'webkitRelativePath', { value: 'folder/sub/inner.txt' });
    const init = await start({ files: [inner, new File(['b'], 'b.txt')] });
    expect(init.fountain.fileCount).toBe(2);
  });

  it('gives a private transfer a key code and a key QR, and only then', async () => {
    const init = await start({ file: new File([randomBytes(400, 1)], 'x.bin'), private: true });
    expect(parseKeyCode(init.fountain.keyCode ?? '')).not.toBeNull();

    await sliceHandler({ data: { type: 'KEY_QR' } });
    const keyFrame = posted.find((m) => m.type === 'KEY_FRAME');
    expect(keyFrame).toMatchObject({ size: expect.any(Number) });
    expect((keyFrame?.data as Uint8Array).length).toBe((keyFrame?.size as number) ** 2);

    posted = [];
    await sliceHandler({ data: { type: 'STOP' } });
    await start({ file: new File([randomBytes(400, 2)], 'y.bin') });
    await sliceHandler({ data: { type: 'KEY_QR' } });
    expect(posted.find((m) => m.type === 'KEY_FRAME')).toBeUndefined();
  });

  it('reads a key code, reports whether it was readable, and waits for the stream', async () => {
    await reassemblyHandler({ data: { type: 'SET_KEY', code: 'not a key code' } });
    expect(posted.find((m) => m.type === 'KEY_STATUS')).toMatchObject({ accepted: false });
    posted = [];
    await reassemblyHandler({ data: { type: 'SET_KEY', code: 'baba-baba-baba-baba-baba-baba-baba-baba' } });
    expect(posted.find((m) => m.type === 'KEY_STATUS')).toMatchObject({ accepted: true });
  });

  it('answers a decision about a stream that was never offered without failing', async () => {
    await reassemblyHandler({ data: { type: 'SWITCH_DECISION', session: 'ffffffffffff', accept: true } });
    await reassemblyHandler({ data: { type: 'SWITCH_DECISION', session: 'ffffffffffff', accept: false } });
    expect(posted.find((m) => m.type === 'ERROR')).toBeUndefined();
  });

  it('delivers the files of a bundle together, each with its own hash', async () => {
    const first = new File(['alpha '.repeat(40)], 'a.txt', { type: 'text/plain' });
    const second = new File([randomBytes(300, 5)], 'b.bin');
    const init = await start({ files: [first, second] });
    await feed(await collectFrames(init.fountain.k * 4 + 20));

    const complete = posted.find((m) => m.type === 'COMPLETE') as unknown as {
      files: Array<{ buffer: ArrayBuffer; handshake: { fileName: string; fileSize: number; sha256: string } }>;
    };
    expect(complete.files.map((file) => file.handshake.fileName)).toEqual(['a.txt', 'b.bin']);
    expect(new Uint8Array(complete.files[1].buffer)).toEqual(new Uint8Array(await second.arrayBuffer()));
    expect(complete.files[0].handshake.sha256).toBe(await sha256Hex(new Uint8Array(await first.arrayBuffer())));
  });

  it('opens a private transfer only once the key code is typed, even after all the frames arrived', async () => {
    const bytes = randomBytes(500, 9);
    const init = await start({ file: new File([bytes], 'secret.bin'), private: true });
    await feed(await collectFrames(init.fountain.k * 4 + 20));
    expect(posted.find((m) => m.type === 'MANIFEST')).toMatchObject({ needsKey: true });
    expect(posted.find((m) => m.type === 'COMPLETE')).toBeUndefined();

    await reassemblyHandler({ data: { type: 'SET_KEY', code: init.fountain.keyCode } });
    const complete = posted.find((m) => m.type === 'COMPLETE') as unknown as { buffer: ArrayBuffer; handshake: { fileName: string } };
    expect(complete.handshake.fileName).toBe('secret.bin');
    expect(new Uint8Array(complete.buffer)).toEqual(bytes);
  });

  it('opens a private transfer from the key QR a camera read', async () => {
    const init = await start({ file: new File([randomBytes(500, 10)], 'qr.bin'), private: true });
    await sliceHandler({ data: { type: 'KEY_QR' } });
    const keyText = frameTexts.find((text) => text.startsWith('QRKEY:'));
    expect(keyText).toBeDefined();
    await feed((await collectFrames(init.fountain.k * 4 + 20)).filter((text) => !text.startsWith('QRKEY:')));
    expect(posted.find((m) => m.type === 'COMPLETE')).toBeUndefined();
    await reassemblyHandler({ data: { type: 'FOUNTAIN_DROPLET', droplet: keyText } });
    expect(posted.find((m) => m.type === 'COMPLETE')).toBeDefined();
  });
});
