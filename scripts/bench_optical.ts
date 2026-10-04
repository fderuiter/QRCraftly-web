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
  DEFAULT_ERASURE_THRESHOLD,
  MODEM_PROFILES,
  ProbeRun,
  constellationId,
  decodeModemFrame,
  drawProbeFrame,
  encodeModemFrame,
  frameCapacity,
  getConstellation,
  probeSequence,
  simulateCapture,
  type ChannelPreset,
  type ModemProfile,
  type ProbePattern,
} from '../src/packages/optical-modem/index.ts';
import { FountainDecoder, FountainEncoder } from '../src/packages/optical-transfer/index.ts';

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

/** Capture settings for the codec tables: the camera pixels per cell where profiles start to struggle. */
const CODEC_SEEDS = [1, 2, 3];
const CODEC_PITCH = 4;
/** Erasure thresholds compared in the soft-versus-hard table. Zero is hard decoding. */
const THRESHOLDS = [0, 16, 32, 40, 64, 96, 128];

interface Trial {
  /** Mean share of blocks repaired, counting unreadable frames as zero. */
  blockShare: number;
  readable: number;
  frames: number;
}

/** Encodes, captures and decodes a few frames of one shape, once per erasure threshold. */
function codecTrial(shape: ModemProfile, preset: ChannelPreset, cameraPx: number, thresholds: number[], seeds: number[]): Trial[] {
  const capacity = frameCapacity(shape);
  const shares = thresholds.map(() => 0);
  let readable = 0;
  for (const seed of seeds) {
    const payload = Uint8Array.from({ length: capacity.payloadBytes }, (_, i) => (i * 31 + seed * 7 + 5) & 255);
    const capture = simulateCapture(encodeModemFrame(shape, payload, SESSION, seed, CODEC_PITCH), preset, { pixelsPerCell: cameraPx, cellPitch: CODEC_PITCH, seed });
    thresholds.forEach((threshold, t) => {
      const result = decodeModemFrame(capture, { geometries: [shape], soft: threshold > 0, threshold });
      if (!result.ok) return;
      if (t === 0) readable++;
      // A block counts only when its bytes are the bytes that were sent.
      const good = result.blocks.filter((block, b) => block && block.every((v, i) => v === payload[b * shape.packetBytes + i])).length;
      shares[t] += good / capacity.blocks;
    });
  }
  return thresholds.map((_, t) => ({ blockShare: shares[t] / seeds.length, readable, frames: seeds.length }));
}

const goodputKBps = (shape: ModemProfile, share: number): number => (share * frameCapacity(shape).payloadBytes * CAMERA_FPS) / 1000;
const percent = (share: number): string => `${(share * 100).toFixed(0)}%`;

/** Where each profile is stressed: a camera pixel count at which it is neither perfect nor lost. */
const STRESS_PX: Record<number, number> = { 2: 3.5, 3: 4, 4: 5 };

function codecTables(quick: boolean): string[] {
  const seeds = quick ? [1] : CODEC_SEEDS;
  const pxList = quick ? [5, 4] : [6, 5, 4, 3.5, 3];
  const goodput: (string | number)[][] = [];
  for (const profile of MODEM_PROFILES) {
    const capacity = frameCapacity(profile);
    for (const preset of PRESETS) {
      for (const px of pxList) {
        const [hard, soft] = codecTrial(profile, preset, px, [0, DEFAULT_ERASURE_THRESHOLD], seeds);
        goodput.push([`P${profile.id} ${profile.name}`, preset, px.toFixed(1), `${hard.readable}/${hard.frames}`, percent(hard.blockShare), percent(soft.blockShare), `${goodputKBps(profile, soft.blockShare).toFixed(1)} of ${goodputKBps(profile, 1).toFixed(1)}`]);
        process.stdout.write(`codec P${profile.id} ${preset} ${px} px: hard ${percent(hard.blockShare)}, soft ${percent(soft.blockShare)} (${capacity.blocks} blocks)\n`);
      }
    }
  }
  const sweep: (string | number)[][] = [];
  const thresholds = quick ? [0, 40] : THRESHOLDS;
  const sweepSeeds = quick ? seeds : [1, 2, 3, 4, 5];
  for (const profile of MODEM_PROFILES) {
    // Once at the profile's own code, where the margin is wide, and once with 16 fewer check bytes, where it is thin.
    for (const parity of [profile.parity, profile.parity - 16]) {
      const shape: ModemProfile = { ...profile, parity, packetBytes: profile.packetBytes + profile.parity - parity };
      const trials = codecTrial(shape, 'typical', STRESS_PX[profile.id], thresholds, sweepSeeds);
      sweep.push([`P${profile.id} ${profile.name}`, parity, STRESS_PX[profile.id].toFixed(1), ...trials.map((t) => percent(t.blockShare))]);
    }
  }
  const parities = quick ? [32, 64] : [16, 32, 48, 64, 80, 96];
  const parityRows: (string | number)[][] = [];
  for (const profile of MODEM_PROFILES) {
    for (const parity of parities) {
      const shape: ModemProfile = { ...profile, parity, packetBytes: 160 - parity };
      const [soft] = codecTrial(shape, 'typical', STRESS_PX[profile.id], [DEFAULT_ERASURE_THRESHOLD], seeds);
      parityRows.push([`P${profile.id} ${profile.name}`, parity, 160 - parity, percent(soft.blockShare), goodputKBps(shape, soft.blockShare).toFixed(1)]);
      process.stdout.write(`parity P${profile.id} ${parity}: ${percent(soft.blockShare)}\n`);
    }
  }
  return [
    '## Codec: blocks repaired and goodput',
    '',
    `Each row encodes frames of one profile (Reed-Solomon blocks, interleaved and whitened), captures them through the simulated channel and decodes them. "Readable" is how many frames had their fiducials and header read. "Hard" has the code find every wrong byte; "soft" marks bytes carried by a cell with confidence under ${DEFAULT_ERASURE_THRESHOLD} (of 255) as erasures. Goodput is the data bytes in repaired blocks times ${CAMERA_FPS} frames per second, in kilobytes (1000 bytes) per second, and assumes every camera frame is a fresh, untorn frame (the probe measures how many really are). It counts data only, before the outer code's overhead.`,
    '',
    table(['Profile', 'Channel', 'Camera px per cell', 'Readable', 'Blocks repaired, hard', 'Blocks repaired, soft', 'Goodput KB/s (of full frame)'], goodput),
    '',
    '### Soft versus hard decoding',
    '',
    `Share of blocks repaired in the typical channel at the stated pixels per cell, for each erasure threshold (0 is hard decoding), over ${sweepSeeds.length} frame${sweepSeeds.length > 1 ? 's' : ''}. Each profile is run with its own code and with 16 check bytes fewer; the data bytes grow to keep blocks at 160 bytes. Erasures help where the code is near its limit and do nothing where it has a wide margin.`,
    '',
    table(['Profile', 'Check bytes', 'Camera px per cell', ...thresholds.map((t) => (t === 0 ? 'hard' : `soft < ${t}`))], sweep),
    '',
    '### Check bytes per block',
    '',
    'Blocks of 160 bytes with a varying split between data and check bytes, soft decoding, typical channel at the same pixels per cell. More check bytes repair more damage but carry less data.',
    '',
    table(['Profile', 'Check bytes', 'Data bytes', 'Blocks repaired', 'Goodput KB/s'], parityRows),
    '',
  ];
}

