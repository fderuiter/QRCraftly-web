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

// Punycode (RFC 3492) parameters.
const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;
const MAX_CODE_POINT = 0x10ffff;

function adapt(delta: number, numPoints: number, firstTime: boolean): number {
  let d = firstTime ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > ((BASE - T_MIN) * T_MAX) / 2) {
    d = Math.floor(d / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * d) / (d + SKEW));
}

function digitValue(codePoint: number): number {
  if (codePoint >= 0x30 && codePoint <= 0x39) return codePoint - 22; // 0-9 are 26-35
  if (codePoint >= 0x41 && codePoint <= 0x5a) return codePoint - 0x41; // A-Z
  if (codePoint >= 0x61 && codePoint <= 0x7a) return codePoint - 0x61; // a-z
  return BASE;
}

/**
 * Decodes one Punycode label (the part after `xn--`).
 * @param input - The encoded label, without the `xn--` prefix.
 * @returns The Unicode label, or null when the input is not valid Punycode.
 */
export function decodePunycodeLabel(input: string): string | null {
  const output: number[] = [];
  const delimiter = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(delimiter, 0); j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) return null;
    output.push(code);
  }
  let n = INITIAL_N;
  let i = 0;
  let bias = INITIAL_BIAS;
  let index = delimiter > 0 ? delimiter + 1 : 0;
  while (index < input.length) {
    const oldI = i;
    let weight = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) return null;
      const digit = digitValue(input.charCodeAt(index++));
      if (digit >= BASE || digit > Math.floor((Number.MAX_SAFE_INTEGER - i) / weight)) return null;
      i += digit * weight;
      const threshold = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < threshold) break;
      weight *= BASE - threshold;
    }
    const length = output.length + 1;
    bias = adapt(i - oldI, length, oldI === 0);
    n += Math.floor(i / length);
    i %= length;
    if (n > MAX_CODE_POINT) return null;
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

/**
 * Turns an ASCII hostname into what a person reads: every `xn--` label decoded to Unicode.
 * A label that is not valid Punycode is left as it is.
 * @param host - The hostname, as `URL.hostname` gives it.
 * @returns The readable hostname.
 */
export function toUnicodeHostname(host: string): string {
  return host
    .split('.')
    .map((label) => {
      if (!label.toLowerCase().startsWith('xn--')) return label;
      return decodePunycodeLabel(label.slice(4)) ?? label;
    })
    .join('.');
}

/** Scripts whose letters can be confused with each other in a hostname. */
const SCRIPTS: readonly (readonly [name: string, pattern: RegExp])[] = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
];

/** Script mixes that are normal in one language (Japanese, Korean), so they are not flagged. */
const EAST_ASIAN = new Set(['Han', 'Hiragana', 'Katakana', 'Hangul', 'Latin']);

function scriptsOf(label: string): Set<string> {
  const found = new Set<string>();
  for (const char of label) {
    const script = SCRIPTS.find(([, pattern]) => pattern.test(char));
    if (script) found.add(script[0]);
  }
  return found;
}

/**
 * Whether any label of a hostname mixes letters from different scripts, such as a Cyrillic
 * "а" inside an otherwise Latin name: the usual sign of a lookalike address.
 * @param unicodeHost - The readable hostname (see `toUnicodeHostname`).
 * @returns True when a label mixes scripts.
 */
export function hasMixedScripts(unicodeHost: string): boolean {
  return unicodeHost.split('.').some((label) => {
    const scripts = scriptsOf(label);
    return scripts.size > 1 && ![...scripts].every((script) => EAST_ASIAN.has(script));
  });
}
