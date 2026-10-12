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
 * Fiducial search benchmark (#1161, ADR 0047): `pnpm run bench:optical-finder [options]`.
 *
 * Runs the whole-image acquisition (`acquireFrame`, the search a receiver runs to lock on) over
 * the sets in `src/packages/optical-modem/tests/acquisitionSet.ts` and prints:
 *
 * - **positives**: frames of the shipped 4-colour profiles and of the high-rate grids in black and
 *   white, with 15% to 25% keystone at 2.5 to 3 camera pixels per cell. Acquired (and by the
 *   whole-image search alone), the header read back, why the others failed, and the median time;
 * - **negatives**: pictures with no frame a receiver may read; any acquisition is a false one;
 * - **timing**: the whole-image search alone and with the strict search after it, on large
 *   captures and on pixel noise. A module without the strict search ignores `strict: false`.
 *
 * Options:
 *
 *   --module <file.wasm>  Load this modem module instead of `src/wasm/modem.wasm`, to compare
 *                         a build from another commit (`git show <ref>:src/wasm/modem.wasm`).
 *   --set dev|held-out    Which positive captures (default held-out). Tune on dev only.
 *   --count <n>           Positive captures per profile (default 20).
 *   --negatives <n>       Negative pictures (default 270).
 *   --only <section>      positives, negatives or timing.
 *
 * Captures are simulated and times are this machine's, single threaded; nothing here was
 * measured on a phone.
 */
import fs from 'node:fs';
import { HIGH_RATE_PROFILES, acquireFrame, constellationId, encodeModemFrame, frameCapacity, loadOpticalModem, simulateCapture, type ModemProfile, type RgbaImage } from '../src/packages/optical-modem/index.ts';
import {
  DEV_SEED,
  HELD_OUT_SEED,
  MONOCHROME_LARGE,
  SET_GEOMETRIES,
  SET_SESSION,
  SHIPPED_FOUR_COLOUR,
  captureCase,
  caseSeq,
  foundAll,
  negativeCases,
  profileCases,
} from '../src/packages/optical-modem/tests/acquisitionSet.ts';

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const modulePath = option('module');
const setName = option('set') ?? 'held-out';
const count = Number(option('count') ?? 20);
const negatives = Number(option('negatives') ?? 270);
const only = option('only');

await loadOpticalModem(modulePath ? new Uint8Array(fs.readFileSync(modulePath)) : undefined);
console.log(`module: ${modulePath ?? 'src/wasm/modem.wasm'}`);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : NaN;
}

function timed<T>(run: () => T): [T, number] {
  const t0 = performance.now();
  const result = run();
  return [result, performance.now() - t0];
}

if (!only || only === 'positives') {
  const seed = setName === 'dev' ? DEV_SEED : HELD_OUT_SEED;
  console.log(`\npositives (${setName} set, ${count} per profile; located: all four centres within a cell of the truth)`);
  for (const [group, profiles] of [
    ['shipped 4-colour', SHIPPED_FOUR_COLOUR],
    ['monochrome large', MONOCHROME_LARGE],
  ] as const) {
    let ok = 0;
    let total = 0;
    for (const profile of profiles) {
      const cases = profileCases(profile, count, seed);
      const tally: Record<string, number> = {};
      const bands = [
        { name: '2.5-2.75 px', ok: 0, n: 0 },
        { name: '2.75-3 px', ok: 0, n: 0 },
      ];
      const times: number[] = [];
      let located = 0;
      let whole = 0;
      for (const c of cases) {
        const { image, fiducials } = captureCase(c);
        if (acquireFrame(image, SET_GEOMETRIES, { strict: false }).ok) whole++;
        const [result, ms] = timed(() => acquireFrame(image, SET_GEOMETRIES));
        times.push(ms);
        const right = result.ok && result.frame.header.seq === caseSeq(c) && result.frame.header.session === SET_SESSION && result.frame.cols === profile.cols;
        if (result.ok && foundAll(result.fiducials.points, fiducials, c.pixelsPerCell)) located++;
        const key = right ? 'ok' : result.ok ? 'wrong' : result.reason;
        tally[key] = (tally[key] ?? 0) + 1;
        const band = bands[c.pixelsPerCell < 2.75 ? 0 : 1];
        band.n++;
        if (right) band.ok++;
      }
      ok += tally.ok ?? 0;
      total += cases.length;
      const byBand = bands.map((b) => `${b.name} ${b.ok}/${b.n}`).join(', ');
      console.log(`  ${profile.name.padEnd(12)} ${profile.cols}x${profile.rows}: ${tally.ok ?? 0}/${cases.length} acquired (${byBand}; whole-image search alone ${whole}), ${located} located, median ${median(times).toFixed(0)} ms ${JSON.stringify(tally)}`);
    }
    console.log(`  ${group}: ${ok}/${total} (${((100 * ok) / total).toFixed(1)}%)`);
  }
}

