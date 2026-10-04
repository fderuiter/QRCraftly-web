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

import { crc32 } from '../fountain/crc32';
import { cborEncode } from '../fountain/cbor';
import { FragmentChooser } from './schedule';
import { encodeSingleUr, encodeUrPart } from './uri';

const TYPE_PATTERN = /^[a-z0-9-]+$/;

/**
 * Emits real BCR-2024-001 multipart URs (`ur:<type>/<seq>-<n>/<bytewords>`) that
 * wallets and `@ngraveio/bc-ur` can reassemble. Output is lowercase; uppercase it
 * before QR encoding to use the denser alphanumeric mode.
 */
export class BcUrEncoder {
  private readonly fragments: Uint8Array[] = [];
  private readonly fragmentLength: number;
  private readonly checksum: number;
  private readonly chooser: FragmentChooser;
  private seqNum = 0;

  /**
   * @param type UR type, lowercase letters, digits and hyphens.
   * @param cbor The complete CBOR payload of the UR (for `ur:bytes`, a CBOR byte string).
   * @param maxFragmentLength Largest fragment, in payload bytes (reference default 100).
   */
  constructor(
    private readonly type: string,
    private readonly cbor: Uint8Array,
    maxFragmentLength = 100
  ) {
    if (!TYPE_PATTERN.test(type)) throw new RangeError('BC-UR: invalid type');
    if (cbor.length < 1) throw new RangeError('BC-UR: empty payload');
    if (!Number.isInteger(maxFragmentLength) || maxFragmentLength < 1) throw new RangeError('BC-UR: invalid fragment length');
    const count = Math.ceil(cbor.length / maxFragmentLength);
    this.fragmentLength = Math.ceil(cbor.length / count);
    for (let i = 0; i < count; i++) {
      const fragment = new Uint8Array(this.fragmentLength);
      fragment.set(cbor.subarray(i * this.fragmentLength, (i + 1) * this.fragmentLength));
      this.fragments.push(fragment);
    }
    this.checksum = crc32(cbor);
    this.chooser = new FragmentChooser(count);
  }

  /**
   * Wraps file bytes as a `ur:bytes` payload (a CBOR byte string).
   * @param bytes The file bytes.
   * @param maxFragmentLength Largest fragment, in payload bytes.
   * @returns An encoder for the `bytes` type.
   */
  public static forBytes(bytes: Uint8Array, maxFragmentLength = 100): BcUrEncoder {
    return new BcUrEncoder('bytes', cborEncode(bytes), maxFragmentLength);
  }

  /** Number of pure fragments; a receiver needs at least this many parts. */
  public get fragmentCount(): number {
    return this.fragments.length;
  }

  /** True when the payload fits one fragment; `nextPart` then repeats the single-part UR. */
  public get isSinglePart(): boolean {
    return this.fragments.length === 1;
  }

  /** @returns The next part. Parts 1..fragmentCount are pure; later ones are mixed, indefinitely. */
  public nextPart(): string {
    if (this.isSinglePart) return encodeSingleUr(this.type, this.cbor);
    this.seqNum = (this.seqNum + 1) >>> 0;
    const data = new Uint8Array(this.fragmentLength);
    for (const index of this.chooser.indexesFor(this.seqNum, this.checksum)) {
      const fragment = this.fragments[index];
      for (let i = 0; i < data.length; i++) data[i] ^= fragment[i];
    }
    return encodeUrPart(this.type, {
      seqNum: this.seqNum,
      seqLen: this.fragments.length,
      messageLen: this.cbor.length,
      checksum: this.checksum,
      data,
    });
  }
}