/**
 * Sends a file through the whole stack: the rateless outer code makes droplets, each inner block of
 * a frame carries one, the simulated camera reads the frames, and every repaired block is fed to the
 * outer decoder until the file comes back.
 */
function transfer(shape: ModemProfile, preset: ChannelPreset, cameraPx: number, fileBytes: number, maxFrames: number): { frames: number; complete: boolean } {
  const capacity = frameCapacity(shape);
  const message = Uint8Array.from({ length: fileBytes }, (_, i) => (i * 131 + 17) & 255);
  const encoder = new FountainEncoder(message, { blockSize: shape.packetBytes });
  const decoder = new FountainDecoder();
  for (let frame = 0; frame < maxFrames; frame++) {
    const seqs = Array.from({ length: capacity.blocks }, (_, b) => encoder.seqForIndex(frame * capacity.blocks + b));
    const droplets = seqs.map((seq) => encoder.getDroplet(seq));
    const payload = new Uint8Array(capacity.payloadBytes);
    droplets.forEach((d, b) => payload.set(d.data, b * shape.packetBytes));
    const capture = simulateCapture(encodeModemFrame(shape, payload, SESSION, frame, CODEC_PITCH), preset, { pixelsPerCell: cameraPx, cellPitch: CODEC_PITCH, seed: frame + 1 });
    const result = decodeModemFrame(capture, { geometries: [shape] });
    if (!result.ok) continue;
    result.blocks.forEach((block, b) => {
      if (block) decoder.ingest({ seq: seqs[b], k: encoder.k, messageLength: encoder.messageLength, checksum: encoder.checksum }, block);
    });
    if (decoder.isComplete) return { frames: frame + 1, complete: true };
  }
  return { frames: maxFrames, complete: false };
}

function transferTable(quick: boolean): string[] {
  const fileBytes = quick ? 8000 : 48000;
  const maxFrames = quick ? 60 : 250;
  const rows: (string | number)[][] = [];
  for (const profile of MODEM_PROFILES) {
    const px = STRESS_PX[profile.id];
    const done = transfer(profile, 'typical', px, fileBytes, maxFrames);
    const seconds = done.frames / CAMERA_FPS;
    rows.push([`P${profile.id} ${profile.name}`, px.toFixed(1), done.complete ? 'yes' : `no, gave up after ${maxFrames} frames`, done.frames, seconds.toFixed(1), done.complete ? (fileBytes / 1000 / seconds).toFixed(1) : '-']);
    process.stdout.write(`transfer P${profile.id}: ${done.complete ? done.frames + ' frames' : 'incomplete'}\n`);
  }
  return [
    '## End to end: a file through the outer code',
    '',
    `A ${(fileBytes / 1000).toFixed(0)} KB file, split into droplets by the rateless outer code (the same one the QR transfer uses), one droplet per inner block, through the typical channel. Frames are counted until the file is complete and its checksum matches; the time assumes one frame per camera frame at ${CAMERA_FPS} fps. The file goodput includes the outer code's overhead.`,
    '',
    table(['Profile', 'Camera px per cell', 'File complete', 'Frames', 'Seconds', 'File goodput KB/s'], rows),
    '',
  ];
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

function render(probe: ProbeRow[], codec: string[], end: string[]): string {
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
    ...codec,
    ...end,
  ];
  return `${parts.join('\n')}\n`;
}

function main(): void {
  const quick = process.argv.includes('--quick');
  const probe = benchProbe(quick);
  const codec = codecTables(quick);
  const end = transferTable(quick);
  if (process.argv.includes('--write')) {
    fs.writeFileSync(REPORT_PATH, render(probe, codec, end), 'utf8');
    process.stdout.write(`wrote ${path.relative(root, REPORT_PATH).split(path.sep).join('/')}\n`);
  }
}

main();
