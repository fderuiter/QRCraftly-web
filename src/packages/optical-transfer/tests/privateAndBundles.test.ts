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
import {
  FountainReassembler,
  KEY_CODE_WORDS,
  KEY_SECRET_BYTES,
  MANIFEST_INTERVAL,
  MAX_BUNDLE_ENTRIES,
  TRANSFER_DENSITY_PROFILES,
  bytesToWords,
  createPrismBundleSession,
  createPrismSession,
  createPrng,
  decodeFrame,
  decryptBlock,
  deriveKeys,
  encodeDataFrame,
  encryptBlock,
  fingerprintWords,
  formatKeyCode,
  generateSecret,
  hkdfSha256,
  hmacSha256,
  keyQrText,
  packBundle,
  parseKeyCode,
  parseKeyQr,
  privateSessionId,
  sanitizeRelativePath,
  sha256Hex,
  unpackBundle,
  wordsToBytes,
} from '../index';

const text = (value: string) => new TextEncoder().encode(value);
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function randomBytes(length: number, seed = 1): Uint8Array {
  const prng = createPrng(seed);
  return Uint8Array.from({ length }, () => Math.floor(prng() * 256));
}

const profile = TRANSFER_DENSITY_PROFILES.balanced;
const options = { errorCorrectionLevel: profile.errorCorrectionLevel, maxVersion: profile.maxVersion };

/** Plays a stream into a reassembler and returns it once complete. */
function play(stream: { frameText(index: number): string; k: number }, reassembler = new FountainReassembler(), join = 0): FountainReassembler {
  for (let index = join; index < join + stream.k * 6 + 64 && !reassembler.isComplete; index++) reassembler.ingest(stream.frameText(index));
  return reassembler;
}

describe('key and fingerprint words', () => {
  it('round-trips bytes through words, 12 bits to a word', () => {
    const bytes = randomBytes(KEY_SECRET_BYTES, 3);
    const words = bytesToWords(bytes);
    expect(words).toHaveLength(KEY_CODE_WORDS);
    words.forEach((word) => expect(word).toMatch(/^[a-z]{4}$/));
    expect(wordsToBytes(words)).toEqual(bytes);
  });

  it('reads a key code however it was typed', () => {
    const secret = generateSecret();
    const code = formatKeyCode(secret);
    expect(parseKeyCode(code)).toEqual(secret);
    expect(parseKeyCode(code.toUpperCase().replace(/-/g, '  '))).toEqual(secret);
    expect(parseKeyCode(code.replace(/-/g, ',\n'))).toEqual(secret);
  });

  it('turns away a code with a wrong word, the wrong count or junk', () => {
    const words = formatKeyCode(generateSecret()).split('-');
    expect(parseKeyCode(words.slice(1).join('-'))).toBeNull();
    expect(parseKeyCode([...words.slice(0, 7), 'xxxx'].join('-'))).toBeNull();
    expect(parseKeyCode('')).toBeNull();
    expect(parseKeyCode('12345678')).toBeNull();
  });

  it('writes the four-word fingerprint of a session ID, and never an unwelcome word', () => {
    expect(fingerprintWords(Uint8Array.from([0, 0, 0, 0, 0, 0]))).toMatch(/^[a-z]{4}( [a-z]{4}){3}$/);
    const all = new Set<string>();
    for (let i = 0; i < 4096; i += 1) {
      all.add(bytesToWords(Uint8Array.from([i >> 4, (i & 15) << 4, 0]))[0]);
    }
    expect(all.size).toBe(4096);
    for (const bad of ['homo', 'nazi', 'pedo', 'kike', 'paki', 'coon', 'rape']) expect(all.has(bad)).toBe(false);
  });

  it('reads a key QR and nothing else', () => {
    const secret = generateSecret();
    expect(parseKeyQr(keyQrText(secret))).toEqual(secret);
    expect(parseKeyQr(formatKeyCode(secret))).toBeNull();
    expect(parseKeyQr('https://example.com')).toBeNull();
  });
});