if (!only || only === 'negatives') {
  console.log(`\nnegatives (${negatives} pictures)`);
  const sizes = [
    [960, 540],
    [1920, 1080],
  ] as const;
  const tally: Record<string, { n: number; acquired: number; ms: number[] }> = {};
  for (const { kind, image } of negativeCases(negatives, HELD_OUT_SEED + 1, sizes)) {
    const [result, ms] = timed(() => acquireFrame(image, SET_GEOMETRIES));
    const entry = (tally[kind] ??= { n: 0, acquired: 0, ms: [] });
    entry.n++;
    entry.ms.push(ms);
    if (result.ok) entry.acquired++;
  }
  let acquired = 0;
  for (const [kind, { n, acquired: a, ms }] of Object.entries(tally)) {
    acquired += a;
    console.log(`  ${kind.padEnd(18)} ${a}/${n} acquired, median ${median(ms).toFixed(0)} ms, max ${Math.max(...ms).toFixed(0)} ms`);
  }
  console.log(`  false acquisitions: ${acquired}/${negatives}`);
}

if (!only || only === 'timing') {
  console.log('\ntiming (median of 3 runs, 1 for noise): the whole-image search alone, then with the strict search after it');
  const ultra = HIGH_RATE_PROFILES[1];
  const wide = HIGH_RATE_PROFILES[0];
  const frameOf = (profile: ModemProfile, seq: number): RgbaImage => {
    const payload = Uint8Array.from({ length: frameCapacity(profile).payloadBytes }, (_, i) => (i * 31 + seq * 7) & 255);
    return encodeModemFrame(profile, payload, SET_SESSION, seq, 2);
  };
  const noise = (width: number, height: number): RgbaImage => {
    const data = new Uint8ClampedArray(width * height * 4);
    let state = 12345;
    for (let i = 0; i < data.length; i++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      data[i] = i % 4 === 3 ? 255 : state >>> 24;
    }
    return { width, height, data };
  };
  const images: [string, RgbaImage][] = [
    ['P6 Wide 4-colour, 1080p-class, typical', simulateCapture(frameOf(wide, 1), 'typical', { pixelsPerCell: 4.2, cellPitch: 2, seed: 1 })],
    ['P7 Ultra 4-colour, 4K-class, typical', simulateCapture(frameOf(ultra, 1), 'typical', { pixelsPerCell: 4.2, cellPitch: 2, seed: 1 })],
    ['P7 Ultra mono, 4K-class, typical', simulateCapture(frameOf({ ...ultra, constellation: constellationId(2, 'oklab') }, 1), 'typical', { pixelsPerCell: 4.2, cellPitch: 2, seed: 1 })],
    ['pixel noise 1920 x 1080', noise(1920, 1080)],
    ['pixel noise 3840 x 2160', noise(3840, 2160)],
  ];
  for (const [name, image] of images) {
    const repeats = name.startsWith('pixel noise') ? [0] : [0, 1, 2];
    const whole = repeats.map(() => timed(() => acquireFrame(image, SET_GEOMETRIES, { strict: false })));
    const runs = repeats.map(() => timed(() => acquireFrame(image, SET_GEOMETRIES)));
    const result = runs[0][0];
    console.log(`  ${name.padEnd(42)} ${median(whole.map((r) => r[1])).toFixed(0)} ms, then ${median(runs.map((r) => r[1])).toFixed(0)} ms, ${result.ok ? 'acquired' : result.reason}`);
  }
}
