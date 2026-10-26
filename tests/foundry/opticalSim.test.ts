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
 * The optical print simulation's Rust port (#1556) against the TypeScript it replaces: the same
 * frame and corners must give the same bytes. Inputs are real codes from our encoder (every taps
 * count, tilted, partly off the frame, transparent, coloured) and seeded random pixels.
 */
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createPrintKernel, enablePrintKernel } from '@/packages/scannability/lib/opticalSimKernel';
import { printTaps, simulatePrint, type PixelFrame, type PrintPlacement } from '@/packages/scannability/lib/opticalSimulation';
import { resetPrintKernelForTests, runPrintSimulation } from '@/packages/scannability/lib/printKernel';
import { createRandom } from '../utils/scannerCorpus';
import { qrEncoder } from '../fixtures/qrEncoder';
import { committedModuleBytes, loadCommittedModule, runDifferential } from './differential';
import { OPTICAL_SIM_BATTERY_SHA256, runOpticalSimBattery } from './opticalSimBattery';

interface Case {
  frame: PixelFrame;
  placement: PrintPlacement;
}

/** A code drawn `size` pixels across with a 4-module quiet zone, as the preview holds it. */
function codeCase(version: number, size: number, options: { colour?: [number, number, number]; alpha?: number; tilt?: number; shift?: number } = {}): Case {
  const { modules } = qrEncoder.create('QR', { errorCorrectionLevel: 'M', version });
  const n = modules.size;
  const cell = size / (n + 8);
  const [r, g, b] = options.colour ?? [0, 0, 0];
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / cell - 4);
      const col = Math.floor(x / cell - 4);
      const i = (y * size + x) * 4;
      if (row >= 0 && col >= 0 && row < n && col < n && modules.get(row, col)) {
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
      data[i + 3] = options.alpha ?? 255;
    }
  }
  const lo = 4 * cell + (options.shift ?? 0);
  const hi = (n + 4) * cell + (options.shift ?? 0);
  const t = options.tilt ?? 0;
  return {
    frame: { data, width: size, height: size },
    placement: {
      version,
      corners: [
        { x: lo + t, y: lo },
        { x: hi, y: lo + t },
        { x: hi - t, y: hi },
        { x: lo, y: hi - t },
      ],
    },
  };
}

/** Seeded random RGBA and corners anywhere around the frame, including outside it. */
function* randomCases(seed: number, count: number): Generator<Case> {
  const random = createRandom(seed);
  for (let i = 0; i < count; i++) {
    const width = 8 + Math.floor(random() * 120);
    const height = 8 + Math.floor(random() * 120);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let j = 0; j < data.length; j++) data[j] = Math.floor(random() * 256);
    const point = () => ({ x: random() * width * 1.6 - width * 0.3, y: random() * height * 1.6 - height * 0.3 });
    yield { frame: { data, width, height }, placement: { version: 1 + Math.floor(random() * 6), corners: [point(), point(), point(), point()] } };
  }
}

describe('optical-sim module (#1556)', () => {
  afterEach(() => resetPrintKernelForTests());

  it('matches the TypeScript simulation byte for byte', async () => {
    const simulate = createPrintKernel(await loadCommittedModule('optical-sim'));
    const cases: Case[] = [
      // 1, 2 and 3 taps: the code drawn smaller than, about as large as, and much larger than the simulated frame.
      codeCase(1, 120),
      codeCase(2, 300),
      codeCase(4, 600),
      codeCase(7, 900),
      codeCase(10, 1024),
      codeCase(3, 400, { tilt: 7.25 }),
      codeCase(5, 500, { shift: -30 }),
      codeCase(2, 256, { alpha: 0 }),
      codeCase(2, 256, { alpha: 127 }),
      codeCase(6, 512, { colour: [30, 90, 200] }),
      ...randomCases(1556, 60),
    ];
    expect(new Set(cases.slice(0, 5).map(({ placement }) => printTaps(placement)))).toEqual(new Set([1, 2, 3]));
    const report = runDifferential({
      name: 'simulate_print',
      inputs: cases,
      candidate: ({ frame, placement }) => new Uint8Array(simulate(frame, placement).data),
      reference: ({ frame, placement }) => new Uint8Array(simulatePrint(frame, placement).data),
    });
    expect(report.mismatches.map((m) => m.input)).toEqual([]);
    expect(report).toMatchObject({ checked: cases.length, mismatchCount: 0 });
  });

  it('reuses the scratch frame and ignores pixels past width × height', async () => {
    const simulate = createPrintKernel(await loadCommittedModule('optical-sim'));
    const { frame, placement } = codeCase(2, 300);
    const scratch = {};
    const first = simulate(frame, placement, scratch);
    const padded = new Uint8ClampedArray(frame.data.length + 64).fill(7);
    padded.set(frame.data);
    const second = simulate({ data: padded, width: frame.width, height: frame.height }, placement, scratch);
    expect(second.data).toBe(first.data);
    expect(Array.from(second.data)).toEqual(Array.from(simulatePrint(frame, placement).data));
  });

  it('refuses a version outside 1 to 40', async () => {
    const simulate = createPrintKernel(await loadCommittedModule('optical-sim'));
    const { frame, placement } = codeCase(1, 120);
    expect(() => simulate(frame, { ...placement, version: 41 })).toThrow(/version 41/);
    expect(() => simulate(frame, { ...placement, version: 0 })).toThrow(/version 0/);
  });

  it('is what the check runs once enabled, with the same output', async () => {
    const { frame, placement } = codeCase(3, 400, { tilt: 3 });
    const before = Array.from(runPrintSimulation(frame, placement).data);
    await expect(enablePrintKernel()).resolves.toBe(true);
    expect(Array.from(runPrintSimulation(frame, placement).data)).toEqual(before);
  });
});

describe('the optical-sim battery (#1556)', () => {
  it('gives the pinned output in Node, the reference every browser engine is compared with', async () => {
    const instance = await WebAssembly.instantiate(committedModuleBytes('optical-sim'), {});
    const digest = createHash('sha256').update(runOpticalSimBattery(instance.instance.exports)).digest('hex');
    // A change to the module that alters this hash changes its behaviour. If that is intended,
    // update OPTICAL_SIM_BATTERY_SHA256 in tests/foundry/opticalSimBattery.ts.
    expect(digest).toBe(OPTICAL_SIM_BATTERY_SHA256);
  });
});