describe('private transfer cryptography', () => {
  it('matches Web Crypto for HMAC-SHA-256 and HKDF-SHA-256', async () => {
    for (const [keyLength, messageLength] of [[3, 0], [16, 5], [64, 100], [100, 200]]) {
      const key = randomBytes(keyLength, keyLength);
      const message = randomBytes(messageLength, messageLength + 1);
      const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const expected = new Uint8Array(await crypto.subtle.sign('HMAC', imported, message));
      expect(hmacSha256(key, message)).toEqual(expected);
    }
    const secret = randomBytes(12, 9);
    const salt = randomBytes(16, 10);
    const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
    const info = text('qrcraftly test');
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, 256);
    expect(hkdfSha256(secret, salt, info)).toEqual(new Uint8Array(bits));
  });

  it('opens with the right key, and refuses a wrong key or a changed byte', async () => {
    const keys = deriveKeys(generateSecret(), randomBytes(16, 1));
    const sealed = await encryptBlock(keys, text('the quarterly numbers'));
    expect(new TextDecoder().decode(await decryptBlock(keys, sealed))).toBe('the quarterly numbers');
    await expect(decryptBlock(deriveKeys(generateSecret(), randomBytes(16, 1)), sealed)).rejects.toThrow(/key code is wrong/);
    const changed = Uint8Array.from(sealed);
    changed[3] ^= 1;
    await expect(decryptBlock(keys, changed)).rejects.toThrow(/key code is wrong or the transfer was changed/);
    await expect(decryptBlock(keys, new Uint8Array(4))).rejects.toThrow(/damaged/);
    // The block number is part of the nonce, so a block cannot be replayed as another.
    await expect(decryptBlock(keys, sealed, 1)).rejects.toThrow();
  });

  it('derives a session ID only the key holder can make', () => {
    const salt = randomBytes(16, 5);
    const manifest = randomBytes(40, 6);
    const a = deriveKeys(generateSecret(), salt);
    const b = deriveKeys(generateSecret(), salt);
    expect(privateSessionId(a, manifest)).toEqual(privateSessionId(a, manifest));
    expect(privateSessionId(a, manifest)).not.toEqual(privateSessionId(b, manifest));
  });
});

describe('bundles', () => {
  it('lays out and reads back 1, 10 and 200 files byte for byte', async () => {
    for (const count of [1, 10, 200]) {
      const sources = Array.from({ length: count }, (_, i) => ({ path: `dir${i % 3}/file${i}.bin`, mimeType: 'application/octet-stream', data: randomBytes(i * 7 + 5, i + 1) }));
      const { message } = await packBundle(sources);
      const files = await unpackBundle(message);
      expect(files).toHaveLength(count);
      for (const [i, file] of files.entries()) {
        expect(file.data).toEqual(sources[i].data);
        expect(file.path).toBe(sources[i].path);
        expect(file.sha256).toBe(await sha256Hex(sources[i].data));
      }
    }
  });

  it('refuses more files than the limit', async () => {
    const many = Array.from({ length: MAX_BUNDLE_ENTRIES + 1 }, (_, i) => ({ path: `f${i}`, mimeType: '', data: new Uint8Array(1) }));
    await expect(packBundle(many)).rejects.toThrow(/1 to 1000 files/);
    await expect(packBundle([])).rejects.toThrow(RangeError);
  });

  it('rewrites traversal, absolute and hidden-character paths safely', () => {
    expect(sanitizeRelativePath('../../etc/passwd')).toBe('_/_/etc/passwd');
    expect(sanitizeRelativePath('/etc/passwd')).toBe('etc/passwd');
    expect(sanitizeRelativePath(['C:', 'Windows', 'system32', 'evil.exe'].join('\\'))).toBe('C_/Windows/system32/evil.exe');
    expect(sanitizeRelativePath('photos/inv\u202Eoice.exe')).toBe('photos/invoice.exe');
    expect(sanitizeRelativePath('a/\u0000b/c.txt')).toBe('a/_b/c.txt');
    expect(sanitizeRelativePath('///')).toBe('file');
    expect(sanitizeRelativePath('con/aux.txt')).toBe('_con/_aux.txt');
    expect(sanitizeRelativePath('a/b/c/d/e/f/g/h/i/j/k/l/m/n/o.txt').split('/').length).toBeLessThanOrEqual(12);
  });

  it('keeps colliding names apart', async () => {
    const { message } = await packBundle([
      { path: 'a/report.txt', mimeType: 'text/plain', data: text('one') },
      { path: 'A/Report.txt', mimeType: 'text/plain', data: text('two') },
      { path: 'a/../a/report.txt', mimeType: 'text/plain', data: text('three') },
    ]);
    const names = (await unpackBundle(message)).map((file) => file.path);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(3);
  });

  it('fails the whole bundle, naming the file, when one file does not match its hash', async () => {
    const { message } = await packBundle([
      { path: 'good.txt', mimeType: 'text/plain', data: text('good bytes') },
      { path: 'bad.txt', mimeType: 'text/plain', data: text('bad bytes!') },
    ]);
    const changed = Uint8Array.from(message);
    changed[changed.length - 1] ^= 1;
    await expect(unpackBundle(changed)).rejects.toThrow(/bad\.txt does not match its SHA-256/);
  });

  it('refuses a damaged index', async () => {
    await expect(unpackBundle(new Uint8Array(2))).rejects.toThrow(/damaged/);
    await expect(unpackBundle(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 1, 2]))).rejects.toThrow(/damaged/);
    await expect(unpackBundle(Uint8Array.from([0, 0, 0, 1, 0xff, 9]))).rejects.toThrow(/damaged/);
  });
});

