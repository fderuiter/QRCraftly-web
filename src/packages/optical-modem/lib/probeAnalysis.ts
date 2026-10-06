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

import { labDistance, type Lab } from './colour';
import { constellationShape } from './constellation';
import { acquireFrame, type AcquiredFrame } from './frame';
import { modemKernels, type AcquireFailure } from './kernels';
import { BAND_ROWS, type RgbaImage } from './layout';
import { PROBE_PROFILE, probeGeometries, probeSequence, probeSymbols, unpackProbeSeq, type ProbePattern } from './probe';

/** What the receiver knows about its camera, filled in by the page from `getSettings()`. */
export interface ProbeCamera {
  /** Granted capture size. */
  width: number;
  height: number;
  /** Granted frame rate. */
  frameRate: number;
  /** Frames per second the camera actually delivered, counted by the page. */
  deliveredFps?: number;
}

/** Labels the person gives a run; they only appear in the report. */
export interface ProbeMeta {
  device: string;
  mode: 'handheld' | 'propped' | 'unspecified';
  direction: string;
  camera?: ProbeCamera;
}

/** Verdict on one captured grid frame. */
export type FrameStatus = 'clean' | 'torn' | 'blended';

/** Verdicts by the code the modem module returns. */
const FRAME_STATUSES: readonly FrameStatus[] = ['clean', 'torn', 'blended'];

/** One cell-size and constellation configuration, as measured. */
export interface GridResult {
  pattern: ProbePattern;
  framesAnalysed: number;
  clean: number;
  torn: number;
  blended: number;
  /** Cells that differ from what was sent, over clean frames. */
  symbolErrorRate: number;
  /** Mutual information estimate per cell, in bits (plug-in estimate from the confusion matrix). */
  bitsPerCell: number;
  /** The most a cell can carry with this constellation, in bits. */
  maxBitsPerCell: number;
  /** Class separation over spread, in dB, in OKLab: smallest gap between symbol means against the mean deviation. */
  snrDb: number;
  /** Mean size of a cell in the camera image, in pixels: what the camera resolved at this distance. */
  cameraCellPx: number;
  /** Display ticks per second seen in the headers. */
  displayFps: number;
  /** New clean frames per second: min(camera, display) times the clean share. */
  effectiveFps: number;
  /** Information-theoretic capacity in kilobytes (1000 bytes) per second for this configuration. */
  capacityKBps: number;
  /** Mean classification confidence (0 to 255) and its 10th percentile; a drop between frames means motion blur. */
  meanConfidence: number;
  confidenceP10: number;
  /** Counts of expected (row) against read (column) symbols. */
  confusion: number[][];
}

/** A flicker pattern as measured. */
export interface FlickerResult {
  pattern: ProbePattern;
  framesAnalysed: number;
  displayFps: number;
  /** OKLab distance between the two colours as the camera saw them. */
  separation: number;
  /** Share of frames whose colour is nearer the variant the header names than the other. */
  fidelity: number;
}

/** The slanted edge as measured, in cell units. */
export interface EdgeResult {
  pattern: ProbePattern;
  framesAnalysed: number;
  /** Deviation of the line spread, in cells. */
  sigmaCells: number;
  /** Spatial frequency where contrast falls to half, in cycles per cell. */
  mtf50CyclesPerCell: number;
}

/** A finished run. Nothing in it identifies anyone but the labels the person typed. */
export interface ProbeReport {
  meta: ProbeMeta;
  framesAnalysed: number;
  /** Frames that could not be read, by reason. */
  unreadable: Record<string, number>;
  grids: GridResult[];
  flicker: FlickerResult[];
  edges: EdgeResult[];
}

interface GridState {
  pattern: ProbePattern;
  size: number;
  clean: number;
  torn: number;
  blended: number;
  /**
   * Running totals the modem module adds clean frames to: cells, symbol errors, the `size x size`
   * confusion counts, then per symbol the OKLab sample count, sums and sums of squares.
   */
  totals: Float64Array;
  confidences: number[];
  cellPx: number[];
  counters: Set<number>;
  firstTime: number;
  lastTime: number;
  firstCounter: number;
  lastCounter: number;
}

