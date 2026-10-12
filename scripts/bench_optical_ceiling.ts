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
 * Optical ceiling benchmark (#1161): `pnpm run bench:optical-ceiling [--quick] [--write]`.
 *
 * How fast can a file cross the air with a camera that sees the whole screen? Sends a seeded random
 * file through the high-rate modem profiles (`HIGH_RATE_PROFILES`) and the outer code (ADR 0037),
 * captured by the channel simulator at the size of a 1080p or a 4K camera, and decoded the way a
 * locked receiver would: the first frame by the full fiducial search, the rest by the tracked one.
 * Goodput is file bytes over camera time until the file was rebuilt and its bytes compared, at 30
 * and at 60 camera frames per second. Decode times are this machine's, single threaded.
 *
 * It is a model, not a measurement, and no device has been measured. The `phone` channel adds the
 * lens, shutter, display and ISP effects of `CameraImpairments` with guessed settings
 * (`phoneImpairments`), to be replaced by the probe's measurements (#1173). With `--write` it writes
 * `docs/OPTICAL_CEILING.md`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIGH_RATE_PROFILES, decodeModemFrame, encodeModemFrame, frameCapacity, loadOpticalModem, simulateCapture, type CameraImpairments, type ChannelPreset, type ModemProfile, type RgbaImage, type TrackHint } from '../src/packages/optical-modem/index.ts';
import { FecDecoder, FecEncoder, loadFecModule } from '../src/packages/optical-transfer/index.ts';
import { createRandom } from '../tests/utils/scannerCorpus.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = path.join(root, 'docs', 'OPTICAL_CEILING.md');
const SESSION = 20261012;
/** Pixels per cell in the rendered frame. */
const PITCH = 2;
/** The screen fills this share of the camera's width (the simulator's framing). */
const SCREEN_SHARE = 1 / 1.2;
/** The claim this report answers: 32 Mbit/s, in bytes per second. */
const TARGET = 4_000_000;

interface Camera {
  name: string;
  width: number;
}

const CAMERAS: Record<string, Camera> = {
  hd: { name: '1080p', width: 1920 },
  uhd: { name: '4K', width: 3840 },
};

/** A simulator preset, optionally with the phone's own effects on top. */
interface Channel {
  name: string;
  preset: ChannelPreset;
  phone: boolean;
}

const CHANNELS: Record<string, Channel> = {
  studio: { name: 'studio', preset: 'studio', phone: false },
  typical: { name: 'typical', preset: 'typical', phone: false },
  poor: { name: 'poor', preset: 'poor', phone: false },
  phone: { name: 'phone (guessed)', preset: 'typical', phone: true },
};

interface Scenario {
  profile: ModemProfile;
  camera: Camera;
  channel: Channel;
}

/**
 * Guessed phone effects for one camera frame, on top of the typical channel, until the probe measures
 * them (#1173): 0.2% residual barrel distortion at the corners, hand motion of about 50 camera pixels a
 * second during a 16 ms readout with a stabiliser that leaves a pixel or two of jitter, a 480 Hz OLED
 * at 90% duty, moderate edge enhancement, chroma and temporal noise reduction, and a screen refresh
 * whose tear line drifts slowly down the picture because the camera and the screen run at nearly the
 * same rate.
 */
function phoneImpairments(frame: number, height: number, previous: RgbaImage | undefined): { impairments: CameraImpairments; tearFraction: number } {
  const jitter = [0, 1, -1, 2, -2];
  return {
    impairments: {
      lens: { k1: -0.002 },
      motion: { shear: 0.0008, stretch: 0.0004, shiftX: jitter[frame % 5], shiftY: jitter[(frame + 2) % 5] },
      pwm: { period: height / 7.7, duty: 0.9, exposureRows: height / 4 },
      sharpen: { amount: 1, passes: 1, threshold: 2, clamp: 24 },
      chromaPasses: 1,
      temporal: previous ? { previous, weight: 0.4, threshold: 24 } : undefined,
    },
    tearFraction: (0.3 + frame * 0.013) % 1,
  };
}

interface Run {
  scenario: Scenario;
  cellPx: number;
  fileBytes: number;
  frames: number;
  complete: boolean;
  /** Camera frames before the first one the receiver read. */
  lockFrame: number;
  tracked: number;
  /** Data blocks repaired over data blocks sent, from the lock on. */
  blockShare: number;
  /** File data in repaired blocks, from the lock on. */
  repairedBytes: number;
  fullMs: number;
  trackedMs: number;
  outerMs: number;
}