describe('multi-file transfer end to end', () => {
  const sources = [
    { path: 'notes/readme.txt', mimeType: 'text/plain', data: text('hello bundle '.repeat(60)) },
    { path: 'notes/data.bin', mimeType: 'application/octet-stream', data: randomBytes(700, 4) },
    { path: 'photo.jpg', mimeType: 'image/jpeg', data: randomBytes(300, 5) },
  ];

  it('announces the count, then delivers every file verified', async () => {
    const { stream, manifest } = await createPrismBundleSession(sources, { fileName: '', mimeType: '', ...options });
    expect(manifest.files).toEqual([]);
    expect(manifest.entryCount).toBe(3);
    const reassembler = new FountainReassembler();
    let announced = null;
    for (let i = 0; i < MANIFEST_INTERVAL + 2 && !announced; i++) {
      reassembler.ingest(stream.frameText(i));
      announced = reassembler.takeManifest();
    }
    expect(announced).toMatchObject({ bundle: true, encrypted: false, entryCount: 3, files: [] });
    play(stream, reassembler, 5);
    const { files } = await reassembler.finalize();
    expect(files.map((file) => file.header.fileName)).toEqual(['notes/readme.txt', 'notes/data.bin', 'photo.jpg']);
    files.forEach((file, i) => expect(file.data).toEqual(sources[i].data));
  });
});

