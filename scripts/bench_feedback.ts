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
 * Webcam back channel benchmark (#1146): `pnpm run bench:feedback [--quick] [--write]`.
 *
 * Runs the simulation in `tests/utils/feedbackBench.ts` over seeded receivers and prints tables of
 * goodput, the profile the sender settled on and how long it took to stop. `--write` puts them in
 * `docs/FEEDBACK_BENCHMARK.md`. Which frames a receiver reads is a model, so these figures test the
 * control logic and say nothing about a real camera, screen or webcam.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MultiRateProfileName } from '../src/packages/optical-transfer/index.ts';
import {
  BEACON_READ_CHANCE,
  DEFAULT_BACK_CHANNEL,
  DENSE_READ_CHANCE,
  DENSE_UNREADABLE_CHANCE,
  runFeedbackBench,
  type BackChannel,
  type BenchReceiver,
  type FeedbackBenchResult,
} from '../tests/utils/feedbackBench.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = path.join(root, 'docs', 'FEEDBACK_BENCHMARK.md');
const quick = process.argv.includes('--quick');
const write = process.argv.includes('--write');
const FILE_BYTES = quick ? 300_000 : 800_000;
const SEEDS = quick ? [1, 2] : [1, 2, 3, 4, 5];
const PROFILES: MultiRateProfileName[] = ['steady', 'balanced', 'fast'];

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const fmt = (value: number, digits = 1) => value.toFixed(digits);
const range = (values: number[], digits = 1) => `${fmt(Math.min(...values), digits)} to ${fmt(Math.max(...values), digits)}`;
const finalProfile = (run: FeedbackBenchResult) => run.timeline[run.timeline.length - 1].profile;

async function runSeeds(make: (seed: number) => Parameters<typeof runFeedbackBench>[0]): Promise<FeedbackBenchResult[]> {
  const runs: FeedbackBenchResult[] = [];
  for (const seed of SEEDS) runs.push(await runFeedbackBench(make(seed)));
  return runs;
}

const CAPABILITIES: { label: string; receiver: BenchReceiver }[] = [
  { label: 'strong (reads Fast)', receiver: { name: 'strong', reads: 'fast' } },
  { label: 'middle (reads Balanced)', receiver: { name: 'middle', reads: 'balanced' } },
  { label: 'weak (reads Steady)', receiver: { name: 'weak', reads: 'steady' } },
];

