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
 * Differential test of the optical modem module (#1198) against the TypeScript kernels it replaced:
 * `rs.ts`, `codec.ts`, `locate.ts`, `sample.ts`, `constellation.ts`, `probeAnalysis.ts` and the
 * colour layer's `crosstalk.ts`.
 *
 * `tests/fixtures/modem-golden.json.gz` holds what those kernels returned for every input in
 * `modemCorpus.ts`, recorded once before they were removed: 3,000 Reed-Solomon cases (a quarter
 * of them past the code's bound), 400 homographies, every constellation id, 13 probe runs, 200
 * mutual informations, 300 cross-talk fits, 50 channel splits and a calibrator run. Each output is
 * kept whole or as an FNV-1a hash.
 *
 * The simulation corpus (27 frames of the three profiles in the three channels, at easy and hard
 * camera cell sizes, with a thinner code, turned and torn captures) is no longer compared with a
 * recording: since every block carries an identity-bound tag (#1240, ADR 0043), the module draws
 * different frames from the ones `codec.ts` drew, and the recorded frames were dropped from the
 * fixture. The corpus still runs, decoded hard, soft and with a high erasure threshold, and every
 * block the module returns must be the block that was sent. The probe runs exercise the same
 * fiducial search and sampling against the recording.
 *
 * Tolerance: none. The integer kernels (Reed-Solomon, the codec, fiducial search, sampling,
 * classification) must match bit for bit, and so must the floating-point ones (homography,
 * constellation design, OKLab, the probe statistics, the edge's Fourier transform, the logarithm,
 * the cross-talk fit): the module does the same IEEE operations in the same order, and uses fdlibm
 * ports for `sin`, `cos` and `log2`, the functions V8 uses. Every number below is compared with
 * `toEqual` after a JSON round trip, which is exact for doubles.
 *
 * One deliberate difference: past the Reed-Solomon bound (2 x errors + erasures > check bytes),
 * `rs.ts` accepted some corrections the bound rules out, and all of them were wrong. The module
 * uses the shared decoder in `crates/core`, which refuses them. Within the bound every one of the
 * 2,250 cases is identical; past it the module agrees with `rs.ts` or refuses a wrong answer
 * `rs.ts` gave, never the other way round. The count is pinned below.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MODEM_PROFILES,
  ProbeRun,
  decodeModemFrame,
  drawProbeFrame,
  encodeModemFrame,
  frameCapacity,
  getConstellation,
  loadOpticalModem,
  probeSequence,
  simulateCapture,
  type ProbeReport,
  type RgbaImage,
} from '@/packages/optical-modem';
import { ColourCalibrator, fitCrossTalk, loadCrossTalkKernels, splitChannels, type CrossTalkModel, type Rgb } from '@/packages/optical-transfer';
import type { WasmInstance } from '@/packages/wasm-runtime';
import { committedModuleBytes, loadCommittedModule } from './differential';
import { MODEM_BATTERY_SHA256, runModemBattery } from './modemBattery';
import {
  CORPUS_SESSION,
  PROBE_RUN_FRAMES,
  confusionMatrices,
  crosstalkPatches,
  damage,
  fnv1a,
  framePayload,
  frameSpecs,
  homographyCases,
  probeSpecs,
  rotate,
  rsCases,
  splitImage,
} from './modemCorpus';

/**
 * Reed-Solomon cases past the bound where `rs.ts` returned wrong bytes and the module refuses.
 * `rs.ts` checked its error locator against the bound with the erasures counted twice over, so it
 * let some locators through that the bound rules out (#1198); every one of them was a
 * miscorrection. The module never decodes a case `rs.ts` refused.
 */
const KNOWN_REFUSED_MISCORRECTIONS = 22;
/**
 * Over the simulation corpus decoded hard, soft and with a high erasure threshold: the blocks of the
 * readable frames, those repaired, and those whose tag refused the code's first repair (each of
 * which the decoder without the tag passed on wrong).
 */
const KNOWN_FRAME_TOTALS = { blocks: 1440, blocksOk: 779, refused: 249 };

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/modem-golden.json.gz');

interface Golden {
  rs: Array<[string, [number, string] | null]>;
  homography: Array<number[] | null>;
  constellations: Record<string, { symbols: number[][]; minDistance: number } | null>;
  probe: Array<{ index: number; seen: Array<number | null>; report: unknown }>;
  mutualInformation: number[];
  crosstalk: { fits: unknown[]; splits: string[][]; calibration: unknown };
}

const golden = JSON.parse(zlib.gunzipSync(fs.readFileSync(FIXTURE)).toString('utf8')) as Golden;

/** Values as the fixture stores them: NaN and infinities become null, typed arrays plain arrays. */
const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value) ?? 'null');

const IO_OUT = 72;
const IO_IN = 128;

let raw: WasmInstance;
let rx: number;
const io = (): Float64Array => new Float64Array(raw.memory.buffer, raw.fn('modem_rx_io')(rx), 256);
const input = (length: number): Uint8Array => new Uint8Array(raw.memory.buffer, raw.fn('modem_rx_input')(rx, length), length);
const output = (length: number): Uint8Array => new Uint8Array(raw.memory.buffer, raw.fn('modem_rx_output')(rx), length).slice();