describe('private transfer end to end', () => {
  const file = randomBytes(1500, 7);

  async function privateStream(name = 'salary.xlsx') {
    return createPrismSession(file, { fileName: name, mimeType: 'application/vnd.ms-excel', private: true, ...options });
  }

  it('hides the file name, type, size and hash in every frame', async () => {
    const { stream, manifest, keyCode } = await privateStream('secret-plan.xlsx');
    expect(keyCode?.split('-')).toHaveLength(KEY_CODE_WORDS);
    expect(manifest).toMatchObject({ encryption: 1, files: [], unpackedSha256: new Uint8Array(0), entryCount: 0 });
    for (let i = 0; i < 80; i++) {
      const frameText = stream.frameText(i);
      const decoded = decodeFrame(frameText);
      expect(decoded.ok).toBe(true);
      if (decoded.ok && decoded.frame.type === 'manifest') {
        expect(new TextDecoder('latin1').decode(decoded.frame.manifest)).not.toContain('secret-plan');
      }
    }
    expect(hex(stream.sessionId)).not.toBe(hex((await createPrismSession(file, { fileName: 'secret-plan.xlsx', mimeType: 'application/vnd.ms-excel', ...options })).stream.sessionId));
  });

  it('waits for the key, then opens the file once the right code is set, even after the data arrived', async () => {
    const { stream, keyCode } = await privateStream();
    const reassembler = new FountainReassembler();
    let announcement = null;
    for (let i = 0; i < stream.k * 6 + 64 && !reassembler.isComplete; i++) {
      reassembler.ingest(stream.frameText(i));
      announcement = reassembler.takeManifest() ?? announcement;
      if (reassembler.needsKey && i > stream.k * 3) break;
    }
    expect(announcement).toMatchObject({ encrypted: true, bundle: true, files: [] });
    expect(reassembler.needsKey).toBe(true);
    expect(reassembler.isComplete).toBe(false);
    await expect(reassembler.finalize()).rejects.toThrow();

    reassembler.setKey(parseKeyCode(keyCode ?? '') ?? new Uint8Array());
    expect(reassembler.needsKey).toBe(false);
    play(stream, reassembler, 0);
    expect(reassembler.isComplete).toBe(true);
    const {
      files: [opened],
    } = await reassembler.finalize();
    expect(opened.data).toEqual(file);
    expect(opened.header).toMatchObject({ fileName: 'salary.xlsx', mimeType: 'application/vnd.ms-excel', fileSize: 1500, sha256: await sha256Hex(file) });
  });

  it('with the key known up front, receives it in one pass from any frame', async () => {
    const { stream, keyCode } = await privateStream();
    const reassembler = new FountainReassembler();
    reassembler.setKey(parseKeyCode(keyCode ?? '') ?? new Uint8Array());
    play(stream, reassembler, 23);
    expect((await reassembler.finalize()).files[0].data).toEqual(file);
  });

  it('turns away a wrong key code with a message and takes nothing from the stream', async () => {
    const { stream } = await privateStream();
    const reassembler = new FountainReassembler();
    reassembler.setKey(generateSecret());
    for (let i = 0; i < 70; i++) reassembler.ingest(stream.frameText(i));
    expect(reassembler.takeRejection()).toMatch(/key code does not match/);
    expect(reassembler.takeManifest()).toBeNull();
    expect(reassembler.snapshot()).toBeNull();
    // The message comes once, not on every manifest.
    for (let i = 70; i < 120; i++) reassembler.ingest(stream.frameText(i));
    expect(reassembler.takeRejection()).toBeNull();
  });

  it('drops a session when the key typed later does not match', async () => {
    const { stream } = await privateStream();
    const reassembler = new FountainReassembler();
    for (let i = 0; i < 20; i++) reassembler.ingest(stream.frameText(i));
    expect(reassembler.needsKey).toBe(true);
    reassembler.setKey(generateSecret());
    expect(reassembler.needsKey).toBe(false);
    expect(reassembler.takeRejection()).toMatch(/key code does not match/);
    expect(reassembler.snapshot()).toBeNull();
  });

  it('ignores a stream that is not private once a key code is set', async () => {
    const plain = (await createPrismSession(file, { fileName: 'plain.bin', mimeType: '', ...options })).stream;
    const reassembler = new FountainReassembler();
    reassembler.setKey(generateSecret());
    for (let i = 0; i < 40; i++) reassembler.ingest(plain.frameText(i));
    expect(reassembler.takeManifest()).toBeNull();
    expect(reassembler.snapshot()).toBeNull();
    expect(reassembler.takeRejection()).toMatch(/not private/);
  });

  it('never lets another stream replace a private session the key opened', async () => {
    const { stream, keyCode } = await privateStream();
    const other = (await createPrismSession(randomBytes(900, 8), { fileName: 'other.bin', mimeType: '', ...options })).stream;
    const reassembler = new FountainReassembler();
    reassembler.setKey(parseKeyCode(keyCode ?? '') ?? new Uint8Array());
    for (let i = 0; i < 6; i++) reassembler.ingest(stream.frameText(i));
    for (let i = 0; i < 64; i++) reassembler.ingest(other.frameText(i));
    expect(reassembler.takeSwitchOffer()).toBeNull();
    play(stream, reassembler, 6);
    expect((await reassembler.finalize()).files[0].data).toEqual(file);
  });

  it('refuses a tampered ciphertext at the end, with a message', async () => {
    const { stream, keyCode } = await privateStream();
    const reassembler = new FountainReassembler();
    reassembler.setKey(parseKeyCode(keyCode ?? '') ?? new Uint8Array());
    // Replace every data frame with symbols that are all wrong but carry the right header.
    for (let i = 0; i < stream.k * 4; i++) {
      const decoded = decodeFrame(stream.frameText(i));
      if (!decoded.ok) continue;
      if (decoded.frame.type !== 'data') {
        reassembler.ingest(stream.frameText(i));
        continue;
      }
      const symbols = Uint8Array.from(decoded.frame.symbols);
      symbols[0] ^= 0xff;
      reassembler.ingest(encodeDataFrame({ sessionId: stream.sessionId, firstSymbol: decoded.frame.firstSymbol, symbols: [symbols], flags: decoded.frame.flags }));
      if (reassembler.isComplete) break;
    }
    if (reassembler.isComplete) await expect(reassembler.finalize()).rejects.toThrow(/checksum|did not open|Integrity|damaged/);
    else expect(reassembler.snapshot()?.progress ?? 0).toBeLessThan(100);
  });
});

