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

/**
 * Regenerates the frozen BC-UR test vectors in
 * `src/packages/optical-transfer/tests/fixtures/bcur/` (#1181). Not run in CI.
 *
 * The vectors were made once with `@ngraveio/bc-ur`, which is no longer a dependency
 * (ADR 0040). To regenerate them, install it for the run only:
 *
 * ```sh
 * pnpm add -D @ngraveio/bc-ur@1.1.13
 * pnpm exec tsx scripts/fixtures/generate_bcur_vectors.ts
 * pnpm remove @ngraveio/bc-ur
 * ```
 *
 * Each file records the package version, this script and the date. The script
 * stops if our own encoder disagrees with the reference on any vector.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { UR, UREncoder, URDecoder } from '@ngraveio/bc-ur';
import { BcUrEncoder } from '../../src/packages/optical-transfer/bcur';
import { cborEncode } from '../../src/packages/optical-transfer/index';

// The package's deep modules are CommonJS with a `default` export.
const requireReference = createRequire(import.meta.url);
const { encode: encodeBytewords } = requireReference('@ngraveio/bc-ur/dist/bytewords').default;
const { getCRC } = requireReference('@ngraveio/bc-ur/dist/utils');

const REFERENCE = '@ngraveio/bc-ur@1.1.13';
const SCRIPT = 'scripts/fixtures/generate_bcur_vectors.ts';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../src/packages/optical-transfer/tests/fixtures/bcur');

/** The first 256 bytes of BCR-2024-001's `makeMessage` ("Wolf"), the message of `testEncoderCBOR`. */
const BCR_2024_MESSAGE =
  '916ec65cf77cadf55cd7f9cda1a1030026ddd42e905b77adc36e4f2d3ccba44f7f04f2de44f42d84c374a0e149136f25b01852545961d55f7f7a8cde6d0e2ec43f3b2dcb644a2209e8c9e34af5c4747984a5e873c9cf5f965e25ee29039fdf8ca74f1c769fc07eb7ebaec46e0695aea6cbd60b3ec4bbff1b9ffe8a9e7240129377b9d3711ed38d412fbb4442256f1e6f595e0fc57fed451fb0a0101fb76b1fb1e1b88cfdfdaa946294a47de8fff173f021c0e6f65b05c0a494e50791270a0050a73ae69b6725505a2ec8a5791457c9876dd34aadd192a53aa0dc66b556c0c215c7ceb8248b717c22951e65305b56a3706e3e86eb01c803bbf915d80edcd64d4d';

/** BCR-2024-001 `testEncoderCBOR`: the first 20 fountain parts of that message at `maxFragmentLen` 30. */
const BCR_2024_PARTS = [
  '8501091901001a0167aa07581d916ec65cf77cadf55cd7f9cda1a1030026ddd42e905b77adc36e4f2d3c',
  '8502091901001a0167aa07581dcba44f7f04f2de44f42d84c374a0e149136f25b01852545961d55f7f7a',
  '8503091901001a0167aa07581d8cde6d0e2ec43f3b2dcb644a2209e8c9e34af5c4747984a5e873c9cf5f',
  '8504091901001a0167aa07581d965e25ee29039fdf8ca74f1c769fc07eb7ebaec46e0695aea6cbd60b3e',
  '8505091901001a0167aa07581dc4bbff1b9ffe8a9e7240129377b9d3711ed38d412fbb4442256f1e6f59',
  '8506091901001a0167aa07581d5e0fc57fed451fb0a0101fb76b1fb1e1b88cfdfdaa946294a47de8fff1',
  '8507091901001a0167aa07581d73f021c0e6f65b05c0a494e50791270a0050a73ae69b6725505a2ec8a5',
  '8508091901001a0167aa07581d791457c9876dd34aadd192a53aa0dc66b556c0c215c7ceb8248b717c22',
  '8509091901001a0167aa07581d951e65305b56a3706e3e86eb01c803bbf915d80edcd64d4d0000000000',
  '850a091901001a0167aa07581d330f0f33a05eead4f331df229871bee733b50de71afd2e5a79f196de09',
  '850b091901001a0167aa07581d3b205ce5e52d8c24a52cffa34c564fa1af3fdffcd349dc4258ee4ee828',
  '850c091901001a0167aa07581ddd7bf725ea6c16d531b5f03254783803048ca08b87148daacd1cd7a006',
  '850d091901001a0167aa07581d760be7ad1c6187902bbc04f539b9ee5eb8ea6833222edea36031306c01',
  '850e091901001a0167aa07581d5bf4031217d2c3254b088fa7553778b5003632f46e21db129416f65b55',
  '850f091901001a0167aa07581d73f021c0e6f65b05c0a494e50791270a0050a73ae69b6725505a2ec8a5',
  '8510091901001a0167aa07581db8546ebfe2048541348910267331c643133f828afec9337c318f71b7df',
  '8511091901001a0167aa07581d23dedeea74e3a0fb052befabefa13e2f80e4315c9dceed4c8630612e64',
  '8512091901001a0167aa07581dd01a8daee769ce34b6b35d3ca0005302724abddae405bdb419c0a6b208',
  '8513091901001a0167aa07581d3171c5dc365766eff25ae47c6f10e7de48cfb8474e050e5fe997a6dc24',
  '8514091901001a0167aa07581de055c2433562184fa71b4be94f262e200f01c6f74c284b0dc6fae6673f',
];

