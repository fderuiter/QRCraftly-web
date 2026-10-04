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
 * Optical modem benchmark (#1161): `pnpm run bench:optical [options]`.
 *
 * Everything here comes from the channel simulator in `src/packages/optical-modem`, which models a
 * phone camera (perspective, lens blur, colour cross-talk, white balance, noise, a Bayer mosaic,
 * JPEG and a screen refresh in mid-readout). It is a model, not a measurement of any device: the
 * report says so, and the device numbers come from the probe page on real phones.
 *
 * Options:
 *   --quick   Fewer patterns and frames.
 *   --write   Write `docs/OPTICAL_BENCHMARK.md`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ProbeRun,
  constellationId,
  drawProbeFrame,
  getConstellation,
  probeSequence,
  simulateCapture,
  type ChannelPreset,
  type ProbePattern,
} from '../src/packages/optical-modem/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = path.join(root, 'docs', 'OPTICAL_BENCHMARK.md');
const SESSION = 20261004;
const PRESETS: ChannelPreset[] = ['studio', 'typical', 'poor'];
/** The sender shows 60 display frames per second; the simulated camera takes every second one. */
const DISPLAY_TICKS_PER_CAMERA_FRAME = 2;
const CAMERA_FPS = 30;

function table(header: string[], rows: (string | number)[][]): string {
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

interface ProbeRow {
  preset: ChannelPreset;
  label: string;
  /** Camera pixels per cell the simulator was asked for. */
  cameraPx: number;
  clean: number;
  frames: number;
  ser: number;
  bitsPerCell: number;
  maxBits: number;
  snrDb: number;
  kbps: number;
}

/** Constellations the probe table covers, as the ends of probe pattern labels at 8 px cells. */
const PROBE_LABELS = ['monochrome', '4 colours, OKLab', '8 colours, RGB corners', '8 colours, OKLab', '16 colours, OKLab'];

function benchProbe(quick: boolean): ProbeRow[] {
  const sequence = probeSequence();
  const cellSizes = quick ? [4, 3.2] : [6, 5, 4, 3.5, 3.2];
  const frames = quick ? 2 : 3;
  const rows: ProbeRow[] = [];
  for (const preset of PRESETS) {
    for (const label of PROBE_LABELS) {
      const pattern: ProbePattern | undefined = sequence.find((p) => p.kind === 'grid' && p.pitch === 8 && p.label.endsWith(label));
      if (!pattern) continue;
      for (const cameraPx of cellSizes) {
        const run = new ProbeRun({ device: `simulator, ${preset}`, mode: 'propped', direction: 'simulated', camera: { width: 1920, height: 1080, frameRate: 60, deliveredFps: CAMERA_FPS } });
        for (let c = 0; c < frames; c++) {
          const counter = c * DISPLAY_TICKS_PER_CAMERA_FRAME;
          const capture = simulateCapture(drawProbeFrame(pattern, SESSION, counter), preset, { pixelsPerCell: cameraPx, cellPitch: pattern.pitch, seed: c + 1 });
          run.ingest(capture, (counter * 1000) / 60);
        }
        const [grid] = run.report().grids;
        const max = getConstellation(pattern.constellation).bitsPerCell;
        const row: ProbeRow = grid
          ? { preset, label: pattern.label.replace('8 px cells, ', ''), cameraPx, clean: grid.clean, frames: grid.framesAnalysed, ser: grid.symbolErrorRate, bitsPerCell: grid.bitsPerCell, maxBits: max, snrDb: grid.snrDb, kbps: grid.capacityKBps }
          : { preset, label: pattern.label.replace('8 px cells, ', ''), cameraPx, clean: 0, frames: 0, ser: 1, bitsPerCell: 0, maxBits: max, snrDb: 0, kbps: 0 };
        rows.push(row);
        process.stdout.write(`probe ${preset} ${row.label} at ${cameraPx} px: ${row.clean}/${frames} clean, SER ${(row.ser * 100).toFixed(1)}%, ${row.bitsPerCell.toFixed(2)} bits, ${row.kbps.toFixed(0)} KB/s\n`);
      }
    }
  }
  return rows;
}

function constellationTable(): string {
  const rows: (string | number)[][] = [];
  for (const size of [4, 8, 16] as const) {
    const rgb = getConstellation(constellationId(size, 'rgb'));
    const oklab = getConstellation(constellationId(size, 'oklab'));
    rows.push([size, rgb.minDistance.toFixed(3), oklab.minDistance.toFixed(3), `${(oklab.minDistance / rgb.minDistance).toFixed(2)}x`]);
  }
  return table(['Symbols', 'RGB corners / lattice: smallest OKLab gap', 'OKLab design: smallest OKLab gap', 'Gain'], rows);
}

function render(probe: ProbeRow[]): string {
  const parts: string[] = [
    '# Optical modem benchmark',
    '',
    'Generated by `pnpm run bench:optical --write`. Every number comes from the channel simulator in `src/packages/optical-modem`. It is a model of a phone camera, not a measurement of any device. Real-device results come from the probe page and are recorded in [ADR 0027](adr/0027-optical-channel-probe.md); until then they are unmeasured.',
    '',
    '## Constellations',
    '',
    'Symbols are chosen to keep the closest two as far apart as possible in OKLab, a perceptual space. The RGB column is the usual choice (the corners of the colour cube for 8 symbols, the four most spread corners for 4, a five-level lattice for 16).',
    '',
    constellationTable(),
    '',
    '## Simulated probe',
    '',
    'The same analysis the probe page runs, on simulated captures. The probe frame (120 x 67 cells) is captured with each cell covering the stated number of camera pixels, as if the phone were moved away from the screen. Capacity is the mutual information per cell times the data cells per frame times the new clean frames per second (30 fps camera, 60 Hz display), as an upper bound for an ideal code. "Studio" is a propped phone, "typical" a handheld one and "poor" an old one; their parameters are in `channel.ts`.',
    '',
    table(
      ['Channel', 'Constellation', 'Camera px per cell', 'Clean frames', 'Symbol errors', 'Bits per cell', 'SNR dB', 'Capacity KB/s'],
      probe.map((r) => [r.preset, r.label, r.cameraPx.toFixed(1), `${r.clean}/${r.frames}`, `${(r.ser * 100).toFixed(1)}%`, `${r.bitsPerCell.toFixed(2)} of ${r.maxBits}`, r.snrDb.toFixed(1), r.kbps.toFixed(0)])
    ),
    '',
    'A row with no clean frames was not readable in this channel: the fiducials or the header were lost, or the cells were too ambiguous to tell frames apart. The capacity column counts a full 8 px cell grid of 120 x 67 cells; the profile geometries of the modem are larger.',
    '',
  ];
  return `${parts.join('\n')}\n`;
}

function main(): void {
  const quick = process.argv.includes('--quick');
  const probe = benchProbe(quick);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(REPORT_PATH, render(probe), 'utf8');
    process.stdout.write(`wrote ${path.relative(root, REPORT_PATH).split(path.sep).join('/')}\n`);
  }
}

main();