function table(header: string[], rows: string[][]): string {
  return [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

async function singleReceiver(): Promise<string> {
  const rows: string[][] = [];
  for (const { label, receiver } of CAPABILITIES) {
    for (const profile of PROFILES) {
      const runs = await runSeeds((seed) => ({ mode: { kind: 'fixed', profile }, receivers: [receiver], fileBytes: FILE_BYTES, seed }));
      rows.push([label, `fixed ${profile} (one-way)`, fmt(mean(runs.map((run) => run.goodputKBps[0]))), fmt(mean(runs.map((run) => run.doneAtMs[0] ?? 0)) / 1000), profile, 'never']);
    }
    const runs = await runSeeds((seed) => ({ mode: { kind: 'steered' }, receivers: [receiver], fileBytes: FILE_BYTES, seed }));
    const finals = [...new Set(runs.map(finalProfile))].join(', ');
    const delays = runs.map((run) => run.stopDelayMs ?? Number.NaN);
    rows.push([
      label,
      '**steered**',
      `**${fmt(mean(runs.map((run) => run.goodputKBps[0])))}**`,
      fmt(mean(runs.map((run) => run.doneAtMs[0] ?? 0)) / 1000),
      finals,
      `${fmt(mean(delays), 0)} ms (max ${fmt(Math.max(...delays), 0)})`,
    ]);
  }
  return table(['Receiver', 'Sender', 'Goodput KB/s (mean)', 'Seconds to done (mean)', 'Profile at the end', 'Stop after done'], rows);
}

async function manyReceivers(): Promise<string> {
  const sets: { label: string; receivers: BenchReceiver[] }[] = [
    { label: 'strong + weak', receivers: [CAPABILITIES[0].receiver, CAPABILITIES[2].receiver] },
    { label: 'strong + middle', receivers: [CAPABILITIES[0].receiver, CAPABILITIES[1].receiver] },
    { label: 'strong x3', receivers: [0, 1, 2].map((i) => ({ name: `strong-${i}`, reads: 'fast' as const })) },
  ];
  const rows: string[][] = [];
  for (const set of sets) {
    const runs = await runSeeds((seed) => ({ mode: { kind: 'steered' }, receivers: set.receivers, fileBytes: FILE_BYTES, seed }));
    const delays = runs.map((run) => run.stopDelayMs ?? Number.NaN);
    rows.push([
      set.label,
      set.receivers.map((_, i) => fmt(mean(runs.map((run) => run.goodputKBps[i])))).join(' / '),
      set.receivers.map((_, i) => fmt(mean(runs.map((run) => run.doneAtMs[i] ?? 0)) / 1000)).join(' / '),
      `${fmt(mean(delays), 0)} ms (max ${fmt(Math.max(...delays), 0)})`,
      [...new Set(runs.map(finalProfile))].join(', '),
    ]);
  }
  return table(['Receivers', 'Goodput KB/s each (mean)', 'Seconds to done each (mean)', 'Stop after the last is done', 'Profile at the end'], rows);
}

async function backChannelSweep(): Promise<string> {
  const settings: { label: string; channel: BackChannel }[] = [
    { label: 'default', channel: DEFAULT_BACK_CHANNEL },
    { label: 'slow decode', channel: { ...DEFAULT_BACK_CHANNEL, latencyMs: 400 } },
    { label: 'very slow decode', channel: { ...DEFAULT_BACK_CHANNEL, latencyMs: 800 } },
    { label: 'half the codes missed', channel: { ...DEFAULT_BACK_CHANNEL, loss: 0.5 } },
    { label: 'four in five missed', channel: { ...DEFAULT_BACK_CHANNEL, loss: 0.8 } },
    { label: 'refresh once a second', channel: { ...DEFAULT_BACK_CHANNEL, intervalMs: 1000 } },
  ];
  const rows: string[][] = [];
  for (const setting of settings) {
    const delays: number[] = [];
    for (const seed of SEEDS.concat(quick ? [] : [6, 7, 8, 9, 10])) {
      const run = await runFeedbackBench({ mode: { kind: 'steered' }, receivers: [CAPABILITIES[0].receiver], fileBytes: FILE_BYTES, seed, backChannel: setting.channel });
      delays.push(run.stopDelayMs ?? Number.NaN);
    }
    const within = delays.filter((delay) => delay <= 1000).length;
    rows.push([setting.label, `${setting.channel.intervalMs} / ${setting.channel.latencyMs} / ${Math.round(setting.channel.loss * 100)}%`, range(delays, 0), `${within} of ${delays.length}`]);
  }
  return table(['Back channel', 'Refresh ms / delay ms / loss', 'Stop after done, ms (min to max)', 'Stopped within 1 s'], rows);
}

const sections = [
  `# Webcam back channel benchmark (#1146)

Generated by \`pnpm run bench:feedback\`${quick ? ' --quick' : ''}. A ${FILE_BYTES / 1000} KB file, ${SEEDS.length} seeds per row, simulated time.

**What is real:** the multi-rate sender's frames (dense tiles and beacons, one session across profile switches), the \`PrismReceiver\` that decodes and verifies the file, the feedback frames (encoded to Base45 and decoded again) and the speed controller.

**What is a model:** which frames a receiver reads. A receiver reads a dense tile with a ${DENSE_READ_CHANCE * 100}% chance when its camera can read that profile and ${DENSE_UNREADABLE_CHANCE * 100}% when it cannot, and a beacon with a ${BEACON_READ_CHANCE * 100}% chance at any profile. The back channel is a refresh interval, a delay from the receiver's screen to a decoded report at the sender, and a loss rate. The tables test the control logic. They are not measurements of a camera, a screen or a webcam, and the goodput figures say nothing about a real phone. Two things in the model colour the fixed rows: a beacon is readable at every profile, and profiles differ in how large and how frequent their beacons are, so "fixed" at a profile the receiver cannot read still makes progress from the beacons.`,
  `## One receiver\n\nThe sender either shows one profile for the whole transfer (the one-way stream) or is steered, starting at Balanced, the default. The steered rows pay for the climb and for every probe past what the receiver can read.\n\n${await singleReceiver()}`,
  `## Several receivers\n\nThe sender follows the weakest receiver and stops when every receiver it can see is done.\n\n${await manyReceivers()}`,
  `## How fast the back channel has to be\n\nOne strong receiver. "Stop after done" runs from the moment the last receiver verified the file to the moment the sender decided to stop. It is the back channel's delay plus the codes that were missed in a row; the controller adds none.\n\n${await backChannelSweep()}`,
];

const report = `${sections.join('\n\n')}\n`;
console.log(report);
if (write) {
  fs.writeFileSync(REPORT_PATH, report);
  console.log(`Wrote ${path.relative(root, REPORT_PATH).split(path.sep).join('/')}`);
}