/** URs printed in BCR-2020-005. */
const BCR_2020_SINGLE = [
  { ur: 'ur:seed/oyadgdstaslplabghydrpfmkbggufgludprfgmamdpwmox', cborHex: 'a10150c7098580125e2ab0981253468b2dbc52' },
  { ur: 'ur:seed/oyadhdeynteelblrcygldwvarflojtcywyjytpdkfwprylienshnjnpluypmamtkmybsjkspvseesawmrltdlnlgkplfbkqzzoglfeoyaegslobemohs' }
];
const BCR_2020_MULTI_FIRST = 'ur:seed/1-3/lpadaxcsencylobemohsgmoyadhdeynteelblrcygldwvarflojtcywyjydmylgdsa';

const STREAMS = [
  { name: 'single-small', size: 40, maxFragmentLength: 100 },
  { name: 'single-full', size: 95, maxFragmentLength: 100 },
  { name: 'two-fragments', size: 120, maxFragmentLength: 100 },
  { name: 'seven-fragments', size: 330, maxFragmentLength: 50 },
  { name: 'medium', size: 1000, maxFragmentLength: 100 },
  { name: 'tiny-fragments', size: 120, maxFragmentLength: 10 },
  { name: 'large', size: 5000, maxFragmentLength: 200 }
];

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * Repeatable file bytes (xorshift32), so a rerun gives the same files.
 * @param size Byte count.
 * @param seed Non-zero seed.
 * @returns The bytes.
 */
function fileBytes(size: number, seed: number): Uint8Array {
  let x = seed >>> 0 || 1;
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

function referenceDecode(parts: readonly string[]): { type: string; cborHex: string; partsUsed: number } {
  const decoder = new URDecoder();
  let used = 0;
  for (const part of parts) {
    used++;
    decoder.receivePart(part);
    if (decoder.isComplete()) break;
  }
  if (!decoder.isSuccess()) throw new Error('reference decoder did not finish');
  const ur = decoder.resultUR();
  return { type: ur.type, cborHex: ur.cbor.toString('hex'), partsUsed: used };
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`generate_bcur_vectors: ${message}`);
}

function write(file: string, description: string, body: Record<string, unknown>): void {
  const meta = { description, reference: REFERENCE, script: SCRIPT, generated: new Date().toISOString().slice(0, 10) };
  writeFileSync(join(OUT_DIR, file), `${JSON.stringify({ _meta: meta, ...body }, null, 2)}\n`);
}

mkdirSync(OUT_DIR, { recursive: true });

