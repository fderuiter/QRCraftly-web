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

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_FEC_SOURCE_SYMBOLS, MAX_FEC_SYMBOL_BYTES } from '@/packages/optical-transfer';
import { committedModuleBytes } from './differential';
import { PRISM_FEC_BATTERY_SHA256, decodePrismFecJob, makePrismFecJob, runPrismFecBattery } from './prismFecBattery';

describe('prism-fec module (#1176)', () => {
  it('gives the battery output the browser engines are compared against', async () => {
    const { instance } = await WebAssembly.instantiate(committedModuleBytes('prism-fec'), {});
    const digest = createHash('sha256').update(runPrismFecBattery(instance.exports)).digest('hex');
    // A change to the module that alters this hash changes the symbols on the wire. If that is
    // intended, update PRISM_FEC_BATTERY_SHA256 in tests/foundry/prismFecBattery.ts.
    expect(digest).toBe(PRISM_FEC_BATTERY_SHA256);
  });

  it('decodes, in a fresh instance, the lossy symbols another instance encoded', async () => {
    const bytes = committedModuleBytes('prism-fec');
    const { job, sources } = makePrismFecJob((await WebAssembly.instantiate(bytes, {})).instance.exports);
    const decoded = decodePrismFecJob((await WebAssembly.instantiate(bytes, {})).instance.exports, job);
    const expected = new Uint8Array(sources.reduce((sum, source) => sum + source.length, 0));
    let offset = 0;
    for (const source of sources) {
      expected.set(source, offset);
      offset += source.length;
    }
    expect(decoded).toEqual(expected);
  });

  it('refuses the same sizes as the receive limits', () => {
    const rust = fs.readFileSync(new URL('../../crates/prism-fec/src/code.rs', import.meta.url), 'utf8');
    const constant = (name: string): number => Number(new RegExp(`pub const ${name}: usize = ([0-9_]+);`).exec(rust)?.[1].replaceAll('_', ''));
    expect(constant('MAX_SOURCE_SYMBOLS')).toBe(MAX_FEC_SOURCE_SYMBOLS);
    expect(constant('MAX_SYMBOL_BYTES')).toBe(MAX_FEC_SYMBOL_BYTES);
  });
});