function reportOf(report: ProbeReport): unknown {
  const strip = <T extends { pattern: { index: number } }>(list: T[]): unknown[] => list.map((r) => ({ ...r, pattern: r.pattern.index }));
  return json({ ...report, grids: strip(report.grids), flicker: strip(report.flicker), edges: strip(report.edges) });
}

describe('optical modem module against the TypeScript kernels it replaced (#1198)', () => {
  beforeAll(async () => {
    await loadOpticalModem();
    await loadCrossTalkKernels();
    raw = await loadCommittedModule('modem');
    rx = raw.fn('modem_rx_new')();
  });

  it('encodes and decodes Reed-Solomon codewords as rs.ts did', () => {
    const cases = rsCases();
    expect(golden.rs).toHaveLength(cases.length);
    const mismatches: number[] = [];
    let refused = 0;
    cases.forEach((c, i) => {
      input(c.message.length).set(c.message);
      expect(raw.fn('modem_rs_encode')(rx, c.parity)).toBe(0);
      const word = output(c.message.length + c.parity);
      const damaged = damage(word, c);
      const into = input(damaged.length + c.erasures.length);
      into.set(damaged);
      into.set(c.erasures, damaged.length);
      const repaired = raw.fn('modem_rs_decode')(rx, damaged.length, c.parity);
      const result: [number, string] | null = repaired < 0 ? null : [repaired, fnv1a(output(c.message.length))];
      const want = golden.rs[i][1];
      if (fnv1a(word) !== golden.rs[i][0]) mismatches.push(i);
      else if (JSON.stringify(result) === JSON.stringify(want)) return;
      // Past the bound rs.ts let some wrong corrections through; the module refuses them.
      else if (result === null && want !== null && want[1] !== fnv1a(c.message) && 2 * c.errors.length + c.erasures.length > c.parity) refused++;
      else mismatches.push(i);
    });
    expect(mismatches).toEqual([]);
    expect(refused).toBe(KNOWN_REFUSED_MISCORRECTIONS);
  });

  it('solves homographies as locate.ts did', () => {
    const results = homographyCases().map(({ source, target }) => {
      const block = io();
      source.forEach(([u, v], i) => block.set([u, v], IO_IN + 2 * i));
      target.forEach(({ x, y }, i) => block.set([x, y], IO_IN + 8 + 2 * i));
      return raw.fn('modem_homography')(rx) ? Array.from(io().subarray(IO_OUT, IO_OUT + 9)) : null;
    });
    expect(json(results)).toEqual(golden.homography);
  });

  it('designs the constellations constellation.ts designed', () => {
    for (let id = 0; id < 32; id++) {
      let result: unknown = null;
      try {
        const k = getConstellation(id);
        result = { symbols: k.symbols, minDistance: k.minDistance };
      } catch {
        result = null;
      }
      expect(json(result), `constellation ${id}`).toEqual(golden.constellations[id]);
    }
  });

  // One test per profile and per probe run: under CI's coverage instrumentation the simulated
  // captures are slow, and a single test over the whole corpus ran past its timeout.
  const frameTotals = { blocks: 0, blocksOk: 0, refused: 0 };
  const frameCorpus = frameSpecs();
  it.each([0, 1, 2])('decodes profile %i of the simulation corpus without a wrong block', (profile) => {
    frameCorpus.forEach((spec, i) => {
      if (spec.profile !== profile) return;
      const base = MODEM_PROFILES[spec.profile];
      const shape = { ...base, parity: base.parity - spec.parityShift, packetBytes: base.packetBytes + spec.parityShift };
      const capacity = frameCapacity(shape);
      const payload = framePayload(capacity.payloadBytes, spec.seed);
      const sent = encodeModemFrame(shape, payload, CORPUS_SESSION, spec.seed, 4);
      const next = spec.torn ? encodeModemFrame(shape, framePayload(capacity.payloadBytes, spec.seed + 1000), CORPUS_SESSION, spec.seed + 1, 4) : undefined;
      const capture = rotate(simulateCapture(sent, spec.preset, { pixelsPerCell: spec.pixelsPerCell, cellPitch: 4, seed: spec.seed, next }), spec.turns);
      const geometries = spec.turns ? MODEM_PROFILES : [shape];
      for (const options of [{ geometries, soft: false }, { geometries }, { geometries, threshold: 96 }]) {
        const decoded = decodeModemFrame(capture, options);
        if (!decoded.ok) continue;
        frameTotals.blocks += decoded.blocks.length;
        frameTotals.blocksOk += decoded.blocksOk;
        frameTotals.refused += decoded.refused;
        decoded.blocks.forEach((block, b) => {
          if (block) expect(fnv1a(block), `frame ${i} block ${b}`).toBe(fnv1a(payload.subarray(b * shape.packetBytes, (b + 1) * shape.packetBytes)));
        });
      }
    });
  }, 120_000);

  it('repairs and refuses the pinned number of blocks over the simulation corpus', () => {
    expect(frameTotals).toEqual(KNOWN_FRAME_TOTALS);
  });

  const probeCorpus = probeSpecs().map((spec, i) => ({ spec, i }));

  it('has a recorded probe report for every probe run, plus a foreign frame', () => {
    expect(golden.probe).toHaveLength(probeCorpus.length + 1);
  });

  it.each(probeCorpus)('gives the probe report probeAnalysis.ts gave for probe run $i', ({ spec, i }) => {
    const sequence = probeSequence();
    const blank: RgbaImage = { width: 320, height: 200, data: new Uint8ClampedArray(320 * 200 * 4).fill(200) };
    const pattern = sequence.filter((p) => p.kind === spec.kind && p.pitch === spec.pitch)[spec.nth];
    const run = new ProbeRun({ device: 'corpus', mode: 'propped', direction: 'simulated', camera: { width: 1920, height: 1080, frameRate: 60, deliveredFps: 30 } });
    const seen: Array<number | null> = [];
    for (let c = 0; c < PROBE_RUN_FRAMES; c++) {
      const counter = c * 2;
      const next = c === PROBE_RUN_FRAMES - 1 ? drawProbeFrame(pattern, CORPUS_SESSION, counter + 1) : undefined;
      const capture = simulateCapture(drawProbeFrame(pattern, CORPUS_SESSION, counter), spec.preset, { pixelsPerCell: spec.cameraPx, cellPitch: pattern.pitch, seed: c + 1, next });
      seen.push(run.ingest(capture, (counter * 1000) / 60));
    }
    if (spec.blank) seen.push(run.ingest(blank, 999));
    expect({ index: pattern.index, seen, report: reportOf(run.report()) }).toEqual(golden.probe[i]);
  }, 120_000);

  it('gives the probe report probeAnalysis.ts gave for a frame from another stream', () => {
    const foreign = new ProbeRun({ device: 'corpus', mode: 'handheld', direction: 'simulated' });
    const shape = { ...MODEM_PROFILES[0], cols: 120, rows: 67 };
    const capture = simulateCapture(encodeModemFrame(shape, new Uint8Array(4), 1, 1, 8), 'studio', { pixelsPerCell: 5, cellPitch: 8, seed: 1 });
    const run = { index: -1, seen: [foreign.ingest(capture, 0)], report: reportOf(foreign.report()) };
    expect(run).toEqual(golden.probe[probeCorpus.length]);
  }, 120_000);

  it('estimates mutual information as probeAnalysis.ts did', () => {
    const results = confusionMatrices().map((matrix) => {
      const size = matrix.length;
      const state = Float64Array.from([0, 0, ...matrix.flat()]);
      const ptr = raw.fn('modem_rx_state')(rx, state.length);
      new Float64Array(raw.memory.buffer, ptr, state.length).set(state);
      return raw.fn('modem_probe_mutual_information')(rx, size);
    });
    expect(results).toEqual(golden.mutualInformation);
  });

  it('fits, splits and follows the colour model as crosstalk.ts did', () => {
    const patches = crosstalkPatches();
    const fits = patches.map((patch) => fitCrossTalk(patch));
    expect(json(fits)).toEqual(golden.crosstalk.fits);
    const models = fits.filter((fit): fit is CrossTalkModel => fit !== null);
    const image = splitImage(0x5011, 37, 23);
    const splits: string[][] = [];
    for (const model of [null, ...models.slice(0, 24)]) {
      for (const region of [null, { x: 3, y: 2, width: 20, height: 9 }]) splits.push(splitChannels(image, region, model).map((p) => fnv1a(p.data)));
    }
    expect(splits).toEqual(golden.crosstalk.splits);
    const calibrator = new ColourCalibrator();
    const events: unknown[] = [];
    patches.forEach((patch, i) => {
      events.push(calibrator.update(patch));
      const model = calibrator.model;
      if (model) {
        const factor = [1.02, 1.08, 0.93, 1.5, 0.6, 1.2][i % 6];
        const white: Rgb = [model.white[0] * factor, model.white[1], model.white[2] / factor];
        events.push(calibrator.observeWhite(white));
      }
    });
    const calibration = { events, model: calibrator.model, fits: calibrator.fits, driftRefits: calibrator.driftRefits, rejects: calibrator.rejects, rescales: calibrator.rescales };
    expect(json(calibration)).toEqual(golden.crosstalk.calibration);
  });
});

describe('modem module battery (#1198)', () => {
  it('gives the battery output the browser engines are compared against', async () => {
    const { instance } = await WebAssembly.instantiate(committedModuleBytes('modem'), {});
    const digest = createHash('sha256').update(runModemBattery(instance.exports)).digest('hex');
    // A change to the module that alters this hash changes what a receiver reads. If that is
    // intended, update MODEM_BATTERY_SHA256 in tests/foundry/modemBattery.ts.
    expect(digest).toBe(MODEM_BATTERY_SHA256);
  });
});