// 1. Reference streams: pure parts, then as many mixed ones.
const streams = STREAMS.map((spec, index) => {
  const file = fileBytes(spec.size, 0x9e3779b9 + index);
  const reference = new UREncoder(new UR(Buffer.from(cborEncode(file)), 'bytes'), spec.maxFragmentLength);
  const count = reference.fragmentsLength;
  const parts = Array.from({ length: count === 1 ? 1 : count * 2 }, () => reference.nextPart());
  const ours = BcUrEncoder.forBytes(file, spec.maxFragmentLength);
  check(ours.fragmentCount === count, `${spec.name}: fragment count differs`);
  check(parts.every(part => part === ours.nextPart()), `${spec.name}: our encoder differs from the reference`);
  return { name: spec.name, type: 'bytes', fileHex: toHex(file), maxFragmentLength: spec.maxFragmentLength, parts };
});
write('reference-streams.json', 'ur:bytes streams from the reference encoder: the pure parts, then mixed ones.', { vectors: streams });

// 2. Published vectors.
const message = Buffer.from(BCR_2024_MESSAGE, 'hex');
check(getCRC(message) === 0x0167aa07, 'BCR-2024-001 message checksum');
const expected = BCR_2024_PARTS.map((cbor, i) => `ur:bytes/${i + 1}-9/${encodeBytewords(cbor, 'minimal')}`);
const referenceParts = new UREncoder(new UR(message, 'bytes'), 30);
check(expected.every(part => part === referenceParts.nextPart()), 'reference encoder disagrees with BCR-2024-001');
const single = BCR_2020_SINGLE.map(entry => {
  const decoded = referenceDecode([entry.ur]);
  check(!entry.cborHex || entry.cborHex === decoded.cborHex, `BCR-2020-005 ${entry.ur}`);
  return { ur: entry.ur, type: decoded.type, cborHex: decoded.cborHex };
});
const multiDecoder = new URDecoder();
multiDecoder.receivePart(BCR_2020_MULTI_FIRST);
write('published.json', 'Test vectors printed in BCR-2020-005 and BCR-2024-001.', {
  bcr2020005: {
    singlePart: single,
    firstOfMultiPart: { ur: BCR_2020_MULTI_FIRST, type: 'seed', seqLen: multiDecoder.expectedPartCount() }
  },
  bcr2024001: {
    testEncoderCBOR: { messageHex: BCR_2024_MESSAGE, checksum: 0x0167aa07, maxFragmentLength: 30, parts: expected }
  }
});

// 3. Our encoder's output read by the reference decoder, with and without the pure parts.
const crossChecks = STREAMS.filter(spec => spec.size > spec.maxFragmentLength).flatMap((spec, index) => {
  const file = fileBytes(spec.size, 0x51ed270b + index);
  return (['all', 'mixed-only'] as const).map(mode => {
    const encoder = BcUrEncoder.forBytes(file, spec.maxFragmentLength);
    if (mode === 'mixed-only') for (let i = 0; i < encoder.fragmentCount; i++) encoder.nextPart();
    const decoder = new URDecoder();
    const parts: string[] = [];
    while (!decoder.isComplete() && parts.length < encoder.fragmentCount * 10) {
      const part = encoder.nextPart();
      parts.push(part);
      decoder.receivePart(part);
    }
    check(decoder.isSuccess(), `${spec.name} ${mode}: reference decoder failed`);
    check(decoder.resultUR().decodeCBOR().equals(Buffer.from(file)), `${spec.name} ${mode}: reference decoded other bytes`);
    return {
      name: `${spec.name}-${mode}`,
      fileHex: toHex(file),
      maxFragmentLength: spec.maxFragmentLength,
      skipPure: mode === 'mixed-only',
      parts
    };
  });
});
write('ours-decoded-by-reference.json', 'Parts from our encoder that the reference decoder read back to the file, in order.', { vectors: crossChecks });
console.log(`Wrote ${streams.length} streams, the published vectors and ${crossChecks.length} cross-checks to ${OUT_DIR}`);