describe('asking before switching streams', () => {
  const profileOptions = options;

  it('offers another unencrypted stream after it has been in view, and switches only when told to', async () => {
    const a = (await createPrismSession(randomBytes(2500, 21), { fileName: 'a.bin', mimeType: '', ...profileOptions })).stream;
    const b = (await createPrismSession(randomBytes(2500, 22), { fileName: 'b.bin', mimeType: '', ...profileOptions })).stream;
    const reassembler = new FountainReassembler();
    for (let i = 0; i < 6; i++) reassembler.ingest(a.frameText(i));
    // b's manifest is seen first (it becomes a candidate), then its data frames stream past.
    for (let i = 0; i < 24; i++) reassembler.ingest(b.frameText(i));
    const offer = reassembler.takeSwitchOffer();
    expect(offer?.files[0].name).toBe('b.bin');
    // Nothing switched without an answer, and the offer comes once.
    expect(reassembler.takeSwitchOffer()).toBeNull();
    expect(reassembler.snapshot()?.dropletsReceived).toBeGreaterThan(0);
    const before = reassembler.snapshot()?.k;
    expect(before).toBe(a.k);

    reassembler.acceptSwitch(offer?.sessionId ?? '');
    expect(reassembler.takeManifest()?.files[0].name).toBe('b.bin');
    play(b, reassembler, 24);
    expect((await reassembler.finalize()).files[0].header.fileName).toBe('b.bin');
  });

  it('keeps the current stream and does not offer the other again once declined', async () => {
    const a = (await createPrismSession(randomBytes(2500, 23), { fileName: 'a.bin', mimeType: '', ...profileOptions })).stream;
    const b = (await createPrismSession(randomBytes(2500, 24), { fileName: 'b.bin', mimeType: '', ...profileOptions })).stream;
    const reassembler = new FountainReassembler();
    for (let i = 0; i < 6; i++) reassembler.ingest(a.frameText(i));
    for (let i = 0; i < 24; i++) reassembler.ingest(b.frameText(i));
    const offer = reassembler.takeSwitchOffer();
    reassembler.declineSwitch(offer?.sessionId ?? '');
    for (let i = 24; i < 90; i++) reassembler.ingest(b.frameText(i));
    expect(reassembler.takeSwitchOffer()).toBeNull();
    play(a, reassembler, 6);
    expect((await reassembler.finalize()).files[0].header.fileName).toBe('a.bin');
  });
});
