/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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
 * The Foundry differential harness (#1182, ADR 0033): runs a Rust module and the code it replaces
 * on the same inputs and lists every input where they disagree. Node loads the committed `.wasm`
 * the site ships, through the same loader the browser uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileWasmBytes, instantiateWasm, type WasmInstance } from '@/packages/wasm-runtime';
import { createRandom } from '../utils/scannerCorpus';

const WASM_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/wasm');

/** The committed bytes of `src/wasm/<name>.wasm`. */
export function committedModuleBytes(name: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(WASM_DIR, `${name}.wasm`)));
}

/** Compiles and instantiates the committed `src/wasm/<name>.wasm` through the loader. */
export async function loadCommittedModule(name: string): Promise<WasmInstance> {
  return instantiateWasm(await compileWasmBytes(committedModuleBytes(name)));
}

/** Seeded random byte strings, from empty up to `maxLength`, for repeatable differential runs. */
export function* seededBytes(seed: number, count: number, maxLength: number): Generator<Uint8Array> {
  const random = createRandom(seed);
  for (let i = 0; i < count; i++) {
    const bytes = new Uint8Array(i === 0 ? 0 : Math.floor(random() * (maxLength + 1)));
    for (let j = 0; j < bytes.length; j++) bytes[j] = Math.floor(random() * 256);
    yield bytes;
  }
}

export interface DifferentialCase<I, O> {
  /** What is being compared, for the report. */
  name: string;
  inputs: Iterable<I>;
  /** The Rust module. */
  candidate(input: I): O;
  /** The code it would replace. */
  reference(input: I): O;
}

export interface Mismatch {
  input: string;
  candidate: string;
  reference: string;
}

export interface DifferentialReport {
  name: string;
  checked: number;
  /** The first {@link MAX_REPORTED} disagreements. */
  mismatches: Mismatch[];
  /** Every disagreement, including those not listed. */
  mismatchCount: number;
}

const MAX_REPORTED = 10;

function describeValue(value: unknown): string {
  if (value instanceof Uint8Array) {
    const head = Array.from(value.subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${value.length} bytes ${head}${value.length > 16 ? '…' : ''}`;
  }
  if (value instanceof Error) return `throws ${value.message}`;
  return JSON.stringify(value) ?? String(value);
}

function sameOutput(a: unknown, b: unknown): boolean {
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
  }
  if (a instanceof Error && b instanceof Error) return true;
  return Object.is(a, b);
}

/** Runs a function, returning a thrown error as its result so both sides can be compared. */
function settle<I, O>(fn: (input: I) => O, input: I): O | Error {
  try {
    return fn(input);
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Runs both implementations on every input. Throwing counts as an output: both sides throwing
 * agrees, one side throwing is a mismatch.
 */
export function runDifferential<I, O>(test: DifferentialCase<I, O>): DifferentialReport {
  const mismatches: Mismatch[] = [];
  let checked = 0;
  let mismatchCount = 0;
  for (const input of test.inputs) {
    checked++;
    const candidate = settle(test.candidate, input);
    const reference = settle(test.reference, input);
    if (sameOutput(candidate, reference)) continue;
    mismatchCount++;
    if (mismatches.length < MAX_REPORTED) {
      mismatches.push({ input: describeValue(input), candidate: describeValue(candidate), reference: describeValue(reference) });
    }
  }
  return { name: test.name, checked, mismatches, mismatchCount };
}
