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

import { crc32 } from '@/packages/core/checksum';

/**
 * Bytewords (BCR-2020-012): the canonical 256 four-letter words. The
 * "minimal" encoding used inside `ur:` URIs keeps only the first and last
 * letter of each word, so every byte becomes two letters.
 */
const WORDS =
  'able acid also apex aqua arch atom aunt away axis back bald barn belt beta bias blue body brag brew bulb buzz ' +
  'calm cash cats chef city claw code cola cook cost crux curl cusp cyan dark data days deli dice diet door down ' +
  'draw drop drum dull duty each easy echo edge epic even exam exit eyes fact fair fern figs film fish fizz flap ' +
  'flew flux foxy free frog fuel fund gala game gear gems gift girl glow good gray grim guru gush gyro half hang ' +
  'hard hawk heat help high hill holy hope horn huts iced idea idle inch inky into iris iron item jade jazz join ' +
  'jolt jowl judo jugs jump junk jury keep keno kept keys kick kiln king kite kiwi knob lamb lava lazy leaf legs ' +
  'liar limp lion list logo loud love luau luck lung main many math maze memo menu meow mild mint miss monk nail ' +
  'navy need news next noon note numb obey oboe omit onyx open oval owls paid part peck play plus poem pool pose ' +
  'puff puma purr quad quiz race ramp real redo rich road rock roof ruby ruin runs rust safe saga scar sets silk ' +
  'skew slot soap solo song stub surf swan taco task taxi tent tied time tiny toil tomb toys trip tuna twin ugly ' +
  'undo unit urge user vast very veto vial vibe view visa void vows wall wand warm wasp wave waxy webs what when ' +
  'whiz wolf work yank yawn yell yoga yurt zaps zero zest zinc zone zoom';

const MINIMAL: readonly string[] = WORDS.split(' ').map(w => w[0] + w[3]);
const MINIMAL_LOOKUP: ReadonlyMap<string, number> = new Map(MINIMAL.map((m, i) => [m, i]));

function appendCrc(bytes: Uint8Array): Uint8Array {
  const checksum = crc32(bytes);
  const out = new Uint8Array(bytes.length + 4);
  out.set(bytes, 0);
  out[bytes.length] = (checksum >>> 24) & 0xff;
  out[bytes.length + 1] = (checksum >>> 16) & 0xff;
  out[bytes.length + 2] = (checksum >>> 8) & 0xff;
  out[bytes.length + 3] = checksum & 0xff;
  return out;
}

/**
 * Encodes bytes as minimal Bytewords with the trailing big-endian CRC-32.
 * @param bytes Payload bytes.
 * @returns Lowercase minimal Bytewords string (2 letters per byte).
 */
export function encodeBytewordsMinimal(bytes: Uint8Array): string {
  const withCrc = appendCrc(bytes);
  let out = '';
  for (let i = 0; i < withCrc.length; i++) {
    out += MINIMAL[withCrc[i]];
  }
  return out;
}

/**
 * Decodes a minimal Bytewords string (case-insensitive) and verifies its CRC-32.
 * @param text Minimal Bytewords string.
 * @returns The payload bytes without the checksum, or null if invalid.
 */
export function decodeBytewordsMinimal(text: string): Uint8Array | null {
  if (text.length % 2 !== 0 || text.length < 10) return null;
  const lower = text.toLowerCase();
  const bytes = new Uint8Array(lower.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const value = MINIMAL_LOOKUP.get(lower.slice(i * 2, i * 2 + 2));
    if (value === undefined) return null;
    bytes[i] = value;
  }
  const body = bytes.subarray(0, bytes.length - 4);
  const expected =
    ((bytes[bytes.length - 4] << 24) |
      (bytes[bytes.length - 3] << 16) |
      (bytes[bytes.length - 2] << 8) |
      bytes[bytes.length - 1]) >>>
    0;
  if (crc32(body) !== expected) return null;
  return body.slice();
}