const median = (values: number[]): number => {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

function transfer(scenario: Scenario, fecModule: WebAssembly.Module, framesOfFile: number, maxFrames: number): Run {
  const { profile, camera, channel } = scenario;
  const capacity = frameCapacity(profile);
  const cellPx = (camera.width * SCREEN_SHARE) / profile.cols;
  const random = createRandom(SESSION + profile.id);
  const fileBytes = capacity.payloadBytes * framesOfFile;
  const file = Uint8Array.from({ length: fileBytes }, () => Math.floor(random() * 256));
  const encoder = new FecEncoder(fecModule, file, { symbolSize: profile.packetBytes });
  const decoder = new FecDecoder(fecModule, encoder.layout);
  let hint: TrackHint | undefined;
  let lockFrame = -1;
  let tracked = 0;
  let repaired = 0;
  let sent = 0;
  let outerMs = 0;
  const fullTimes: number[] = [];
  const trackedTimes: number[] = [];
  const draw = (frame: number): RgbaImage => {
    const payload = new Uint8Array(capacity.payloadBytes);
    for (let b = 0; b < capacity.blocks; b++) payload.set(encoder.symbol(frame * capacity.blocks + b).data, b * profile.packetBytes);
    return encodeModemFrame(profile, payload, SESSION, frame, PITCH);
  };
  let previous: RgbaImage | undefined;
  for (let frame = 0; frame < maxFrames; frame++) {
    const options = { pixelsPerCell: cellPx, cellPitch: PITCH, seed: frame + 1 };
    const shown = draw(frame);
    const image = channel.phone
      ? simulateCapture(shown, channel.preset, { ...options, next: draw(frame + 1), ...phoneImpairments(frame, Math.ceil(shown.height * (cellPx / PITCH) * 1.2), previous) })
      : simulateCapture(shown, channel.preset, options);
    previous = image;
    const start = performance.now();
    const result = decodeModemFrame(image, { geometries: [profile], track: hint });
    const elapsed = performance.now() - start;
    if (lockFrame >= 0) sent += capacity.blocks;
    if (!result.ok) {
      fullTimes.push(elapsed);
      hint = undefined;
      continue;
    }
    if (lockFrame < 0) {
      lockFrame = frame;
      sent += capacity.blocks;
    }
    (result.tracked ? trackedTimes : fullTimes).push(elapsed);
    if (result.tracked) tracked++;
    hint = result.track;
    const outerStart = performance.now();
    result.blocks.forEach((block, b) => {
      if (!block) return;
      repaired++;
      decoder.addAt(result.header.seq * capacity.blocks + b, block);
    });
    outerMs += performance.now() - outerStart;
    if (decoder.isComplete) {
      const rebuilt = decoder.finalize();
      const complete = rebuilt !== null && rebuilt.length === file.length && rebuilt.every((v, i) => v === file[i]);
      return { scenario, cellPx, fileBytes, frames: frame + 1, complete, lockFrame, tracked, blockShare: repaired / sent, repairedBytes: repaired * profile.packetBytes, fullMs: median(fullTimes), trackedMs: median(trackedTimes), outerMs };
    }
  }
  return { scenario, cellPx, fileBytes, frames: maxFrames, complete: false, lockFrame, tracked, blockShare: sent ? repaired / sent : 0, repairedBytes: repaired * profile.packetBytes, fullMs: median(fullTimes), trackedMs: median(trackedTimes), outerMs };
}

function table(header: string[], rows: (string | number)[][]): string {
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

const mb = (bytesPerSecond: number): string => `${(bytesPerSecond / 1e6).toFixed(2)} MB/s (${((bytesPerSecond * 8) / 1e6).toFixed(1)} Mbit/s)`;
const ms = (value: number): string => (Number.isNaN(value) ? '-' : `${value.toFixed(0)} ms`);

function goodput(run: Run, fps: number): number {
  return run.complete ? run.fileBytes / (run.frames / fps) : 0;
}

/** Data in repaired blocks per second from the lock on: the rate a long file approaches. */
function steady(run: Run, fps: number): number {
  return run.lockFrame < 0 ? 0 : run.repairedBytes / ((run.frames - run.lockFrame) / fps);
}

function render(runs: Run[]): string {
  const best = runs.reduce((top, run) => (steady(run, 60) > steady(top, 60) ? run : top), runs[0]);
  const profileRows = HIGH_RATE_PROFILES.map((p) => {
    const c = frameCapacity(p);
    return [`P${p.id} ${p.name}`, `${p.cols} x ${p.rows}`, 'OKLab 4', `${p.packetBytes} + ${p.parity}`, c.blocks, `${(c.payloadBytes / 1000).toFixed(1)} KB`];
  });
  const rows = runs.map((r) => [
    `P${r.scenario.profile.id} ${r.scenario.profile.name}`,
    r.scenario.camera.name,
    r.scenario.channel.name,
    r.cellPx.toFixed(1),
    `${(r.fileBytes / 1e6).toFixed(2)} MB`,
    r.complete ? 'yes' : 'no',
    r.frames,
    r.lockFrame < 0 ? 'never' : r.lockFrame + 1,
    `${(r.blockShare * 100).toFixed(1)}%`,
    r.complete ? mb(goodput(r, 30)) : '-',
    r.complete ? mb(goodput(r, 60)) : '-',
    mb(steady(r, 60)),
  ]);
  const timeRows = runs.map((r) => {
    const perCore = 1000 / r.trackedMs;
    return [
      `P${r.scenario.profile.id} ${r.scenario.profile.name}`,
      r.scenario.camera.name,
      r.scenario.channel.name,
      ms(r.fullMs),
      ms(r.trackedMs),
      Number.isNaN(perCore) ? '-' : perCore.toFixed(1),
      Number.isNaN(perCore) ? '-' : Math.ceil(30 / perCore),
      Number.isNaN(perCore) ? '-' : Math.ceil(60 / perCore),
      ms(r.outerMs),
    ];
  });
  return `${[
    '# Optical ceiling benchmark',
    '',
    'Generated by `pnpm run bench:optical-ceiling --write`. Every number comes from the channel simulator in `src/packages/optical-modem`, a model of a phone camera, and not from any device. Real-device numbers come from the probe page ([ADR 0027](adr/0027-optical-channel-probe.md)) and the device checklist ([TRANSFER_DEVICE_CHECKLIST.md](TRANSFER_DEVICE_CHECKLIST.md)); until then they are unmeasured.',
    '',
    `The question it answers: can a camera that sees the whole screen carry 32 Mbit/s (${(TARGET / 1e6).toFixed(0)} MB/s) of file data? The QR transfer that ships reaches 135 KB/s at 30 fps and 273 KB/s at 60 fps in its own simulation ([TRANSFER_BENCHMARK.md](TRANSFER_BENCHMARK.md)); the modem ladder's densest profile reaches 81 KB/s ([OPTICAL_LADDER_BENCHMARK.md](OPTICAL_LADDER_BENCHMARK.md)), because its grid fills only a corner of a 1080p picture.`,
    '',
    '## Profiles',
    '',
    'Grids sized so a cell covers about 4 camera pixels when the screen fills the simulator\'s framing (five sixths of the picture\'s width). Each block carries one symbol of the outer code, so a frame needs no per-block header: the symbol index is the frame number times the blocks per frame plus the block number. Every block also carries the 4-byte identity tag of ADR 0043.',
    '',
    table(['Profile', 'Grid (cells)', 'Colours', 'Data + check bytes per block', 'Blocks per frame', 'File data per frame'], profileRows),
    '',
    '## Transfers',
    '',
    `A seeded random file of ${runs[0] ? Math.round(runs[0].fileBytes / frameCapacity(runs[0].scenario.profile).payloadBytes) : 0} frames' worth of data through the outer code, one camera frame per frame sent. "Lock" is the camera frame the receiver first read; every later frame was looked for near the last one (the tracked search). "Blocks repaired" counts from the lock on. Goodput is the file's bytes over the camera time to the frame that completed it, lock-on included, after the rebuilt file matched the sent one byte for byte. A short file pays for the lock-on frame and the outer code's last symbols, so "steady rate" adds the data in repaired blocks per second from the lock on, the rate a long file approaches (before the outer code's overhead, about 0.1% in [TRANSFER_BENCHMARK.md](TRANSFER_BENCHMARK.md)). In the studio, typical and poor channels the simulated phone does not move between frames; the tracked search's tolerance of movement is tested in \`src/packages/optical-modem/tests/tracking.test.ts\`. The phone channel is the typical one plus guessed lens distortion, rolling-shutter shear, stabiliser jitter of up to 2 pixels, OLED PWM bands, edge enhancement, chroma and temporal noise reduction, and a screen refresh in every capture whose tear line drifts down the picture (\`phoneImpairments\` in the script). Its settings are guesses until the probe measures a phone (#1173); blocks below the tear belong to the next frame and are refused by their identity tag.`,
    '',
    table(['Profile', 'Camera', 'Channel', 'Camera px per cell', 'File', 'Complete', 'Frames', 'Lock', 'Blocks repaired', 'Goodput at 30 fps', 'Goodput at 60 fps', 'Steady rate at 60 fps'], rows),
    '',
    best && steady(best, 60) > 0
      ? `Best: P${best.scenario.profile.id} ${best.scenario.profile.name}, ${best.scenario.camera.name} camera, ${best.scenario.channel.name} channel, a steady ${mb(steady(best, 60))} at 60 fps: ${steady(best, 60) >= TARGET ? 'above' : 'below'} 32 Mbit/s in the simulation.`
      : 'No run completed.',
    '',
    '## Decode time',
    '',
    'Median wall time per camera frame on this machine, one thread, the modem module in WebAssembly under Node, sampling on the CPU (the browser receiver can sample on the GPU, ADR 0029). "Full" is a frame found by the whole-image fiducial search, "tracked" one found near the last. "Threads at 30 / 60 fps" is how many such threads it would take to keep up, if frames are shared between workers. "Outer code" is the time spent adding the repaired blocks to the outer decoder over the whole transfer.',
    '',
    table(['Profile', 'Camera', 'Channel', 'Full', 'Tracked', 'Frames per second per thread', 'Threads at 30 fps', 'Threads at 60 fps', 'Outer code'], timeRows),
    '',
    '## What this does not show',
    '',
    '- A phone. Lens fall-off, focus across a wide grid, glare, exposure and the camera pipeline\'s own processing are only modelled, and the cells are smaller than anything the probe has measured.',
    '- That the camera delivers the frame rate. Browsers often deliver 4K at 30 fps, and some cameras not at all; the 60 fps column needs a camera and browser that hand over 60 full frames a second.',
    '- That the display shows every frame. A 60 Hz screen that drops or tears frames costs blocks; tearing is in the simulator but not in these rows.',
    '- That a phone decodes in time: the thread counts above are for a desktop CPU.',
    '',
  ].join('\n')}`;
}

async function main(): Promise<void> {
  const quick = process.argv.includes('--quick');
  await loadOpticalModem();
  const fecModule = await loadFecModule();
  const [wide, ultra] = HIGH_RATE_PROFILES;
  const channels = quick ? [CHANNELS.typical, CHANNELS.phone] : [CHANNELS.studio, CHANNELS.typical, CHANNELS.poor, CHANNELS.phone];
  const scenarios: Scenario[] = [];
  for (const channel of channels) scenarios.push({ profile: wide, camera: CAMERAS.hd, channel });
  for (const channel of channels) scenarios.push({ profile: ultra, camera: CAMERAS.uhd, channel });
  const framesOfFile = quick ? 4 : 10;
  const runs: Run[] = [];
  for (const scenario of scenarios) {
    const run = transfer(scenario, fecModule, framesOfFile, framesOfFile * 3);
    runs.push(run);
    process.stdout.write(
      `P${scenario.profile.id} ${scenario.camera.name} ${scenario.channel.name}: ${run.complete ? `${run.frames} frames, ${mb(goodput(run, 30))} at 30 fps, ${mb(goodput(run, 60))} at 60 fps` : 'incomplete'}; lock ${run.lockFrame + 1}, blocks ${(run.blockShare * 100).toFixed(1)}%, full ${ms(run.fullMs)}, tracked ${ms(run.trackedMs)}\n`
    );
  }
  if (process.argv.includes('--write')) {
    fs.writeFileSync(REPORT_PATH, render(runs), 'utf8');
    process.stdout.write(`wrote ${path.relative(root, REPORT_PATH).split(path.sep).join('/')}\n`);
  }
}

await main();