interface FlickerState {
  pattern: ProbePattern;
  frames: { variant: number; lab: Lab }[];
  firstTime: number;
  lastTime: number;
  firstCounter: number;
  lastCounter: number;
}

interface EdgeState {
  pattern: ProbePattern;
  sigmas: number[];
  mtf50s: number[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

/** Collects what a receiver sees while the sender plays the probe sequence, and turns it into a report. */
export class ProbeRun {
  public meta: ProbeMeta;
  private framesAnalysed = 0;
  private readonly unreadable = new Map<string, number>();
  private readonly grids = new Map<number, GridState>();
  private readonly flicker = new Map<number, FlickerState>();
  private readonly edges = new Map<number, EdgeState>();
  /** The symbols each grid pattern sends, by pattern, session and variant; they never change. */
  private readonly sent = new Map<string, Uint8Array>();

  constructor(meta: ProbeMeta) {
    this.meta = meta;
  }

  /**
   * Reads one captured frame and files what it shows. The per-frame work (finding the frame,
   * sampling the cells, sorting and tallying them, the edge response) runs in the modem module.
   * @param image - The captured frame.
   * @param timeMs - When it was captured, in milliseconds on any steady clock.
   * @returns Which pattern the frame showed, or null when it could not be read.
   */
  public ingest(image: RgbaImage, timeMs: number): number | null {
    this.framesAnalysed++;
    const acquired = acquireFrame(image, probeGeometries());
    if (!acquired.ok) return this.reject(acquired.reason);
    const { frame } = acquired;
    if (frame.header.profile !== PROBE_PROFILE) return this.reject('foreign');
    const { patternIndex, counter } = unpackProbeSeq(frame.header.seq);
    const pattern = probeSequence()[patternIndex];
    if (!pattern || pattern.cols !== frame.header.cols || pattern.rows !== frame.header.rows) return this.reject('unknown-pattern');
    if (pattern.kind === 'grid') this.ingestGrid(frame, pattern, counter, timeMs);
    else if (pattern.kind === 'flicker') this.ingestFlicker(frame, pattern, counter, timeMs);
    else this.ingestEdge(pattern);
    return patternIndex;
  }

  private reject(reason: AcquireFailure | 'foreign' | 'unknown-pattern'): null {
    this.unreadable.set(reason, (this.unreadable.get(reason) ?? 0) + 1);
    return null;
  }

  private symbolsOf(pattern: ProbePattern, session: number, variant: number): Uint8Array {
    const key = `${pattern.index}:${session}:${variant}`;
    let symbols = this.sent.get(key);
    if (!symbols) {
      symbols = probeSymbols(pattern, session, variant);
      this.sent.set(key, symbols);
    }
    return symbols;
  }

  private ingestGrid(frame: AcquiredFrame, pattern: ProbePattern, counter: number, timeMs: number): void {
    const { size } = constellationShape(pattern.constellation);
    let state = this.grids.get(pattern.index);
    if (!state) {
      state = {
        pattern,
        size,
        clean: 0,
        torn: 0,
        blended: 0,
        totals: new Float64Array(2 + size * size + 7 * size),
        confidences: [],
        cellPx: [],
        counters: new Set(),
        firstTime: timeMs,
        lastTime: timeMs,
        firstCounter: counter,
        lastCounter: counter,
      };
      this.grids.set(pattern.index, state);
    }
    state.counters.add(counter);
    state.lastTime = timeMs;
    state.lastCounter = counter;
    const kernels = modemKernels();
    state.cellPx.push(kernels.probeCellSize(frame.header.cols, frame.header.rows));
    kernels.sample(frame.cols, frame.dataRows, BAND_ROWS, frame.palette.length / 3);
    const variant = counter & 1;
    const own = this.symbolsOf(pattern, frame.header.session, variant);
    const other = this.symbolsOf(pattern, frame.header.session, 1 - variant);
    const { status, confidence } = kernels.probeGrid(own, other, state.totals, frame.cols, frame.dataRows, size);
    const verdict = FRAME_STATUSES[status];
    state[verdict]++;
    if (verdict === 'clean') state.confidences.push(confidence);
  }

  private ingestFlicker(frame: AcquiredFrame, pattern: ProbePattern, counter: number, timeMs: number): void {
    const state = this.flicker.get(pattern.index) ?? { pattern, frames: [], firstTime: timeMs, lastTime: timeMs, firstCounter: counter, lastCounter: counter };
    this.flicker.set(pattern.index, state);
    state.lastTime = timeMs;
    state.lastCounter = counter;
    const kernels = modemKernels();
    kernels.sample(frame.cols, frame.dataRows, BAND_ROWS, frame.palette.length / 3);
    state.frames.push({ variant: counter & 1, lab: kernels.probeFlicker(frame.cols * frame.dataRows) });
  }

  private ingestEdge(pattern: ProbePattern): void {
    const state = this.edges.get(pattern.index) ?? { pattern, sigmas: [], mtf50s: [] };
    this.edges.set(pattern.index, state);
    const measured = modemKernels().probeEdge(pattern.cols, pattern.rows);
    if (measured) {
      state.sigmas.push(measured.sigmaCells);
      state.mtf50s.push(measured.mtf50CyclesPerCell);
    }
  }

  /**
   * Summarises everything seen so far.
   * @returns The report.
   */
  public report(): ProbeReport {
    const cameraFps = this.meta.camera?.deliveredFps;
    const grids = [...this.grids.values()]
      .sort((a, b) => a.pattern.index - b.pattern.index)
      .map((s): GridResult => {
        const analysed = s.clean + s.torn + s.blended;
        const elapsed = Math.max(1, s.lastTime - s.firstTime) / 1000;
        const displayFps = s.counters.size > 1 ? (s.lastCounter - s.firstCounter) / elapsed : 0;
        const received = cameraFps ?? analysed / elapsed;
        const effectiveFps = analysed > 0 ? Math.min(received, displayFps || received) * (s.clean / analysed) : 0;
        const { size, totals } = s;
        const bitsPerCell = modemKernels().mutualInformation(totals, size);
        const confusion = Array.from({ length: size }, (_, x) => Array.from(totals.subarray(2 + x * size, 2 + (x + 1) * size)));
        const statsAt = 2 + size * size;
        const symbolStats = Array.from({ length: size }, (_, k) => {
          const at = statsAt + 7 * k;
          return { n: totals[at], sum: [totals[at + 1], totals[at + 2], totals[at + 3]], sumSq: [totals[at + 4], totals[at + 5], totals[at + 6]] };
        });
        const means = symbolStats.map((st) => (st.n ? [st.sum[0] / st.n, st.sum[1] / st.n, st.sum[2] / st.n] : null));
        let gap = Infinity;
        for (let a = 0; a < size; a++) {
          for (let b = a + 1; b < size; b++) {
            const ma = means[a];
            const mb = means[b];
            if (ma && mb) gap = Math.min(gap, labDistance([ma[0], ma[1], ma[2]], [mb[0], mb[1], mb[2]]));
          }
        }
        const spreads = symbolStats.filter((st) => st.n > 1).map((st) => {
          let variance = 0;
          for (let c = 0; c < 3; c++) variance += st.sumSq[c] / st.n - (st.sum[c] / st.n) ** 2;
          return Math.max(0, variance / 3);
        });
        const sigma = Math.sqrt(mean(spreads));
        const snrDb = Number.isFinite(gap) && sigma > 0 ? 20 * Math.log10(gap / 2 / sigma) : 0;
        const cells = dataCellCount(s.pattern);
        const counted = totals[0];
        return {
          pattern: s.pattern,
          framesAnalysed: analysed,
          clean: s.clean,
          torn: s.torn,
          blended: s.blended,
          symbolErrorRate: counted ? totals[1] / counted : 1,
          bitsPerCell,
          maxBitsPerCell: Math.log2(size),
          snrDb,
          cameraCellPx: mean(s.cellPx),
          displayFps,
          effectiveFps,
          capacityKBps: (bitsPerCell * cells * effectiveFps) / 8 / 1000,
          meanConfidence: mean(s.confidences),
          confidenceP10: percentile(s.confidences, 0.1),
          confusion,
        };
      });
    const flicker = [...this.flicker.values()]
      .sort((a, b) => a.pattern.index - b.pattern.index)
      .map((s): FlickerResult => {
        const mean0 = meanLab(s.frames.filter((f) => f.variant === 0).map((f) => f.lab));
        const mean1 = meanLab(s.frames.filter((f) => f.variant === 1).map((f) => f.lab));
        const hits = s.frames.filter((f) => labDistance(f.lab, f.variant === 0 ? mean0 : mean1) <= labDistance(f.lab, f.variant === 0 ? mean1 : mean0)).length;
        const elapsed = Math.max(1, s.lastTime - s.firstTime) / 1000;
        return {
          pattern: s.pattern,
          framesAnalysed: s.frames.length,
          displayFps: (s.lastCounter - s.firstCounter) / elapsed,
          separation: labDistance(mean0, mean1),
          fidelity: s.frames.length ? hits / s.frames.length : 0,
        };
      });
    const edges = [...this.edges.values()].map((s): EdgeResult => ({ pattern: s.pattern, framesAnalysed: s.sigmas.length, sigmaCells: mean(s.sigmas), mtf50CyclesPerCell: mean(s.mtf50s) }));
    return { meta: this.meta, framesAnalysed: this.framesAnalysed, unreadable: Object.fromEntries(this.unreadable), grids, flicker, edges };
  }
}

function dataCellCount(pattern: ProbePattern): number {
  return pattern.cols * (pattern.rows - 2 * BAND_ROWS);
}

function meanLab(labs: Lab[]): Lab {
  if (!labs.length) return [0, 0, 0];
  return [mean(labs.map((l) => l[0])), mean(labs.map((l) => l[1])), mean(labs.map((l) => l[2]))];
}

/**
 * Writes a report as plain text for copying. Nothing is sent anywhere.
 * @param report - A finished run.
 * @returns The text.
 */
export function formatProbeReport(report: ProbeReport): string {
  const { meta } = report;
  const lines: string[] = ['QRCraftly optical channel probe', `Device: ${meta.device || 'unlabelled'}`, `Direction: ${meta.direction || 'unlabelled'}`, `Mode: ${meta.mode}`];
  if (meta.camera) {
    lines.push(`Camera granted: ${meta.camera.width} x ${meta.camera.height} at ${meta.camera.frameRate} fps`);
    if (meta.camera.deliveredFps !== undefined) lines.push(`Camera delivered: ${meta.camera.deliveredFps.toFixed(1)} fps`);
  }
  lines.push(`Frames analysed: ${report.framesAnalysed}`);
  const unreadable = Object.entries(report.unreadable);
  if (unreadable.length) lines.push(`Unreadable: ${unreadable.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  lines.push('', 'Grids (pitch, constellation | camera px per cell | clean/torn/blended | SER | bits per cell of max | SNR dB | display fps | capacity KB/s)');
  for (const g of report.grids) {
    lines.push(
      `${g.pattern.label} | ${g.cameraCellPx.toFixed(1)} | ${g.clean}/${g.torn}/${g.blended} | ${(g.symbolErrorRate * 100).toFixed(2)}% | ${g.bitsPerCell.toFixed(2)} of ${g.maxBitsPerCell} | ${g.snrDb.toFixed(1)} | ${g.displayFps.toFixed(1)} | ${g.capacityKBps.toFixed(1)}`
    );
  }
  if (report.edges.length) {
    lines.push('', 'Slanted edge (line spread deviation in cells, MTF50 in cycles per cell)');
    for (const e of report.edges) lines.push(`${e.pattern.label} | ${e.sigmaCells.toFixed(3)} | ${e.mtf50CyclesPerCell.toFixed(2)}`);
  }
  if (report.flicker.length) {
    lines.push('', 'Flicker (display fps seen | OKLab separation | variant fidelity)');
    for (const f of report.flicker) lines.push(`${f.pattern.label} | ${f.displayFps.toFixed(1)} | ${f.separation.toFixed(3)} | ${(f.fidelity * 100).toFixed(0)}%`);
  }
  return lines.join('\n');
}
