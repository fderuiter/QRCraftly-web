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
 * Reed-Solomon over GF(256) (polynomial 0x11d, first root 1) with errors and erasures. It is the
 * inner code of the modem: a decoder that is told which bytes are unreliable (an erasure) spends one
 * parity byte on each, where a byte it has to find for itself costs two.
 *
 * Polynomials are plain number arrays with the highest power first. Everything is integer maths.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const mul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
const div = (a: number, b: number): number => (a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]]);
const inverse = (a: number): number => EXP[255 - LOG[a]];
const powAlpha = (power: number): number => EXP[((power % 255) + 255) % 255];

function polyMul(p: number[], q: number[]): number[] {
  const out = new Array<number>(p.length + q.length - 1).fill(0);
  for (let i = 0; i < p.length; i++) for (let j = 0; j < q.length; j++) out[i + j] ^= mul(p[i], q[j]);
  return out;
}

function polyAdd(p: number[], q: number[]): number[] {
  const out = new Array<number>(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) out[i + out.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) out[i + out.length - q.length] ^= q[i];
  return out;
}

function polyScale(p: number[], factor: number): number[] {
  return p.map((c) => mul(c, factor));
}

function polyEval(p: number[], x: number): number {
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i];
  return y;
}

const generators = new Map<number, number[]>();

function generator(parity: number): number[] {
  let g = generators.get(parity);
  if (!g) {
    g = [1];
    for (let i = 0; i < parity; i++) g = polyMul(g, [1, powAlpha(i)]);
    generators.set(parity, g);
  }
  return g;
}

/**
 * Appends `parity` check bytes to a message.
 * @param message - Up to 255 - parity bytes.
 * @param parity - Check bytes to add.
 * @returns The codeword: the message, then the check bytes.
 */
export function rsEncode(message: Uint8Array, parity: number): Uint8Array {
  const gen = generator(parity);
  const out = new Uint8Array(message.length + parity);
  out.set(message);
  for (let i = 0; i < message.length; i++) {
    const coef = out[i];
    if (coef !== 0) for (let j = 1; j < gen.length; j++) out[i + j] ^= mul(gen[j], coef);
  }
  out.set(message);
  return out;
}

function syndromes(word: ArrayLike<number>, parity: number): number[] {
  const out = [0];
  const poly = Array.from(word);
  for (let i = 0; i < parity; i++) out.push(polyEval(poly, powAlpha(i)));
  return out;
}

function errataLocator(positionsFromEnd: number[]): number[] {
  let loc = [1];
  for (const i of positionsFromEnd) loc = polyMul(loc, polyAdd([1], [powAlpha(i), 0]));
  return loc;
}

function errorEvaluator(synd: number[], loc: number[], parity: number): number[] {
  const product = polyMul(synd, loc);
  const length = parity + 1;
  return product.slice(Math.max(0, product.length - length));
}

function forneySyndromes(synd: number[], erasures: readonly number[], length: number): number[] {
  const fromEnd = erasures.map((p) => length - 1 - p);
  const forney = synd.slice(1);
  for (let i = 0; i < erasures.length; i++) {
    const x = powAlpha(fromEnd[i]);
    for (let j = 0; j < forney.length - 1; j++) forney[j] = mul(forney[j], x) ^ forney[j + 1];
  }
  return forney;
}

function errorLocator(synd: number[], parity: number, erasureCount: number): number[] | null {
  let loc = [1];
  let old = [1];
  for (let i = 0; i < parity - erasureCount; i++) {
    const k = i;
    let delta = synd[k];
    for (let j = 1; j < loc.length; j++) delta ^= mul(loc[loc.length - 1 - j], synd[k - j]);
    old = old.concat([0]);
    if (delta !== 0) {
      if (old.length > loc.length) {
        const next = polyScale(old, delta);
        old = polyScale(loc, inverse(delta));
        loc = next;
      }
      loc = polyAdd(loc, polyScale(old, delta));
    }
  }
  while (loc.length > 0 && loc[0] === 0) loc.shift();
  const errors = loc.length - 1;
  if ((errors - erasureCount) * 2 + erasureCount > parity) return null;
  return loc;
}

function findErrors(loc: number[], length: number): number[] | null {
  const errors = loc.length - 1;
  const positions: number[] = [];
  for (let i = 0; i < length; i++) if (polyEval(loc, powAlpha(i)) === 0) positions.push(length - 1 - i);
  return positions.length === errors ? positions : null;
}

function correctErrata(word: number[], synd: number[], positions: readonly number[]): number[] | null {
  const fromEnd = positions.map((p) => word.length - 1 - p);
  const loc = errataLocator(fromEnd);
  const evaluator = errorEvaluator(synd.slice().reverse(), loc, loc.length - 1).reverse();
  const x = fromEnd.map((c) => powAlpha(c));
  const corrected = word.slice();
  for (let i = 0; i < x.length; i++) {
    const xInv = inverse(x[i]);
    let prime = 1;
    for (let j = 0; j < x.length; j++) if (j !== i) prime = mul(prime, 1 ^ mul(xInv, x[j]));
    if (prime === 0) return null;
    let y = polyEval(evaluator.slice().reverse(), xInv);
    y = mul(x[i], y);
    corrected[positions[i]] ^= div(y, prime);
  }
  return corrected;
}

/** What {@link rsDecode} found. */
export type RsResult = { ok: true; message: Uint8Array; corrected: number } | { ok: false };

/**
 * Decodes a codeword, repairing erasures at known positions and unknown errors.
 * @param codeword - Message plus check bytes, possibly damaged.
 * @param parity - Number of check bytes.
 * @param erasures - Positions (from the start of the codeword) known to be unreliable.
 * @returns The message and the number of bytes repaired, or failure when the damage is beyond the code.
 */
export function rsDecode(codeword: Uint8Array, parity: number, erasures: readonly number[] = []): RsResult {
  if (erasures.length > parity) return { ok: false };
  const word = Array.from(codeword);
  for (const e of erasures) word[e] = 0;
  const synd = syndromes(word, parity);
  const fail: RsResult = { ok: false };
  const pack = (w: number[], corrected: number): RsResult => ({ ok: true, message: Uint8Array.from(w.slice(0, w.length - parity)), corrected });
  if (synd.every((s) => s === 0)) return pack(word, 0);
  const forney = forneySyndromes(synd, erasures, word.length);
  const loc = errorLocator(forney, parity, erasures.length);
  if (!loc) return fail;
  const found = findErrors(loc.slice().reverse(), word.length);
  if (!found) return fail;
  const positions = [...erasures, ...found];
  const fixed = correctErrata(word, synd, positions);
  if (!fixed) return fail;
  if (syndromes(fixed, parity).some((s) => s !== 0)) return fail;
  return pack(fixed, positions.length);
}
